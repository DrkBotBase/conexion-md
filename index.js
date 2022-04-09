require('./config')
const { default: myBotConnect, useSingleFileAuthState, DisconnectReason, fetchLatestBaileysVersion, generateForwardMessageContent, prepareWAMessageMedia, generateWAMessageFromContent, generateMessageID, downloadContentFromMessage, makeInMemoryStore, jidDecode, proto } = require("@adiwajshing/baileys")
const { state, saveState } = useSingleFileAuthState(`./${sessionName}.json`)

const pino = require('pino')
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const yargs = require('yargs/yargs')
const FileType = require('file-type')
//const path = require('path')
const log = console.log
// #### chalk ####
const color = require('chalk');
const warn = color.bold.red;

var low
try {
  low = require('lowdb')
} catch (e) {
  low = require('./lib/lowdb')
}

const { Low, JSONFile } = low
const mongoDB = require('./lib/mongoDB')

global.api = (name, path = '/', query = {}, apikeyqueryname) => (name in global.APIs ? global.APIs[name] : name) + path + (query || apikeyqueryname ? '?' + new URLSearchParams(Object.entries({ ...query, ...(apikeyqueryname ? { [apikeyqueryname]: global.APIKeys[name in global.APIs ? global.APIs[name] : name] } : {}) })) : '')

const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) })

global.opts = new Object(yargs(process.argv.slice(2)).exitProcess(false).parse())
global.db = new Low(
  /https?:\/\//.test(opts['db'] || '') ?
    new cloudDBAdapter(opts['db']) : /mongodb/.test(opts['db']) ?
      new mongoDB(opts['db']) :
      new JSONFile(`src/database.json`)
)
global.db.data = {
    users: {},
    chats: {},
    database: {},
    game: {},
    settings: {},
    others: {},
    sticker: {},
    ...(global.db.data || {})
}

// save database every 30seconds
if (global.db) setInterval(async () => {
    if (global.db.data) await global.db.write()
  }, 30 * 1000)

async function startMybot() {
  const myBot = myBotConnect({
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
    browser: ['DrkBot','Safari','1.0.0'],
    auth: state
  })

  store.bind(myBot.ev)
  
  myBot.decodeJid = (jid) => {
        if (!jid) return jid
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {}
            return decode.user && decode.server && decode.user + '@' + decode.server || jid
        } else return jid
  }

  myBot.ev.on('contacts.update', update => {
        for (let contact of update) {
            let id = myBot.decodeJid(contact.id)
            if (store && store.contacts) store.contacts[id] = { id, name: contact.notify }
        }
  })

  myBot.setStatus = (status) => {
        myBot.query({
            tag: 'iq',
            attrs: {
                to: '@s.whatsapp.net',
                type: 'set',
                xmlns: 'status',
            },
            content: [{
                tag: 'status',
                attrs: {},
                content: Buffer.from(status, 'utf-8')
            }]
        })
        return status
  }

  myBot.serializeM = (m) => smsg(myBot, m, store)

  myBot.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update	    
        if (connection === 'close') {
        let reason = new Boom(lastDisconnect?.error)?.output.statusCode
            if (reason === DisconnectReason.badSession) { log(`Archivo de sesión corrupto, elimine la sesión y vuelva a escanear.`); myBot.logout(); }
            else if (reason === DisconnectReason.connectionClosed) { log("Conexión cerrada, reconectando...."); startMybot(); }
            else if (reason === DisconnectReason.connectionLost) { log("Conexión perdida del servidor, reconectando..."); startMybot(); }
            else if (reason === DisconnectReason.connectionReplaced) { log("Conexión reemplazada, otra nueva sesión abierta, cierre la sesión actual primero."); myBot.logout(); }
            else if (reason === DisconnectReason.loggedOut) { log(`Dispositivo cerrado, escanee nuevamente y ejecute.`); myBot.logout(); }
            else if (reason === DisconnectReason.restartRequired) { log("Reinicio requerido, reiniciando..."); startMybot(); }
            else if (reason === DisconnectReason.timedOut) { log("Se agotó el tiempo de espera de la conexión, reconectando..."); startMybot(); }
            else myBot.end(`Unknown DisconnectReason: ${reason}|${connection}`)
        }
        log('Connected...', update)
  })

  myBot.ev.on('creds.update', saveState)

  return myBot
}
startMybot()