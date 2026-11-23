/**
 * 对话式配置（A′）：把"配 Key / 改 URL"变成对话框里的三次工具调用。
 *
 *   tiaforge_status      —— 就绪 n/5，缺哪把
 *   tiaforge_import_key  —— 从**剪贴板**认出一把 Key 并写入凭据库（Key 不进对话）
 *   tiaforge_import_env  —— 从环境变量 / .env 里搬值进凭据库（Key 不进对话）
 *   tiaforge_set_key     —— 用户坚持直接贴时使用，默认不注册（TIAFORGE_DIRECT_INPUT=1 才开）
 *
 * 安全纪律（工具描述里也写了，模型必须遵守）：
 *   · 只有用户明确说"我复制好了"之后才读剪贴板；
 *   · 任何返回值只给掩码，绝不回显原文；
 *   · 写不进去就说清楚退路（手改文件 / 打开配置页）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { readClipboard } from './clipboard.mjs'
import { syncGatewayAuth } from './gateway-patch.mjs'
import { KEY_NAMES, maskKey, matchKey, REF_TO_SERVER, validateKey } from './keys.mjs'
import { diagnose, probeEndpoint } from './probe.mjs'
import { SERVICES } from './refs.mjs'

/** 输出统一带一句 `summary`，其余字段给界面/日志用。 */
const OUTPUT = {
  type: 'object',
  additionalProperties: true,
  properties: { summary: { type: 'string' } },
  required: ['summary'],
}

const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false }

/**
 * 造一组工具定义（不依赖 @deepseek-ai/dsh-tools：直接给它编译好的 JSON Schema 形态）。
 * @param {{
 *   credentials: { resolve(ref: string): Promise<{value?: string, source?: string}|undefined>,
 *                  describe(ref: string): Promise<{configured: boolean, source?: string}|undefined>,
 *                  set(ref: string, value: string): Promise<void> },
 *   version?: string,
 *   readClipboard?: () => Promise<string>,
 *   probe?: typeof probeEndpoint,
 *   env?: Record<string, string | undefined>,
 *   cwd?: string,
 *   dshHome?: string,
 *   allowDirectInput?: boolean,
 * }} deps
 * @returns {object[]} 可直接交给 ctx.tools.register 的定义
 */
export function buildSetupTools(deps) {
  const {
    credentials,
    version = '0',
    readClipboard: readClip = readClipboard,
    probe = probeEndpoint,
    env = process.env,
    cwd = process.cwd(),
    dshHome = env.DSH_HOME ? env.DSH_HOME : join(homedir(), '.dsh'),
    allowDirectInput = env.TIAFORGE_DIRECT_INPUT === '1',
  } = deps

  const serviceOf = (keyRef) => SERVICES.find((service) => service.keyRef === keyRef)
  const summaryLine = (items) =>
    items.map((item) => `${item.server}: ${item.configured ? '已配置' : '未配置'}`).join('；')

  async function describeAll() {
    const rows = []
    for (const service of SERVICES) {
      let configured = false
      let source
      try {
        const info = await credentials.describe(service.keyRef)
        configured = Boolean(info?.configured)
        source = info?.source
      } catch {
        /* 描述失败按未配置处理，具体原因由下一步暴露 */
      }
      let url = service.defaultUrl
      let urlSource = 'default'
      try {
        const resolved = await credentials.resolve(service.urlRef)
        if (resolved?.value) {
          url = resolved.value
          urlSource = resolved.source ?? 'credential'
        }
      } catch {
        /* 用默认值展示，并在 urlSource 里标明 */
      }

      // ready / hint 是给模型直接照抄的：别让它自己推断"没配令牌到底能不能用"
      const ready = configured || Boolean(service.optional)
      const hint = configured
        ? '已配置。'
        : service.optional
          ? `令牌未配置。令牌只管网关鉴权（网关开了鉴权才回 401，那时去网关控制台复制）；`
            + '能不能写工程由那台机器的许可决定，与令牌无关。不要调用它的工具去验证。'
          : `缺 Key：让用户去 ${service.dashboard ?? '控制台'} 点「复制」，再调 tiaforge_import_key。`

      rows.push({
        server: service.server,
        keyRef: service.keyRef,
        configured,
        optional: Boolean(service.optional),
        ready,
        hint,
        source: source ?? null,
        url,
        urlSource,
        billing: service.billing ?? null,
      })
    }
    return rows
  }

  async function writeKey(keyRef, value) {
    const problem = validateKey(keyRef, value)
    if (problem) throw new Error(problem)

    await credentials.set(keyRef, value)

    // 网关令牌是可选的：只有填了才需要给 tialink 行带上 Authorization
    let gateway = null
    if (keyRef === 'TIALINK_TOKEN') {
      try {
        gateway = syncGatewayAuth({ dshHome, enabled: true })
      } catch (error) {
        gateway = { changed: false, error: error?.message ?? String(error) }
      }
    }

    const service = serviceOf(keyRef)
    const out = {
      summary: `已把 ${keyRef} 写入凭据库（${maskKey(value)}），约 25 秒内生效，不用重启 dsh。`,
      ref: keyRef,
      masked: maskKey(value),
      probe: null,
    }

    if (gateway?.changed) out.summary += ` 已给 tialink 那行加上 Authorization（${gateway.path}）。`
    else if (gateway?.error) out.summary += ` 但没能更新 home patch：${gateway.error}`

    if (service) {
      let url = service.defaultUrl
      try {
        const resolved = await credentials.resolve(service.urlRef)
        if (resolved?.value) url = resolved.value
      } catch {
        /* 用默认 URL 探测 */
      }
      const result = await probe(url, value, { clientVersion: version })
      out.probe = {
        ok: Boolean(result.ok),
        status: result.status ?? null,
        serverName: result.serverName ?? null,
        error: result.error ?? null,
      }
      out.summary += result.ok
        ? ` 测试连接通过（${result.note ?? `HTTP ${result.status}`}）。`
        : ` 但测试连接没通过：${result.error}`
    }

    return out
  }

  const tools = [
    {
      name: 'tiaforge_status',
      description:
        'List which TIA Forge MCP endpoints are configured and which are missing, plus a ready-made `next` line to say to the user. '
        + 'Call this ONCE, then act on `next` — do not grep files, curl endpoints, or ask multi-choice questions instead. '
        + 'When the user names one endpoint (for example "配置 tialink"), answer from this result in two lines: '
        + 'whether it already works, and the single thing left to do.',
      parameters: NO_ARGS,
      output: {
        schema: OUTPUT,
        render: (_args, value) => [{ type: 'text', text: value.summary }],
      },
      async execute() {
        const rows = await describeAll()
        const readyCount = rows.filter((row) => row.ready).length
        const blocked = rows.filter((row) => !row.ready)
        const labeled = (row) => `${row.server}（${row.keyRef}${row.optional ? '，可选' : ''}）`

        const summary = blocked.length
          ? `就绪 ${readyCount}/${rows.length}。还缺：${blocked.map(labeled).join('、')}`
          : `就绪 ${readyCount}/${rows.length}：需要的都齐了。`

        const next = blocked.length
          ? `下一步：只问 ${blocked[0].server} 这一把——让用户去控制台点「复制」，回来说一声，再调 tiaforge_import_key。`
          : '下一步：不用再问 Key。'

        // say = 可以直接复述给用户的成品话术（避免模型自己组织"只读/令牌/许可"这类事实句）
        const tialink = rows.find((row) => row.server === 'tialink')
        const gateway = tialink
          ? `TiaLink 端点：${tialink.url}` +
            (tialink.configured
              ? '（已配置令牌）。'
              : '。令牌只用于网关鉴权——网关开了鉴权才会回 401，那时去网关控制台复制；能不能写工程由那台机器的许可决定，与令牌无关。') +
            (tialink.urlSource === 'default' ? '（这个地址是内置默认值，要换请在对话里告诉我新的地址。）' : '')
          : ''

        const blocking = blocked.filter((row) => !row.optional)
        const say = blocking.length
          ? `${gateway}${gateway ? ' ' : ''}还缺：${blocking.map((row) => `${row.server}（${row.keyRef}）`).join('、')}——去对应控制台点「复制」，回来说一声我来导入。`
            + ` 计费口径：${blocking.map((row) => `${row.server}）`.replace('）', '：' + (row.billing ?? '未标注'))).join('；')}`
          : `${gateway}${gateway ? ' ' : ''}需要的都齐了。`

        return { summary, next, say, ready: readyCount, total: rows.length, services: rows }
      },
    },
    {
      name: 'tiaforge_import_key',
      description:
        'Import ONE TIA Forge API key from the system clipboard into the credential store, then test the endpoint. '
        + 'ONLY call this right after the user says they copied their key (for example "我复制好了" / "copied it"). '
        + 'Never ask the user to paste a key into the chat. Never echo the key back; the result carries only a mask. '
        + 'If the clipboard does not look like a TIA Forge key, tell the user to copy it again — do not guess. '
        + 'TiaLink gateway tokens carry no recognizable prefix, so pass ref: "TIALINK_TOKEN" explicitly when importing one.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ref: {
            type: 'string',
            enum: KEY_NAMES,
            description: 'Which slot the clipboard key belongs to. Omit to let the tool detect it from the key prefix.',
          },
        },
      },
      output: {
        schema: OUTPUT,
        render: (_args, value) => [{ type: 'text', text: value.summary }],
      },
      async execute(args) {
        const wanted = typeof args?.ref === 'string' ? args.ref : undefined
        if (wanted && !KEY_NAMES.includes(wanted)) throw new Error(`不认识的配置项：${wanted}`)

        const raw = String(await readClip()).trim()
        const match = matchKey(raw)

        // 显式给了 ref 就按它走：TiaLink 网关令牌没有前缀，只靠 matchKey 认不出来
        if (wanted) {
          if (match.ref && match.ref !== wanted) {
            throw new Error(`剪贴板里是 ${match.ref} 的 Key，不是 ${wanted}。`)
          }
          return writeKey(wanted, raw)
        }

        if (match.reason) {
          throw new Error(`${match.reason}。请回控制台点一次「复制」，再让我读剪贴板。`)
        }
        if (match.ambiguous) {
          throw new Error(
            `剪贴板里的 Key 同时像 ${match.ambiguous.join(' / ')}，请告诉我是哪一个，或用配置页手动填。`,
          )
        }

        return writeKey(match.ref, match.value ?? raw)
      },
    },
    {
      name: 'tiaforge_set_endpoint',
      description:
        'Point ONE TIA Forge endpoint at a different URL (another machine on the LAN, a proxy, a self-hosted gateway). '
        + 'Writes the credential reference the patch row reads, which the credential store picks up live (about 25 seconds, no restart). '
        + 'Use this instead of editing .credentials.yaml or reading the plugin source. '
        + 'Validate nothing yourself: the tool checks the URL and reports the endpoint it stored.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          server: {
            type: 'string',
            enum: SERVICES.map((service) => service.server),
            description: 'Which endpoint, e.g. "tialink" or "tia-docs".',
          },
          url: { type: 'string', description: 'Full MCP endpoint URL, including the /mcp path.' },
        },
        required: ['server', 'url'],
      },
      output: {
        schema: OUTPUT,
        render: (_args, value) => [{ type: 'text', text: value.summary }],
      },
      async execute(args) {
        const server = String(args?.server ?? '')
        const url = String(args?.url ?? '').trim()
        const service = SERVICES.find((item) => item.server === server)
        if (!service) throw new Error(`不认识的端点：${server}（可选：${SERVICES.map((item) => item.server).join('、')}）`)
        if (!/^https?:\/\//i.test(url)) throw new Error('URL 必须以 http:// 或 https:// 开头')
        if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('URL 里不能有空白')
        await credentials.set(service.urlRef, url)

        // 写完立刻探一次：让用户当场知道"这个地址到底通不通"，而不是等 25 秒后自己看工具
        const result = await probe(url, undefined, { clientVersion: version, timeoutMs: 6000 })
        const verdict = diagnose(result, url)

        return {
          summary:
            `已把 ${server} 的地址改成 ${url}（写进凭据库 ${service.urlRef}，约 25 秒内自动重连，不用重启 dsh）。`
            + ` 立刻探测：${verdict}`
            + (result.ok || result.status ? '' : ' 地址先留着；把网关/网络弄通后我随时再探一次。'),
          server,
          url,
          ref: service.urlRef,
          probe: { ok: Boolean(result.ok), status: result.status ?? null, code: result.code ?? null, verdict },
        }
      },
    },
    {
      name: 'tiaforge_import_env',
      description:
        'Import TIA Forge keys from the machine environment or .env files into the credential store, so the user does not '
        + 'have to paste anything into the chat. Reads TIA_*_KEY / TIALINK_TOKEN from the process environment, '
        + 'the project .env and $DSH_HOME/.env. Call it after the user says they put the key in a .env file, or to pick up '
        + 'exported variables. Never returns key values, only masks.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          refs: {
            type: 'array',
            items: { type: 'string', enum: KEY_NAMES },
            description: 'Only import these slots. Omit to import every slot that has a value.',
          },
        },
      },
      output: {
        schema: OUTPUT,
        render: (_args, value) => [{ type: 'text', text: value.summary }],
      },
      async execute(args) {
        const wanted = Array.isArray(args?.refs) && args.refs.length ? args.refs : KEY_NAMES
        const sources = [
          { label: '环境变量', values: env },
          { label: `${cwd}/.env`, values: readDotEnv(join(cwd, '.env')) },
          { label: `${dshHome}/.env`, values: readDotEnv(join(dshHome, '.env')) },
        ]

        const imported = []
        const invalid = []
        for (const ref of wanted) {
          if (!KEY_NAMES.includes(ref)) continue
          for (const source of sources) {
            const raw = source.values?.[ref]
            if (!raw) continue
            const problem = validateKey(ref, raw)
            if (problem) {
              invalid.push(`${ref}（来自${source.label}）：${problem}`)
              break
            }
            await credentials.set(ref, raw.trim())
            imported.push({ ref, masked: maskKey(raw.trim()), source: source.label })
            break
          }
        }

        const parts = []
        parts.push(
          imported.length
            ? `已从本机导入 ${imported.length} 把：${imported.map((item) => `${item.ref}(${item.masked}，来自${item.source})`).join('、')}`
            : '本机环境与 .env 里没有可导入的 TIA Forge Key。',
        )
        if (invalid.length) parts.push(`跳过：${invalid.join('；')}`)
        parts.push('约 25 秒内生效，不用重启 dsh。')

        return {
          summary: parts.join(' '),
          imported,
          invalid,
          slots: (await describeAll()).map((row) => `${row.server}:${row.configured ? 'ok' : 'missing'}`).join(','),
        }
      },
    },
  ]

  if (allowDirectInput) {
    tools.push({
      name: 'tiaforge_set_key',
      description:
        'Store ONE TIA Forge key the user pasted into the chat. This puts the key in the session transcript, so only use it '
        + 'when the user insists on pasting a key instead of copying it while tiaforge_import_key reads the clipboard. '
        + 'Never echo the key back; the result carries only a mask.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ref: { type: 'string', enum: KEY_NAMES, description: 'Which slot this key belongs to.' },
          value: { type: 'string', description: 'The key exactly as the user pasted it.' },
        },
        required: ['ref'],
      },
      output: {
        schema: OUTPUT,
        render: (_args, value) => [{ type: 'text', text: value.summary }],
      },
      async execute(args) {
        const ref = String(args?.ref ?? '')
        const value = String(args?.value ?? '').trim()
        if (!value) {
          throw new Error('没收到 Key 的值。请让用户重新复制一次，或改用 tiaforge_import_key 读剪贴板。')
        }
        const result = await writeKey(ref, value)
        return { ...result, summary: `${result.summary}（注意：这把 Key 已进入会话记录，介意的话去控制台换一把。）` }
      },
    })
  }

  return tools
}

/** 读 `.env`：只认 `KEY=VALUE`，忽略注释与空行，去掉成对引号。 */
export function readDotEnv(file) {
  if (!existsSync(file)) return {}
  const values = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (value) values[key] = value
  }
  return values
}

export { REF_TO_SERVER }
