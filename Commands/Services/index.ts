import CommandBuilder from "../../CommandBuilder"

module.exports = {
  data: {
    name: "#start",
  },
  async execute(msg: any, client: any) {
    const sakaki = new CommandBuilder(client)

    await sakaki.sendMessageQuoted({
      image: {
        url: "https://i.ibb.co/cFQCZX3/Rem-Anime.webp"
      }, caption: `#null`}, msg.key?.remoteJid!, { quoted: msg });

  },

};
