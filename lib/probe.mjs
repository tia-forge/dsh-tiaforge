/**
 * 端点探针：发一次 `initialize`，用结果分辨「Key 错 / URL 错 / 没启动」。
 *
 * 配置页（bin/setup.mjs）和对话里的工具（lib/setup-tools.mjs）共用这一份，
 * 免得两处各写一套超时与错误文案。
 */

/** 默认超时；网关/内网慢就调大。 */
const DEFAULT_TIMEOUT_MS = 10_000

/**
 * @param {string} url - MCP 端点 URL。
 * @param {string} [key] - Bearer token；没有就不带 Authorization。
 * @param {{ timeoutMs?: number, clientVersion?: string }} [options]
 * @returns {Promise<{ ok: boolean, status?: number, serverName?: string|null, serverVersion?: string|null, protocolVersion?: string|null, note?: string, error?: string, code?: string|null }>}
 */
export async function probeEndpoint(url, key, options = {}) {
  const target = String(url ?? '').trim()
  if (!/^https?:\/\//i.test(target)) {
    return { ok: false, error: 'URL 必须以 http:// 或 https:// 开头' }
  }

  const payload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'dsh-tiaforge', version: options.clientVersion ?? '0' },
    },
  }

  let response
  try {
    response = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
  } catch (error) {
    // Node 的 fetch 把真实原因藏在 cause 里；多个地址时是 AggregateError
    const cause = error?.cause
    const code = cause?.code ?? cause?.errors?.[0]?.code ?? error?.code ?? null
    return { ok: false, error: transportHint(code, cause, error), code }
  }

  const text = await response.text()
  const envelope = findJsonRpc(text)

  if (!response.ok) {
    const detail = envelope?.error?.message ?? firstLine(text)
    return {
      ok: false,
      status: response.status,
      error: `${statusHint(response.status)}${detail ? ` —— ${detail}` : ''}`,
    }
  }

  if (envelope?.error) {
    return { ok: false, status: response.status, error: `服务器报错：${envelope.error.message}` }
  }

  const info = envelope?.result?.serverInfo
  return {
    ok: true,
    status: response.status,
    serverName: info?.name ?? null,
    serverVersion: info?.version ?? null,
    protocolVersion: envelope?.result?.protocolVersion ?? null,
    note: info ? `${info.name ?? 'server'} ${info.version ?? ''}`.trim() : '握手成功',
  }
}

function statusHint(status) {
  if (status === 401) return '401：Key 无效或没带上'
  if (status === 403) return '403：Key 没有这个服务的权限'
  if (status === 404) return '404：URL 不对（少写/多写了路径？）'
  return `HTTP ${status}`
}

function transportHint(code, cause, error) {
  if (code === 'ECONNREFUSED') return '连不上：端口没在监听（网关/服务没启动？）'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '域名解析失败（检查 URL 或网络）'
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') return '连接超时（网络不通或被防火墙拦了）'
  if (/bad port/i.test(cause?.message ?? '')) return '这个端口被 fetch 禁用了（换一个端口试试）'
  return `请求失败：${cause?.message ?? error?.message ?? error}`
}

/** 从 JSON 或 SSE 响应里取出第一条 JSON-RPC 信封。 */
export function findJsonRpc(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      /* fallthrough：可能是 NDJSON / SSE */
    }
  }
  for (const line of trimmed.split(/\r?\n/)) {
    const candidate = line.startsWith('data:') ? line.slice(5).trim() : line.trim()
    if (!candidate.startsWith('{')) continue
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && (parsed.result || parsed.error)) return parsed
    } catch {
      /* 忽略零星的非 JSON 行 */
    }
  }
  return undefined
}

function firstLine(text) {
  return String(text ?? '').split(/\r?\n/)[0]?.slice(0, 200) ?? ''
}

/**
 * 把探测结果翻译成"人话结论"，特别是**内网地址连不上**这种最常见的坑。
 * @param {{ok: boolean, status?: number, code?: string|null, error?: string, note?: string}} result
 * @param {string} url
 * @returns {string} 一句话结论（不含密钥信息）
 */
export function diagnose(result, url) {
  if (result.ok) return `探测通过：${result.note ?? '握手成功'}`

  const host = safeHost(url)
  const privateHost = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|localhost$)/i.test(host)

  if (result.code === 'ECONNREFUSED') {
    return '端口拒绝连接：那台机器上没有程序在监听这个端口（网关没启动，或地址/端口写错）'
  }
  if (result.code === 'UND_ERR_CONNECT_TIMEOUT' || result.code === 'ETIMEDOUT') {
    return `连接超时：这台机器到 ${host || '该地址'} 不通` +
      (privateHost ? '（不在同一内网？防火墙没放行？网关只监听 127.0.0.1？）' : '（DNS/网络/防火墙）')
  }
  if (result.code === 'ENOTFOUND' || result.code === 'EAI_AGAIN') {
    return `主机名解析失败：${host || '该地址'} 找不到（用 IP 试试，或检查内网 DNS）`
  }
  if (result.status === 401 || result.status === 403) {
    return '连上了，但网关要求鉴权：去网关控制台复制令牌，回来说一声「复制好了」'
  }
  if (result.status === 404) {
    return '连上了，但路径不对：网关的 MCP 路径是 /mcp（例如 http://192.168.1.110:8080/mcp）'
  }
  return result.error ?? '探测失败'
}

function safeHost(url) {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}
