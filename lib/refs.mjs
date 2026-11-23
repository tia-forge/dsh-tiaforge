/**
 * 五个端点的唯一真源（插件、setup 页、回归测试都读这一份）。
 *
 * 每条对应 cordis.patch.yml 里的一行 dsh-mcp-client：
 *   server    —— serverName（工具名前缀 mcp__<server>__…）
 *   rowId     —— cordis.patch.yml 里那一行的 id
 *   urlField  —— 插件 Config 里的字段名（DSH 设置/配置页改 URL 就是改它）
 *   urlRef    —— 端点 URL 的凭据引用名（缺省值由插件首次启动播种）
 *   keyRef    —— 那行 headers.Authorization 引用的 Key；没有它 = waiting-credentials
 *   authHeader —— 这一行要不要在 cordis.patch.yml 里带 Authorization。
 *                 TiaLink 是 false：网关令牌可选，带上反而会让"没令牌"变成 waiting-credentials（连只读都连不上）
 *
 * 改这里的 ref 名，必须同步改 cordis.patch.yml —— test/patch-consistency.mjs 会盯着。
 */
export const SERVICES = [
  {
    server: 'tialink',
    rowId: 'tiaforge-mcp-tialink',
    title: 'TiaLink 本机网关',
    summary: '博途同机的 Openness 网关；令牌用于网关鉴权，能不能写由那台机器的许可决定',
    urlField: 'tialinkUrl',
    urlRef: 'TIALINK_URL',
    defaultUrl: 'http://127.0.0.1:8080/mcp',
    keyRef: 'TIALINK_TOKEN',
    billing: '网关按许可收费（¥99/月），与调用次数无关；能不能写由许可决定',
    keyTitle: '网关令牌（鉴权用；能不能写由许可决定）',
    authHeader: false,
    optional: true,
  },
  {
    server: 'tia-docs',
    rowId: 'tiaforge-mcp-docs',
    title: '博途编程文档检索',
    summary: '2800+ 章节，get_docs',
    urlField: 'docsUrl',
    urlRef: 'TIA_DOCS_URL',
    defaultUrl: 'https://tia.hubwiz.com/ai-coding-docs/mcp',
    keyRef: 'TIA_DOCS_KEY',
    billing: '新用户 100 次免费，每次调用扣 1 次额度',
    authHeader: true,
    keyTitle: 'API Key',
    dashboard: 'https://tia.hubwiz.com/ai-coding-docs/dashboard',
  },
  {
    server: 'plc-sim',
    rowId: 'tiaforge-mcp-sim',
    title: 'PLC 云仿真',
    summary: '逐扫描仿真 + 场景 PASS/FAIL',
    urlField: 'simUrl',
    urlRef: 'TIA_SIM_URL',
    defaultUrl: 'https://tia.hubwiz.com/sim/mcp',
    keyRef: 'TIA_SIM_KEY',
    billing: '新用户 100 次免费，每次调用扣 1 次额度',
    authHeader: true,
    keyTitle: 'API Key',
    dashboard: 'https://tia.hubwiz.com/sim/dashboard',
  },
  {
    server: 'laddoc',
    rowId: 'tiaforge-mcp-laddoc',
    title: 'LadDoc Cloud',
    summary: '梯形图 JSON → 博途可导入 SimaticML',
    urlField: 'ladUrl',
    urlRef: 'TIA_LAD_URL',
    defaultUrl: 'https://tia.hubwiz.com/lad/mcp',
    keyRef: 'TIA_LAD_KEY',
    billing: '新用户 100 次免费，每次调用扣 1 次额度',
    authHeader: true,
    keyTitle: 'API Key',
    dashboard: 'https://tia.hubwiz.com/lad/dashboard',
  },
  {
    server: 'lad-render',
    rowId: 'tiaforge-mcp-render',
    title: '梯形图渲染（计费）',
    summary: 'SimaticML → PNG；render_simaticml 每次扣 1 次',
    urlField: 'renderUrl',
    urlRef: 'TIA_RENDER_URL',
    defaultUrl: 'https://tia.hubwiz.com/render/mcp',
    keyRef: 'TIA_RENDER_KEY',
    billing: '新用户 100 次免费，每次调用扣 1 次额度',
    authHeader: true,
    keyTitle: 'API Key',
    dashboard: 'https://tia.hubwiz.com/render/dashboard',
  },
]

/** 所有 URL 引用（含缺省值），插件用它播种。 */
export const URL_REFS = SERVICES.map((service) => [service.urlRef, service.defaultUrl])

/** 所有 Key 引用 + 对应端点名，插件用它算"就绪 n/5"。 */
export const KEY_REFS = SERVICES.map((service) => [service.keyRef, service.server])
