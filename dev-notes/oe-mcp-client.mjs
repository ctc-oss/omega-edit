#!/usr/bin/env node
// Minimal MCP stdio client for the OmegaEdit @omega-edit/ai server.
// Drives `omega-edit-mcp` (packages/ai/dist/cjs/mcp.js) and prints JSON results.
//
// USAGE (two steps):
//   1) Start the native gRPC server (it must already be listening). On this
//      Windows/MSYS host the reliable way is to launch it via a background
//      terminal:
//        terminal(background=true):
//          packages/server/out/bin/omega-edit-grpc-server.exe --port 9000 --host 127.0.0.1
//      (A bare node spawn of the Debug exe fails with STATUS_ENTRYPOINT_NOT_FOUND
//       because the debug UCRT only resolves through the interactive shell.)
//   2) Pipe newline-delimited requests to this client:
//        node oe-mcp-client.mjs --port 9000 --no-autostart < requests.jsonl
//
// Options:
//   --port N            gRPC port the native OmegaEdit server listens on
//   --host H            gRPC host (default 127.0.0.1)
//   --no-autostart      do NOT try to launch a native server (default: try)
//   --server EXE        path to a prebuilt omega-edit-grpc-server(.exe)
//   --timeout Ms        per-call timeout (default 20000)
//
// Request shorthand: a line `{"tool":"name","arguments":{...}}` is sent as a
// `tools/call`. Response values can be reused via `{{.field}}` templating from
// the previous result's `structuredContent` (e.g. `{{.sessionId}}`, which is
// also carried forward automatically once seen).
//
// Protocol: newline-delimited JSON-RPC 2.0 over stdio.
// Lifecycle: initialize -> notifications/initialized -> tools/call*.

import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

const args = process.argv.slice(2)
const get = (flag, dflt) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : dflt
}

const port = get('--port', '9000')
const host = get('--host', '127.0.0.1')
const noAuto = args.includes('--no-autostart')
const keepServer = args.includes('--keep-server')
const timeout = Number(get('--timeout', '20000'))
const serverExe =
  get('--server', '') ||
  process.env.OE_GRPC_SERVER ||
  resolve(__dirname, '../packages/server/out/bin/omega-edit-grpc-server.exe')

const mcpJs =
  process.env.OE_MCP_JS || resolve(__dirname, '../packages/ai/dist/cjs/mcp.js')

const childArgs = ['--host', host, '--port', String(port)]
if (noAuto) childArgs.push('--no-autostart')

// Optionally launch the native gRPC server ourselves.
let serverProc = null
async function maybeStartServer() {
  if (noAuto) return
  if (!existsSync(serverExe)) {
    console.error(
      `[oe-mcp-client] server binary not found: ${serverExe}; relying on --no-autostart path`
    )
    return
  }
  // On Windows the native server is a Debug MSVC build. It loads reliably only
  // when started from a bash shell (the same environment that makes the
  // `terminal(background=true)` launch work), so spawn it via `bash -c`. A bare
  // node spawn fails with STATUS_ENTRYPOINT_NOT_FOUND because the debug UCRT is
  // resolved through the bash environment, not node's.
  const bashExe = process.platform === 'win32' ? 'bash' : serverExe
  const bashArgs =
    process.platform === 'win32'
      ? ['-c', `${serverExe} --port ${port} --host ${host}`]
      : ['--port', String(port), '--host', host]
  serverProc = spawn(bashExe, bashArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  })
  serverProc.on('error', (e) =>
    console.error(`[oe-mcp-client] server spawn error: ${e.message}`)
  )
  serverProc.on('exit', (code) =>
    console.error(`[oe-mcp-client] server exited: ${code}`)
  )
  serverProc.on('exit', (code) =>
    console.error(`[oe-mcp-client] server exited: ${code}`)
  )
  // Wait until the port accepts a TCP connection (max ~10s).
  const net = await import('node:net')
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300))
    const ok = await new Promise((res) => {
      const s = net.connect(Number(port), host)
      s.on('connect', () => {
        s.destroy()
        res(true)
      })
      s.on('error', () => res(false))
    })
    if (ok) return
  }
  console.error('[oe-mcp-client] timed out waiting for native server port')
}

const child = spawn(process.execPath, [mcpJs, ...childArgs], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: process.env,
})

let buf = ''
const pending = new Map()
let nextId = 1
let serverReady = false

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + '\n')
}

child.stdout.on('data', (chunk) => {
  buf += chunk.toString('utf8')
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    }
  }
})

function rpc(method, params, notify = false) {
  return new Promise((resolve, reject) => {
    if (notify) {
      send({ jsonrpc: '2.0', method, params })
      resolve(undefined)
      return
    }
    const id = nextId++
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`MCP timeout: ${method}`))
    }, timeout)
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      reject: (e) => {
        clearTimeout(timer)
        reject(e)
      },
    })
    send({ jsonrpc: '2.0', id, method, params })
  })
}

let lastResult = null
let lastSessionId = null

function subst(obj) {
  if (typeof obj !== 'object' || obj === null) return obj
  const json = JSON.stringify(obj)
  const replaced = json.replace(/\{\{\.(\w+)\}\}/g, (_, key) => {
    let v
    if (lastResult && typeof lastResult === 'object') {
      if (key in lastResult) v = lastResult[key]
      else if (
        lastResult.structuredContent &&
        typeof lastResult.structuredContent === 'object' &&
        key in lastResult.structuredContent
      ) {
        v = lastResult.structuredContent[key]
      }
    }
    if (v === undefined && key === 'sessionId') v = lastSessionId
    if (v === undefined) return ''
    return typeof v === 'string' || typeof v === 'number'
      ? String(v)
      : JSON.stringify(v)
  })
  return JSON.parse(replaced)
}

function handleRequest(req) {
  const method = req.method || (req.tool ? 'tools/call' : req.method)
  let params =
    req.method === 'tools/call'
      ? req.params
      : req.tool
        ? { name: req.tool, arguments: req.arguments || {} }
        : req.params || {}
  params = subst(params)
  // Capture a sessionId from the (now-substituted) request to carry forward.
  const outboundSid =
    params.arguments && params.arguments.sessionId
      ? params.arguments.sessionId
      : params.sessionId
  if (typeof outboundSid === 'string' && outboundSid) {
    lastSessionId = outboundSid
  }
  return rpc(method, params)
}

async function main() {
  await maybeStartServer()
  await rpc('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'oe-mcp-client', version: '1.0' },
  })
  await rpc('notifications/initialized', {}, true)

  const rl = await import('node:readline')
  const rli = rl.createInterface({ input: process.stdin })
  for await (const line of rli) {
    const t = line.trim()
    if (!t) continue
    try {
      const req = JSON.parse(t)
      const res = await handleRequest(req)
      lastResult = res
      const sid =
        res && res.structuredContent && res.structuredContent.sessionId
          ? res.structuredContent.sessionId
          : res && res.sessionId
            ? res.sessionId
            : null
      if (typeof sid === 'string' && sid) lastSessionId = sid
      process.stdout.write(JSON.stringify(res, null, 2) + '\n')
    } catch (e) {
      process.stderr.write('req error: ' + e.message + '\n')
    }
  }

  if (serverProc && !keepServer) serverProc.kill()
  child.kill()
  process.exit(0)
}

child.on('error', (e) => {
  process.stderr.write('spawn error: ' + e.message + '\n')
  if (serverProc) serverProc.kill()
  process.exit(1)
})

main().catch((e) => {
  process.stderr.write('fatal: ' + e.message + '\n')
  if (serverProc) serverProc.kill()
  child.kill()
  process.exit(1)
})
