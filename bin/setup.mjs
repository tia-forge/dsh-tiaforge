#!/usr/bin/env node
/**
 * dsh-tiaforge-setup —— 本地回环的接入配置页（不联网、不上报、不依赖 dsh 的界面）。
 *
 * 做一件事：把五个端点的 URL / Key 写进 dsh 凭据库的托管文件
 * （默认 `$DSH_HOME/.credentials.yaml`）。凭据库 watch 着那个文件，
 * 所以保存后 25 秒内 dsh 里就会出现对应工具，**不用重启**。
 *
 *   npx dsh-tiaforge-setup            # 打开浏览器表单
 *   npx dsh-tiaforge-setup --print    # 只打印目标文件路径，不起服务
 *   npx dsh-tiaforge-setup --port 8484 --no-open
 *   npx dsh-tiaforge-setup --creds D:/x/.credentials.yaml
 *
 * 安全姿势：只绑 127.0.0.1，路径里带一次性 token，页面不加载任何外部资源，
 * 填的 Key 只写进本机那个文件（备份一份 .bak-<时间戳>）。
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { SERVICES } from '../lib/refs.mjs'
import { probeEndpoint } from '../lib/probe.mjs'
import { applyRefUpdates, parseRefs, resolveCredentialsPath } from '../lib/credentials-file.mjs'
import { hasGatewayAuth, syncGatewayAuth } from '../lib/gateway-patch.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'))
const PAGE = fs.readFileSync(path.join(here, '..', 'assets', 'setup.html'), 'utf8')

const args = parseArgs(process.argv.slice(2))
const credentialsPath = resolveCredentialsPath(args.creds)

if (args.help) {
  console.log(
    [
      'dsh-tiaforge-setup —— 配置 TIA Forge 的五个 MCP 端点',
      '',
      '  --creds <path>   指定凭据文件（默认 $DSH_HOME/.credentials.yaml，其次 ~/.dsh/.credentials.yaml）',
      '  --port <n>       监听端口（默认随机）',
      '  --no-open        不自动打开浏览器',
      '  --print          只打印凭据文件路径与当前状态，不起服务',
      '  --clear          清掉 TIA Forge 的 Key（保留 URL），并移除 TiaLink 令牌覆盖块',
      '  --clear --all    连 URL 一起清掉（下次启动会重新播种内置默认值）',
      '  --json           与 --print 连用，输出 JSON',
    ].join('\n'),
  )
  process.exit(0)
}

if (args.clear) {
  const targets = SERVICES.flatMap((service) => (args.all ? [service.urlRef, service.keyRef] : [service.keyRef]))
  const existing = fs.existsSync(credentialsPath) ? parseRefs(fs.readFileSync(credentialsPath, 'utf8')) : new Map()
  const updates = new Map(targets.filter((ref) => existing.has(ref)).map((ref) => [ref, null]))

  let result = { path: credentialsPath, changed: [], backup: null }
  if (updates.size > 0) result = applyRefUpdates(credentialsPath, updates)

  const gateway = syncGatewayAuth({ dshHome: gatewayHome(), enabled: false })

  console.log(`凭据文件：${result.path}`)
  if (result.changed.length === 0) {
    console.log('  这些项本来就没配置，无需清除')
  } else {
    console.log(`  已清除 ${result.changed.length} 项：${result.changed.join('、')}`)
    if (result.backup) console.log(`  备份：${result.backup}`)
  }
  console.log(gateway.changed ? `  已移除 TiaLink 令牌覆盖块：${gateway.path}` : '  TiaLink 令牌覆盖块：本来就没有')
  console.log('  records（登录会话）和其它工具写的配置都保留着。')
  console.log('  约 25 秒内生效，不用重启 dsh。')
  process.exit(0)
}

if (args.print) {
  const state = readState()
  if (args.json) {
    console.log(JSON.stringify(state, null, 2))
  } else {
    console.log(`凭据文件：${credentialsPath}${fs.existsSync(credentialsPath) ? '' : '（还不存在）'}`)
    for (const service of state.services) {
      const key = service.keyState === 'none' ? '未配置' : `已配置（${service.keyState}：${service.keyHint}）`
      console.log(`  ${service.server.padEnd(11)} ${service.url.padEnd(46)} ${key}`)
    }
    const ready = state.services.filter((service) => service.keyState !== 'none').length
    console.log(`\n端点就绪 ${ready}/${state.services.length}`)
  }
  process.exit(0)
}

if (!fs.existsSync(credentialsPath)) {
  console.log(`提示：${credentialsPath} 还不存在，保存时会新建（version/records/refs 三节齐）。`)
}

const token = randomBytes(24).toString('base64url')

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    respond(res, 500, { ok: false, error: error?.message ?? String(error) })
  })
})

server.listen(args.port, '127.0.0.1', () => {
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}/${token}/`
  console.log(`TIA Forge 配置页：${url}`)
  console.log(`将写入：${credentialsPath}`)
  console.log('保存后约 25 秒生效，不用重启 dsh。Ctrl+C 退出。')
  if (!args['no-open']) openBrowser(url)
})

server.on('error', (error) => {
  console.error(`✗ 起不来：${error.message}`)
  process.exit(1)
})

process.on('SIGINT', () => {
  console.log('\n已退出（配置已生效的不会回滚）')
  process.exit(0)
})

// ── 路由 ────────────────────────────────────────────────────────────────────

async function handle(req, res) {
  if (!isLoopback(req)) return respond(res, 403, { ok: false, error: 'only loopback' })

  const prefix = `/${token}`
  if (!req.url.startsWith(prefix)) return respond(res, 404, { ok: false, error: 'not found' })
  const route = req.url.slice(prefix.length).replace(/\/+$/, '') || '/'

  if (req.method === 'GET' && route === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(PAGE)
    return
  }
  if (req.method === 'GET' && route === '/state') {
    return respond(res, 200, readState())
  }
  if (req.method === 'POST' && route === '/save') {
    const body = await readJson(req)
    return respond(res, 200, save(body))
  }
  if (req.method === 'POST' && route === '/probe') {
    const body = await readJson(req)
    return respond(res, 200, await probe(body))
  }
  return respond(res, 404, { ok: false, error: 'not found' })
}

// ── 状态 / 保存 / 探测 ──────────────────────────────────────────────────────

/** home patch 的位置：DSH_HOME 优先，其次凭据文件所在目录（默认就是同一个）。 */
function gatewayHome() {
  return process.env.DSH_HOME ? path.resolve(process.env.DSH_HOME) : path.dirname(credentialsPath)
}

function readState() {
  const refs = fs.existsSync(credentialsPath) ? parseRefs(fs.readFileSync(credentialsPath, 'utf8')) : new Map()

  return {
    version: pkg.version,
    credentialsPath,
    gatewayAuth: readGatewayAuth(),
    services: SERVICES.map((service) => {
      const storedUrl = refs.get(service.urlRef)
      const storedKey = refs.get(service.keyRef)
      const envKey = process.env[service.keyRef]
      const keyValue = storedKey || envKey || ''
      return {
        server: service.server,
        title: service.title,
        summary: service.summary,
        optional: Boolean(service.optional),
        dashboard: service.dashboard ?? null,
        urlRef: service.urlRef,
        url: storedUrl || service.defaultUrl,
        urlSource: storedUrl ? 'file' : 'default',
        keyRef: service.keyRef,
        keyTitle: service.keyTitle,
        keyState: storedKey ? 'file' : envKey ? 'env' : 'none',
        keyHint: keyValue ? `…${String(keyValue).slice(-4)}` : '',
      }
    }),
  }
}

function readGatewayAuth() {
  try {
    return hasGatewayAuth(gatewayHome())
  } catch {
    return false
  }
}

function save(body) {
  const incoming = body?.updates ?? {}
  const known = new Set(SERVICES.flatMap((service) => [service.urlRef, service.keyRef]))
  const updates = new Map()

  for (const [ref, raw] of Object.entries(incoming)) {
    if (!known.has(ref)) throw new Error(`不认识的配置项：${ref}`)
    if (raw === null) {
      updates.set(ref, null)
      continue
    }
    const value = String(raw).trim()
    if (!value) continue // 空 = 保持现状
    if (ref.endsWith('_URL') && !/^https?:\/\//i.test(value)) {
      throw new Error(`${ref} 必须以 http:// 或 https:// 开头`)
    }
    if (/[\r\n]/.test(value)) throw new Error(`${ref} 不能包含换行`)
    updates.set(ref, value)
  }

  if (updates.size === 0) return { ok: true, changed: [], path: credentialsPath, note: '没有改动' }

  const result = applyRefUpdates(credentialsPath, updates)

  // TiaLink 的令牌是可选的：填了才需要给那一行带上 Authorization（home patch 覆盖块）
  let gateway = null
  if (updates.has('TIALINK_TOKEN')) {
    const enabled = Boolean(updates.get('TIALINK_TOKEN'))
    gateway = syncGatewayAuth({ dshHome: gatewayHome(), enabled })
  }

  return {
    ok: true,
    changed: result.changed,
    path: result.path,
    backup: result.backup ?? null,
    gateway,
    note:
      result.changed.length === 0
        ? '内容和现有配置一致，没有写入'
        : '已写入。约 25 秒内在 dsh 里生效，不用重启（已配置过的端点会重新握手）。',
  }
}

async function probe(body) {
  const url = String(body?.url ?? '').trim()
  const key = String(body?.key ?? '').trim()
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'URL 必须以 http:// 或 https:// 开头' }

  const result = await probeEndpoint(url, key, {
    timeoutMs: args.timeout ?? 10000,
    clientVersion: pkg.version,
  })
  if (!result.ok) return result
  return {
    ok: true,
    status: result.status,
    serverName: result.serverName,
    serverVersion: result.serverVersion,
    protocolVersion: result.protocolVersion,
    note: result.note,
  }
}

// ── 工具 ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const name = arg.slice(2)
    if (name === 'help' || name === 'print' || name === 'json' || name === 'no-open' || name === 'clear' || name === 'all') {
      options[name] = true
      continue
    }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name} 需要一个值`)
    options[name] = value
    i += 1
  }
  if (options.port !== undefined) {
    const port = Number(options.port)
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port 需要 0–65535')
    options.port = port
  }
  return options
}

function isLoopback(req) {
  const address = req.socket.remoteAddress ?? ''
  if (!(address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1')) return false
  const host = (req.headers.host ?? '').split(':')[0]
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]'
}

function respond(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(text)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 256 * 1024) {
        reject(new Error('请求体太大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new Error('请求体不是 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function openBrowser(url) {
  const platform = process.platform
  const [command, commandArgs] =
    platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  try {
    spawn(command, commandArgs, { detached: true, stdio: 'ignore' }).unref()
  } catch {
    console.log('（没能自动打开浏览器，请手动复制上面的地址）')
  }
}
