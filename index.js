/**
 * dsh-tiaforge —— 把 TIA Forge 的五个技能与五个 MCP 端点接进 DeepSeek Harness。
 *
 * 技能：读取包内 `skills/<name>/SKILL.md`，在插件 apply 阶段注册进 ctx.skills。
 *       走"嵌入式插件数据"这条路，不依赖用户把文件拷到 .dsh/skills。
 * MCP： 由 cordis.patch.yml 里的 @deepseek-ai/dsh-mcp-client 行负责，本文件不碰连接。
 *
 * 本文件负责的是"配置面"（0.4.0 起，0.5.0 加了设置入口）：
 *   ① 五个端点 URL 的 Config 字段（volatile）——DSH 的配置界面改的就是这里；
 *   ② 把"生效 URL"同步进凭据库（凭据库 watch 着文件，改完约 25 秒重连，不用重启）；
 *   ③ 打印"端点就绪 n/5 + 缺哪把 Key + 去哪配"。
 *
 * 密钥**不进 Config**：DSH 的配置会落到 profile 的 cordis.patch.yml（明文），
 * 而 dsh 自己的规矩也是"配置只写引用，密钥进凭据库"。所以 Key 的写入口是
 * `npx dsh-tiaforge-setup`（本机回环页）或直接编辑 .credentials.yaml。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import z from '@deepseek-ai/schemastery'

// 端点与引用名的唯一真源（setup 页与回归测试读同一份）
import { SERVICES } from './lib/refs.mjs'
import { buildSetupTools } from './lib/setup-tools.mjs'

export const name = 'tiaforge-skills'

// 技能注册表的服务名；不声明 inject 的话 rc.5 会直接拒绝访问 ctx.skills
// （"cannot get property \"skills\" without inject"），六个技能全部静默丢失。
export const inject = ['skills']

/**
 * 五个端点 URL。标 `.volatile()` 才能被 DSH 的配置界面编辑（设置表单只投影 volatile 字段），
 * 标了之后 loader 会就地把新值提交进运行时引用，不需要重挂载插件。
 */
export const Config = z.object(
  Object.fromEntries(
    SERVICES.map((service) => [
      service.urlField,
      z
        .string()
        .default(service.defaultUrl)
        .description(`${service.title}：${service.summary}（默认 ${service.defaultUrl}）`)
        .volatile(),
    ]),
  ),
)

const HERE = dirname(fileURLToPath(import.meta.url))
const SKILLS_DIR = join(HERE, 'skills')
const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8')).version
  } catch {
    return '0'
  }
})()

/** 只用 stderr：headless / sdk / acp profile 的 stdout 是协议通道，不能碰。 */
const log = {
  info: (text) => process.stderr.write(`[tiaforge] ${text}\n`),
  warn: (text) => process.stderr.write(`[tiaforge] ${text}\n`),
}

/** 极简 frontmatter 解析：只取顶层 `key: value`，够用且不引入依赖。 */
function parseFrontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (!m) return { data: {}, body: raw }
  const data = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!kv) continue
    let value = kv[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    data[kv[1]] = value
  }
  return { data, body: m[2] }
}

export function apply(ctx, config) {
  registerSkills(ctx, log)

  // credentials 是可选依赖：没有它时（极简自制 profile）技能照旧注册，
  // 端点行会因为没有凭据提供方而报错，README 里写明了这条前提。
  if (typeof ctx.inject !== 'function') return

  // volatile 字段被设置界面改写后，loader 会就地更新引用，再在**插件自己的 ctx**上发这个事件。
  // （注册在子 ctx 上收不到：cordis 的事件只向父级冒泡。）
  // 读值时也不缓存 apply 时的快照：fiber.effectiveConfig 才是当前生效的那份。
  const liveConfig = () => ctx.fiber?.effectiveConfig ?? config
  let credentials
  const sync = (reason) => {
    if (!credentials) return Promise.resolve()
    return syncUrls(credentials, log, urlPlan(liveConfig()), reason).catch((error) =>
      log.warn(`凭据同步失败：${error?.message ?? error}`),
    )
  }

  ctx.inject(['credentials'], (scoped) => {
    credentials = scoped.credentials
    sync('boot')
      .then(() => reportReady(credentials, log))
      .catch((error) => log.warn(`凭据同步失败：${error?.message ?? error}`))
  })

  // 对话式配置（A′）：把"配 Key"变成对话框里的工具调用，Key 从剪贴板/环境进凭据库。
  // TIAFORGE_TOOLS=0 可以整机关掉（企业环境）。
  if (process.env.TIAFORGE_TOOLS !== '0') {
    ctx.inject(['tools', 'credentials'], (scoped) => {
      let disposers = []
      try {
        const tools = buildSetupTools({ credentials: scoped.credentials, version: VERSION })
        disposers = tools.map((tool) => scoped.tools.register(tool))
        const live = tools.map((tool) => tool.name).filter((name) => scoped.tools.get?.(name) !== undefined)
        log.info(`已注册对话式配置工具：${live.join(', ')}`)
      } catch (error) {
        log.warn(`注册配置工具失败：${error?.message ?? error}`)
        return
      }
      ctx.effect?.(() => disposers)
    })
  }

  ctx.on?.('loader/volatile-update', () => {
    log.info('检测到配置更新，重新同步端点 URL')
    sync('volatile')
  })
}

/**
 * 算出"每个端点最终该用哪个 URL"，以及它是**显式覆盖**还是缺省值。
 *
 * 取值顺序：Config 字段（改了才算）> 凭据库文件里已有的值 > schema 缺省值。
 * 也就是说：在配置界面把 URL 改回默认字符串，等于取消覆盖（凭据库里的旧自定义值会留下）。
 */
function urlPlan(config) {
  return SERVICES.map((service) => {
    const configured = readField(config?.[service.urlField], '')
    const explicit = configured !== '' && configured !== service.defaultUrl
    return {
      ref: service.urlRef,
      explicit,
      value: explicit ? configured : service.defaultUrl,
    }
  })
}

function readField(field, fallback) {
  const value = typeof field?.get === 'function' ? field.get() : field
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

/** 把生效 URL 写进凭据库；已有值且没有显式覆盖时不动它。 */
async function syncUrls(credentials, log, plan, reason) {
  if (!credentials?.resolve || !credentials?.set) {
    log.warn('凭据服务不可用，跳过 URL 同步（端点会停在 waiting-credentials）')
    return
  }

  let seeded = 0
  let overridden = 0
  for (const { ref, value, explicit } of plan) {
    let current
    try {
      current = await credentials.resolve(ref)
    } catch (error) {
      log.warn(`读取 ${ref} 失败：${error?.message ?? error}`)
      continue
    }
    if (current?.value === value) continue
    if (current && !explicit) continue // 文件里的值优先，别拿缺省值盖掉用户的自定义
    try {
      await credentials.set(ref, value)
      if (current) overridden += 1
      else seeded += 1
    } catch (error) {
      log.warn(`写入 ${ref} 失败：${error?.message ?? error}`)
    }
  }

  if (seeded > 0) log.info(`已播种 ${seeded} 个端点 URL 到凭据库（可在配置界面或 setup 页改）`)
  if (overridden > 0) log.info(`配置覆盖了 ${overridden} 个端点 URL，已同步进凭据库${reason === 'volatile' ? '（设置界面）' : ''}`)
}

/** 报告"端点就绪 n/5 + 缺哪把 Key + 去哪配"。 */
async function reportReady(credentials, log) {
  if (!credentials?.describe) return

  const ready = []
  const missing = []
  for (const service of SERVICES) {
    let configured = false
    try {
      configured = Boolean((await credentials.describe(service.keyRef))?.configured)
    } catch (error) {
      log.warn(`读取 ${service.keyRef} 状态失败：${error?.message ?? error}`)
    }
    ;(configured ? ready : missing).push({
      serverName: service.server,
      ref: service.keyRef,
      optional: Boolean(service.optional),
    })
  }

  const summary = `端点就绪 ${ready.length}/${SERVICES.length}`
  if (missing.length === 0) {
    log.info(`${summary}：五个端点全部已配置`)
    return
  }

  const required = missing.filter((item) => !item.optional)
  const optional = missing.filter((item) => item.optional)
  const names = [
    ...required.map((item) => `${item.serverName}(${item.ref})`),
    ...optional.map((item) => `${item.serverName}(${item.ref}，可选)`),
  ].join(' ')

  log.info(
    `${summary}；未配置：${names} —— 缺 Key 的云端端点不会注册工具，也不打 401。` +
      (optional.length && !required.length ? 'tialink 的令牌只用于网关鉴权，能不能写由那台机器的许可决定。' : '') +
      '跑 `npx dsh-tiaforge-setup` 或直接跟 AI 说「配一下」（保存后约 25 秒生效，不用重启）。',
  )
}

/** 注册完再取一次正文：注册成功≠能加载，dsh 的校验在取的时候才做。 */
function afterRegister(ctx, log, selfCheck) {
  setTimeout(() => {
    if (!selfCheck.length) return
    Promise.all(
      selfCheck.map(async ({ name, promise }) => {
        try {
          const definition = await promise
          return { name, ok: Boolean(definition?.content), reason: definition ? '正文为空' : '取不到' }
        } catch (error) {
          return { name, ok: false, reason: error?.message ?? String(error) }
        }
      }),
    )
      .then((results) => {
        const bad = results.filter((result) => !result.ok)
        if (!bad.length) {
          log.info(`技能自检通过 ${results.length}/${results.length}`)
          return
        }
        for (const item of bad) log.warn(`技能「${item.name}」加载失败：${item.reason}`)
      })
      .catch(() => {})
  }, 1500)
}

function registerSkills(ctx, log) {
  const selfCheck = []
  afterRegister(ctx, log, selfCheck)

  if (!existsSync(SKILLS_DIR)) {
    log.warn(`找不到技能目录: ${SKILLS_DIR}`)
    return
  }

  for (const entry of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = join(SKILLS_DIR, entry.name, 'SKILL.md')
    if (!existsSync(file)) continue

    try {
      const raw = readFileSync(file, 'utf8')
      const { data, body } = parseFrontmatter(raw)
      const skillName = data.name || entry.name
      const description = data.description || data.summary || ''

      if (!description) {
        log.warn(`${entry.name}: 缺少 description，跳过`)
        continue
      }

      const dispose = ctx.skills.register({
        name: skillName,
        description,
        whenToUse: data.whenToUse,
        // dsh 的技能加载器会校验 source 必须是字符串（缺了就是
        // `loaded skill "x" source must be a string`，而且是**加载时**才炸，注册时不报错）
        source: 'runtime',
        path: file,
        // 让 SKILL.md 里引用的相对资源（README.txt、scripts/*）能解析到
        resourceBase: { kind: 'directory', path: dirname(file) },
        content: body,
        metadata: { publisher: '汇智网 (hubwiz.com)', homepage: data.homepage },
      })

      // 注册在 apply 期间完成；dispose 交给 Cordis 的 effect 生命周期管理
      ctx.effect?.(() => dispose)
      selfCheck.push({ name: skillName, promise: Promise.resolve().then(() => ctx.skills.get?.(skillName)) })
    } catch (error) {
      log.warn(`载入 ${entry.name} 失败: ${error?.message ?? error}`)
    }
  }
}
