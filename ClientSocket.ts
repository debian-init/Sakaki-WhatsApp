import fs from 'fs'
import P from 'pino'
import path from 'path'
import { Boom } from '@hapi/boom'
import NodeCache from 'node-cache'
import readline from 'readline'
import makeWASocket, {
    AnyMessageContent, BinaryInfo, delay, DisconnectReason,
    encodeWAM, fetchLatestBaileysVersion,
    getAggregateVotesInPollMessage, isJidNewsletter, makeCacheableSignalKeyStore,
    makeInMemoryStore, proto, useMultiFileAuthState, WAMessageContent, WAMessageKey,
    downloadMediaMessage
} from '@whiskeysockets/baileys'

const sharp = require('sharp');
const foldersPath = path.join(__dirname, './Commands');
const commandFolders = fs.readdirSync(foldersPath);
const msgRetryCounterCache = new NodeCache()
const onDemandMap = new Map<string, string>()
const useStore = !process.argv.includes('--no-store')
const doReplies = process.argv.includes('--do-reply')
const usePairingCode = process.argv.includes('--use-pairing-code')
const logger = P({ timestamp: () => `,"time":"${new Date().toJSON()}"` }, P.destination('./wa-logs.txt'))
logger.level = 'trace'
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (text: string) => new Promise<string>((resolve) => rl.question(text, resolve))
const store = useStore ? makeInMemoryStore({ logger }) : undefined
store?.readFromFile('Lib/Baileys/Store/baileys_store_multi.json')
setInterval(() => {
    store?.writeToFile('Lib/Baileys/Store/baileys_store_multi.json')
}, 10_000)



class ClientSocket {
    public client: any;
    public commands: any = new Map();
    public MediaUrl: any;

    public async Start() {
        await this.loadCommands();

        const { state, saveCreds } = await useMultiFileAuthState('Lib/Baileys/Connection')

        // Fetch latest version of WA Web
        const { version, isLatest } = await fetchLatestBaileysVersion()
        console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`)

        this.client = makeWASocket({
            version,
            logger,
            printQRInTerminal: !usePairingCode,
            auth: {
                creds: state.creds,
                /** caching makes the store faster to send/recv messages */
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            msgRetryCounterCache,
            generateHighQualityLinkPreview: true,
            getMessage: getMessage,
        })

        store?.bind(this.client.ev)

        if (usePairingCode && !this.client.authState.creds.registered) {
            const phoneNumber = await question('Please enter your phone number:\n')
            const code = await this.client.requestPairingCode(phoneNumber)
            console.log(`Pairing code: ${code}`)
        }

        // Process events
        this.client.ev.process(
            async (events: any) => {
                if (events['connection.update']) {
                    const update = events['connection.update']
                    const { connection, lastDisconnect } = update
                    if (connection === 'close') {
                        if ((lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut) {
                            this.Start()
                        } else {
                            console.log('Connection closed. You are logged out.')
                        }
                    }

                    console.log('connection update', update)
                }

                if (events['creds.update']) {
                    await saveCreds()
                }

                if (events['messages.upsert']) {
                    const upsert = events['messages.upsert']
                    console.log('recv messages ', JSON.stringify(upsert, undefined, 2))

                    if (upsert.type === 'notify') {
                        for (const msg of upsert.messages) {

                            if (!msg.message) return;

                            const from = msg.key.remoteJid;
                            const messageType = Object.keys(msg.message)[0];

                            if (messageType === 'imageMessage') {
                                const caption = msg.message.imageMessage.caption || '';
                                if (caption.toLowerCase() === '#sticker') {
                                    try {
                                        const buffer = await downloadMediaMessage(
                                            msg,
                                            'buffer',
                                            {},
                                            {
                                                logger,
                                                // pass this so that baileys can request a reupload of media
                                                // that has been deleted
                                                reuploadRequest: this.client.updateMediaMessage
                                            }
                                        );
                                        const stickerBuffer = await sharp(buffer)
                                            .resize(512, 512, {
                                                fit: 'contain',
                                                background: { r: 0, g: 0, b: 0, alpha: 0 },
                                            })
                                            .webp({ quality: 100 })
                                            .toBuffer();

                                        await this.client.sendMessage(from, {
                                            sticker: stickerBuffer,
                                            mimetype: 'image/webp',
                                            ptt: true,
                                            fileName: 'sticker.webp',
                                            stickerMetadata: {
                                                author: 'SeuNome',
                                                pack: 'SeuPacote',
                                            },
                                        });
                                    } catch (error) {
                                        console.error('Erro ao processar a imagem:', error);
                                        await this.client.sendMessage(from, { text: 'Erro ao criar a figurinha. Tente novamente!' });
                                    }
                                } else {
                                    await this.client.sendMessage(from, { text: 'Envie uma imagem com a legenda "#sticker" para criar uma figurinha!' });
                                }
                            }



                            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text
                            if (text && !msg.key.fromMe) {
                                const command = this.commands.get(text.toLowerCase()); // Busca o comando pelo texto
                                if (command) {
                                    try {
                                        await command.execute(msg, this.client); // Executa o comando
                                    } catch (error) {
                                        console.error(`Error executing command ${text}:`, error);
                                    }
                                }
                            }

                            if (!msg.key.fromMe && doReplies && !isJidNewsletter(msg.key?.remoteJid!)) {
                                console.log('replying to', msg.key.remoteJid)
                                await this.client!.readMessages([msg.key])
                            }
                        }
                    }
                }

                // Handle other events
                if (events['messages.update']) {
                    console.log(JSON.stringify(events['messages.update'], undefined, 2))
                }

                if (events['message-receipt.update']) {
                    console.log(events['message-receipt.update'])
                }

                if (events['messages.reaction']) {
                    console.log(events['messages.reaction'])
                }

                if (events['presence.update']) {
                    console.log(events['presence.update'])
                }

                if (events['chats.update']) {
                    console.log(events['chats.update'])
                }

                if (events['contacts.update']) {
                    for (const contact of events['contacts.update']) {
                        if (typeof contact.imgUrl !== 'undefined') {
                            const newUrl = contact.imgUrl === null
                                ? null
                                : await this.client!.profilePictureUrl(contact.id!).catch(() => null)
                            console.log(
                                `contact ${contact.id} has a new profile pic: ${newUrl}`,
                            )
                        }
                    }
                }

                if (events['chats.delete']) {
                    console.log('chats deleted ', events['chats.delete'])
                }
            }
        )

        // Função para converter imagem em figurinha
        async function convertToSticker(imageBuffer: any) {
            return sharp(imageBuffer)
                .resize(512, 512, {
                    fit: 'contain',
                    background: { r: 0, g: 0, b: 0, alpha: 0 },
                })
                .webp({ quality: 80 })
                .toBuffer();
        }


        return this.client

        async function getMessage(key: WAMessageKey): Promise<WAMessageContent | undefined> {
            if (store) {
                const msg = await store.loadMessage(key.remoteJid!, key.id!)
                return msg?.message || undefined
            }

            // only if store is present
            return proto.Message.fromObject({})
        }

    }


    private async loadCommands() {
        for (const folder of commandFolders) {
            const commandsPath = path.join(foldersPath, folder);
            const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.ts'));

            for (const file of commandFiles) {
                const filePath = path.join(commandsPath, file);
                const command = await import(filePath);

                if ('data' in command && 'execute' in command) {
                    this.commands.set(command.data.name, command);
                    console.log(`Command ${command.data.name} loaded.`);
                } else {
                    console.log(`[WARNING] Command at ${filePath} is missing "data" or "execute".`);
                }
            }
        }
    }
}

export default ClientSocket;