import ClientSocket from "./ClientSocket";
import { AnyMessageContent, delay } from "@whiskeysockets/baileys";

class CommandBuilder extends ClientSocket {

    public client: any;
    public sticker: any;

    constructor(client: any) {
        super();
        this.client = client;
        this.sticker = this.sticker;
    }

    public async sendMessageWTyping(msg: AnyMessageContent, jid: string) {

        if (!this.client) {
            throw new Error("Client is not initialized.");
        }
        await this.client.presenceSubscribe(jid)
        await delay(500)

        await this.client.sendPresenceUpdate('composing', jid)
        await delay(2000)

        await this.client.sendPresenceUpdate('paused', jid)

        await this.client.sendMessage(jid, msg)

    }

    public async sendMessageQuoted(msg: AnyMessageContent, jid: string, quoted: any) {

        if (!this.client) {
            throw new Error("Client is not initialized.");
        }
        await this.client.presenceSubscribe(jid)
        await delay(500)

        await this.client.sendPresenceUpdate('composing', jid)
        await delay(2000)

        await this.client.sendPresenceUpdate('paused', jid)

        await this.client.sendMessage(jid, msg, quoted)

    }


} export default CommandBuilder;