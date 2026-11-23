/**
 * TiaLink 令牌是可选的——所以 tialink 那一行默认不带 Authorization。
 *
 * 但一旦用户填了令牌（或者以后取消了），就需要让那行"带上/去掉" Authorization。
 * 做法：往 **home 级 patch**（`$DSH_HOME/cordis.patch.yml`，dsh 文档里就是给"机器级偏好"用的那一层）
 * 写一段带标记的覆盖块。home 级 patch 在 bundle 层之后应用，并且被 dsh-hmr 盯着，
 * 所以写进去之后同样约 25 秒生效、不用重启。
 *
 * 为什么不用"把令牌直接模板进 bundle 行"：缺值时 mcp-client 会进 waiting-credentials，
 * 结果连只读都连不上。网关的令牌本来只影响写入/许可功能，不能让它挡住只读。
 *
 * 这段覆盖要把整份 config 重述一遍（patch 层是整段替换，不是逐字段合并）。
 */
import fs from 'node:fs'
import path from 'node:path'

const BEGIN = '# >>> dsh-tiaforge: TiaLink 令牌（自动生成；删掉这一整段就回到"只读、不带 Authorization"）'
const END = '# <<< dsh-tiaforge: TiaLink 令牌'

/** 覆盖块的内容（整段生硬地重述 config，因为 patch 是整段替换）。 */
const BLOCK = [
  BEGIN,
  '- id: tiaforge-mcp-tialink',
  "  name: '@deepseek-ai/dsh-mcp-client'",
  '  inject:',
  '    - credentials',
  '  config:',
  '    serverName: tialink',
  '    transport: streamable-http',
  '    expandTemplates: true',
  '    url: ${credential:TIALINK_URL}',
  '    headers:',
  "      Authorization: 'Bearer ${credential:TIALINK_TOKEN}'",
  '    toolCallTimeoutMs: 600000',
  '    failOnStartupError: false',
  END,
]

/** home 级 patch 的路径：`$DSH_HOME/cordis.patch.yml`。 */
export function resolveHomePatchPath(dshHome) {
  return path.join(path.resolve(dshHome), 'cordis.patch.yml')
}

/**
 * 让 home patch 里的令牌覆盖块与"是否配置了令牌"保持一致。
 * @param {{ dshHome: string, enabled: boolean }} options
 * @returns {{ path: string, changed: boolean, backup?: string }}
 */
export function syncGatewayAuth({ dshHome, enabled }) {
  const file = resolveHomePatchPath(dshHome)
  const exists = fs.existsSync(file)
  const before = exists ? fs.readFileSync(file, 'utf8') : ''
  const after = applyBlock(before, enabled)

  if (after === before || after === null) return { path: file, changed: false }

  let backup
  if (exists) {
    backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '')}`
    fs.copyFileSync(file, backup)
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true })
  }

  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, after, 'utf8')
  fs.renameSync(tmp, file)
  return { path: file, changed: true, backup }
}

/**
 * 纯文本变换，方便测试：插入 / 移除标记块，其余字节原样保留。
 * @param {string} text - 现有文件内容。
 * @param {boolean} enabled - 是否要这段覆盖。
 * @returns {string|null} 新内容；`null` 表示"本来就一致、不用写"。
 */
export function applyBlock(text, enabled) {
  const crlf = text.includes('\r\n')
  const lines = text.length ? text.split(/\r?\n/) : []
  const start = lines.findIndex((line) => line.trim() === BEGIN)
  const end = start < 0 ? -1 : lines.findIndex((line, index) => index > start && line.trim() === END)

  const hasBlock = start >= 0 && end > start
  if (hasBlock && !enabled) {
    const next = [...lines.slice(0, start), ...lines.slice(end + 1)]
    return trimTrailingBlank(next).join(crlf ? '\r\n' : '\n')
  }
  if (hasBlock && enabled) return text // 已有且仍然需要 → 一个字节都不动
  if (!hasBlock && !enabled) return text

  // 需要插入：文件不存在时先建一个带说明的壳
  const next = [...lines]
  while (next.length && !next[next.length - 1].trim()) next.pop()
  if (!next.length) {
    next.push('# dsh home-level patch（dsh-tiaforge 写入；删掉整段标记块即回到只读）')
  }
  next.push(...BLOCK, '')
  return next.join(crlf ? '\r\n' : '\n')
}

function trimTrailingBlank(lines) {
  const next = [...lines]
  while (next.length && !next[next.length - 1].trim()) next.pop()
  return next.length ? [...next, ''] : next
}

/** 只读查询：当前 home patch 里有没有这段覆盖。 */
export function hasGatewayAuth(dshHome) {
  const file = resolveHomePatchPath(dshHome)
  if (!fs.existsSync(file)) return false
  return fs.readFileSync(file, 'utf8').includes(BEGIN)
}
