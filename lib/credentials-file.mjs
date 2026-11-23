/**
 * 直接编辑 dsh 凭据库的托管文件（`$DSH_HOME/.credentials.yaml`）。
 *
 * 为什么自己动手而不是调 ctx.credentials.set：本包要在 dsh **之外**提供设置页
 * （`npx dsh-tiaforge-setup`），那条命令没有 cords 上下文，只能改文件；
 * 而凭据库对文件有 watch（`watch: true` + 100ms 去抖），改完 25 秒内端点自己重连。
 *
 * 这个模块是**逐行**编辑的，唯一的目的是别碰别人写的东西：
 *   · 只改 refs: 分节里我们要的那几个键，其余字节原样保留（注释、records、排版、CRLF）；
 *   · 值用 JSON 字符串写（合法的 YAML 双引号标量），不用引号技巧；
 *   · 写前备份 .bak-<时间戳>，写时 tmp + rename 原子替换，权限收到 600。
 *
 * 已知不做的事：`refs: {A: b}` 这种行内映射不支持（凭据库自己永远写块形式），遇到就报错让人手改。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REFS_HEADER = /^refs:\s*(.*)$/

/** 定位凭据文件：--creds > 环境变量 > $DSH_HOME > ~/.dsh */
export function resolveCredentialsPath(explicit) {
  if (explicit) return path.resolve(explicit)
  if (process.env.TIAFORGE_CREDENTIALS) return path.resolve(process.env.TIAFORGE_CREDENTIALS)
  const home = process.env.DSH_HOME
    ? path.resolve(process.env.DSH_HOME)
    : path.join(os.homedir(), '.dsh')
  return path.join(home, '.credentials.yaml')
}

/** 从全文里取 refs: 分节的键值（只用于回显，不参与写）。 */
export function parseRefs(text) {
  const refs = new Map()
  const lines = text.split(/\r?\n/)
  const bounds = findRefsBlock(lines)
  if (!bounds) return refs

  for (const entry of parseEntries(lines, bounds.start, bounds.end)) {
    const first = lines[entry.start]
    const inline = first.slice(first.indexOf(':') + 1)
    const rest = lines.slice(entry.start + 1, entry.end)
    refs.set(entry.name, unquote([inline, ...rest].join('\n').trim()))
  }
  return refs
}

/**
 * 把 updates（Map<ref, string|null>）合进全文，返回新全文。
 * null = 删除该键；其余键一律不动。
 */
export function mergeRefs(text, updates) {
  const crlf = text.includes('\r\n')
  const lines = text.length ? text.split(/\r?\n/) : []
  const bounds = findRefsBlock(lines)

  if (!bounds) {
    if (text.trim() && !/^version:/m.test(text)) {
      throw new Error('凭据文件看起来不是 dsh 的格式（缺少 version:），拒绝改写')
    }
    const head = lines.length ? [...lines] : ['version: 1', 'records: {}']
    while (head.length && !head[head.length - 1].trim()) head.pop()
    head.push('refs:')
    for (const [name, value] of updates) {
      if (value !== null) head.push(`  ${name}: ${quote(value)}`)
    }
    head.push('')
    return head.join(crlf ? '\r\n' : '\n')
  }

  const { start, end } = bounds
  const entries = parseEntries(lines, start, end)
  const block = []
  let cursor = start

  for (const entry of entries) {
    block.push(...lines.slice(cursor, entry.start))
    const update = updates.has(entry.name) ? updates.get(entry.name) : undefined
    if (update === undefined) {
      block.push(...lines.slice(entry.start, entry.end))
    } else if (update !== null) {
      block.push(`  ${entry.name}: ${quote(update)}`)
    }
    cursor = entry.end
  }
  block.push(...lines.slice(cursor, end))

  const appended = []
  for (const [name, value] of updates) {
    if (value === null) continue
    if (entries.some((entry) => entry.name === name)) continue
    appended.push(`  ${name}: ${quote(value)}`)
  }
  if (appended.length) {
    let insertAt = block.length
    while (insertAt > 0 && !block[insertAt - 1].trim()) insertAt -= 1
    block.splice(insertAt, 0, ...appended)
  }

  const merged = [...lines.slice(0, start), ...block, ...lines.slice(end)]
  return merged.join(crlf ? '\r\n' : '\n')
}

/**
 * 落盘：备份 → 原子写 → 收权限。
 * @returns {{ path: string, backup?: string, changed: string[] }}
 */
export function applyRefUpdates(file, updates) {
  const exists = fs.existsSync(file)
  const before = exists ? fs.readFileSync(file, 'utf8') : ''
  const after = mergeRefs(before, updates)
  const changed = [...updates.keys()]

  if (exists && after === before) return { path: file, changed: [] }

  let backup
  if (exists) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '')
    backup = `${file}.bak-${stamp}`
    fs.copyFileSync(file, backup)
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true })
  }

  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, after, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, file)
  try {
    fs.chmodSync(file, 0o600)
  } catch {
    // Windows 没有 POSIX mode；凭据库自身在这里也不检查，忽略即可
  }

  return { path: file, backup, changed }
}

// ── 内部 ────────────────────────────────────────────────────────────────────

/** 找 refs: 分节的 [start, end)：start 指向分节内部第一行，end 指向下一个顶层键。 */
function findRefsBlock(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    const m = REFS_HEADER.exec(lines[i])
    if (!m) continue
    const inline = m[1].trim()
    if (inline && inline !== '{}' && inline !== '[]') {
      throw new Error(`refs: 用了行内写法（${inline}），本工具只支持块写法；请手改成块写`)
    }
    let end = i + 1
    while (end < lines.length) {
      const line = lines[end]
      if (line.trim() && !/^\s/.test(line)) break
      end += 1
    }
    return { start: i + 1, end }
  }
  return undefined
}

/** 在 [start, end) 里切出每个键的 [start, end)（含缩进更深的续行）。 */
function parseEntries(lines, start, end) {
  const entries = []
  let i = start
  while (i < end) {
    const m = /^(\s+)([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(lines[i])
    if (!m) {
      i += 1
      continue
    }
    const indent = m[1].length
    let j = i + 1
    while (j < end) {
      const line = lines[j]
      if (!line.trim()) {
        j += 1
        continue
      }
      const lineIndent = /^\s*/.exec(line)[0].length
      if (lineIndent > indent) {
        j += 1
        continue
      }
      break
    }
    // 尾部空行不属于这个键（否则会把 refs 和 records 之间的空行吃掉）
    let tail = j
    while (tail > i + 1 && !lines[tail - 1].trim()) tail -= 1
    entries.push({ name: m[2], start: i, end: tail })
    i = j
  }
  return entries
}

function quote(value) {
  return JSON.stringify(String(value))
}

function unquote(raw) {
  const value = raw.trim()
  if (!value) return ''
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value)
    } catch {
      return value.replace(/^"|"$/g, '')
    }
  }
  if (value.startsWith("'")) return value.replace(/^'|'$/g, '').replaceAll("''", "'")
  return value
}
