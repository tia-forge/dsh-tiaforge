/**
 * Key 的识别、校验与掩码。
 *
 * 只做三件事，都很保守：**认得出来才写、认不出来就说不知道、回显只给掩码**。
 * 前缀来自服务端的密钥格式（`tia_live_…` / `sim_live_…` / `lad_live_…` / `render_live_…`），
 * 所以这里按服务名做前缀匹配，而不是猜"长得像密钥"。
 */
import { SERVICES } from './refs.mjs'

/** 每个 Key 引用认的前缀；TiaLink 的 token 没有固定前缀，只能显式指定 ref 时使用。 */
const PREFIXES = new Map([
  ['TIA_DOCS_KEY', ['tia_']],
  ['TIA_SIM_KEY', ['sim_']],
  ['TIA_LAD_KEY', ['lad_']],
  ['TIA_RENDER_KEY', ['render_']],
  ['TIALINK_TOKEN', null],
])

/** 允许出现在密钥里的字符（排除空白、换行、引号，避免把 YAML/命令行写坏）。 */
const TOKEN_BODY = /^[A-Za-z0-9_.\-:/+=]+$/

const MIN_LENGTH = 12
const MAX_LENGTH = 512

/** 所有可配置的 Key 引用名。 */
export const KEY_NAMES = [...PREFIXES.keys()]

/** 引用名 → 端点服务名（给模型和日志用）。 */
export const REF_TO_SERVER = new Map(
  SERVICES.filter((service) => service.keyRef).map((service) => [service.keyRef, service.server]),
)

/**
 * 判断一个字符串能不能当某个引用的值。
 * @param ref - 引用名，例如 `TIA_DOCS_KEY`。
 * @param value - 原始值（通常是剪贴板全文）。
 * @returns 通过时 `undefined`，否则是中文原因。
 */
export function validateKey(ref, value) {
  if (!PREFIXES.has(ref)) return `不认识的配置项：${ref}`
  if (typeof value !== 'string') return '值不是文本'
  const text = value.trim()
  if (!text) return '值是空的'
  if (text.length < MIN_LENGTH) return `太短了（${text.length} 个字符），看起来不像密钥`
  if (text.length > MAX_LENGTH) return `太长了（${text.length} 个字符），是不是整段粘进来了`
  if (/[\r\n]/.test(text)) return '值里有多行，请只复制密钥本身'
  if (!TOKEN_BODY.test(text)) return '值里有空白或特殊字符，请只复制密钥本身'

  const prefixes = PREFIXES.get(ref)
  if (prefixes && !prefixes.some((prefix) => text.startsWith(prefix))) {
    return `不像 ${ref}：应以 ${prefixes.join(' 或 ')} 开头`
  }
  return undefined
}

/**
 * 从一段文本（剪贴板全文）里认出唯一一把 Key。
 * @param text - 剪贴板内容。
 * @returns `{ ref, value }`、`{ ambiguous: [...] }`，或者 `{ reason }`。
 */
export function matchKey(text) {
  const raw = typeof text === 'string' ? text : ''
  // 剪贴板常带首尾空白或换行；只在"整段就是一把 Key"时才接受
  const value = raw.trim()
  if (!value) return { reason: '剪贴板是空的' }
  if (/[\r\n]/.test(value)) return { reason: '剪贴板里有换行，请只复制密钥本身' }
  if (!TOKEN_BODY.test(value)) return { reason: '剪贴板里不像密钥（有空白或特殊字符）' }

  const hits = []
  for (const [ref, prefixes] of PREFIXES) {
    if (!prefixes) continue
    if (prefixes.some((prefix) => value.startsWith(prefix)) && !validateKey(ref, value)) hits.push(ref)
  }

  if (hits.length === 1) return { ref: hits[0], value }
  if (hits.length > 1) return { ambiguous: hits }
  return { reason: `认不出这是哪把 Key（应以 ${[...PREFIXES.values()].filter(Boolean).flat().join(' / ')} 开头）` }
}

/**
 * 回显用掩码：`sim_…ab12`。永远不返回原文。
 * @param value - 原始值。
 * @returns 掩码字符串。
 */
export function maskKey(value) {
  const text = String(value ?? '')
  if (!text) return ''
  const cut = text.indexOf('_') >= 0 ? text.slice(0, text.indexOf('_') + 1) : ''
  const tail = text.length > 4 ? text.slice(-4) : ''
  return `${cut}…${tail}`
}
