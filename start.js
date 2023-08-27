const {execSync, exec} = require('child_process')
const fs = require('fs-extra')
const path = require('path')
const logFolderPath = path.resolve(__dirname, '..', 'logs')
const assert = require('assert')
const Debug = require('debug')
const debugLogs = Debug('pubsub-logger:logs')
Debug.enable('pubsub-logger:*')
const cborg = require('cborg')
const {toString} = require('uint8arrays/to-string')
const {fromString} = require('uint8arrays/from-string')
const {resolveEnsTxtRecord} = require('./utils/ens')
const base64 = require('multiformats/bases/base64')

const retryTimeout = 60000

const subplebbits = [
  {
    "title": "Test sub",
    "address": "12D3KooWG3XbzoVyAE6Y9vHZKF64Yuuu4TjdgQKedk14iYmTEPWu"
  },
  {
    "title": "Plebbit Token",
    "address": "plebtoken.eth"
  },
  {
    "title": "Plebbit Lore",
    "address": "pleblore.eth"
  },
  {
    "title": "/pol/",
    "address": "politically-incorrect.eth"
  },
  {
    "title": "/biz/",
    "address": "business-and-finance.eth"
  },
  {
    "address": "movies-tv-anime.eth"
  },
  {
    "address": "videos-livestreams-podcasts.eth"
  },
  {
    "address": "health-nutrition-science.eth"
  },
  {
    "address": "censorship-watch.eth"
  },
  {
    "address": "reddit-screenshots.eth"
  },
  {
    "address": "plebbit-italy.eth"
  },
  {
    "title": "Thrifty Plebs",
    "address": "12D3KooWLiXLKwuWmfzwTRtBasTzDQVNagv8zU63eCEcdw2dT4zB"
  },
  {
    "title": "Plebs Helping Plebs",
    "address": "plebshelpingplebs.eth"
  },
  {
    "title": "Pleb Whales",
    "address": "plebwhales.eth"
  }
]

const getRunningIpfsProcessPath = () => {
  let ipfsPath
  try {
    ipfsPath = execSync(`ps -eo cmd | grep ipfs | grep -v grep | grep -v "${__dirname}" | cut -f 1 -d " "`).toString().trim()
  }
  catch (e) {
    e.message = `failed getRunningIpfsProcessPath() 'ps -eo cmd | grep ipfs': ${e.message}`
    throw e
  }
  if (!ipfsPath) {
    throw Error(`no running ipfs process found using 'ps -eo cmd | grep ipfs'`)
  }
  return path.resolve(ipfsPath)
}

const getIpfsStats = () => {
  const ipfsPath = getRunningIpfsProcessPath()
  let bw
  try {
    bw = execSync(`${ipfsPath} stats bw`).toString().trim().replaceAll('\n', ', ')
  }
  catch (e) {
    e.message = `failed getIpfsStats() 'ipfs stats bw': ${e.message}`
    throw e
  }
  return bw
}

fs.ensureDirSync(logFolderPath)

const writeLog = async (subplebbitAddress, log) => {
  const timestamp = new Date().toISOString().split('.')[0]
  const date = timestamp.split('T')[0]
  const logFilePath = path.resolve(logFolderPath, subplebbitAddress, date)
  // try to parse message and delete useless fields
  try {
    const message = cborg.decode(log)
    delete message.encryptedPublication
    delete message.encryptedChallenges
    delete message.encryptedChallengeAnswers
    delete message.acceptedChallengeTypes
    delete message.protocolVersion
    delete message.signature
    try {
      message.challengeRequestId = toString(message.challengeRequestId, 'base58btc')
    }
    catch (e) {}
    // sort the json props so they are easier to read in the logs
    const sorted = {}
    sorted.type = message.type
    sorted.challengeRequestId = message.challengeRequestId
    log = JSON.stringify({...sorted, ...message})
    debugLogs(subplebbitAddress, log)
  }
  catch (e) {
    try {log = toString(log)} catch (e) {}
    debugLogs(e, log?.substring?.(0, 200))
  }
  await fs.appendFile(logFilePath, `${timestamp} ${log}\r\n\r\n`)
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const pubsubLog = async (subplebbitAddress, ipnsName) => {
  let ipfsPath
  while (!ipfsPath) {
    try {
      ipfsPath = getRunningIpfsProcessPath()
    }
    catch (e) {
      debugLogs(subplebbitAddress, e.message)
      await sleep(retryTimeout)
    }
  }
  const ipfsProcess = exec(`${ipfsPath} pubsub sub ${ipnsName} --enc=json`)
  ipfsProcess.stderr.on('data', data => debugLogs('stderr', subplebbitAddress, `${ipfsPath} pubsub sub ${ipnsName} --enc=json`, data))
  const onMessage = (message) => {
    let data
    try {
      data = JSON.parse(message).data
      data = base64.base64url.decode(data)
    }
    catch (e) {
      // failed decoding message, probably not a pubsub message but rather an IPFS error message
      // debugLogs('onMessage error', subplebbitAddress, e.message)
      return
    }
    return writeLog(subplebbitAddress, data)
  }
  ipfsProcess.stdout.on('data', onMessage)
  ipfsProcess.on('error', data => debugLogs('error', subplebbitAddress, ipfsPath, data))
  ipfsProcess.on('exit', async () => {
    debugLogs(subplebbitAddress, `'${ipfsPath} pubsub sub ${ipnsName}' process with pid ${ipfsProcess.pid} exited`)
    await sleep(retryTimeout)
    pubsubLog(subplebbitAddress, ipnsName)
  })
}

// start the log loop for each sub
;(async () => {
  for (const subplebbit of subplebbits) {
    try {
      assert(subplebbit.address)
      fs.ensureDirSync(path.resolve(logFolderPath, subplebbit.address))

      let ipnsName = subplebbit.address
      if (ipnsName.includes('.eth')) {
        ipnsName = await resolveEnsTxtRecord(subplebbit.address, 'subplebbit-address')
      }

      await pubsubLog(subplebbit.address, ipnsName)
      debugLogs('started logging', subplebbit)
    }
    catch (e) {
      debugLogs('failed start logging', subplebbit, e.message)
    }
  }
})()

// start server
const port = 39393
const express = require('express')
const server = express()
const serveIndex = require('serve-index')
// make sure directories can be listed
server.use('/logs', serveIndex(logFolderPath, {'icons': true}))
// make sure files can be viewed in the browser
const setHeaders = (res, path) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
}
server.use('/logs', express.static(logFolderPath, {setHeaders, cacheControl: false}))
server.listen(port)
