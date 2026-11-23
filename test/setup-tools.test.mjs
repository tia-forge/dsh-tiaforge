/**
 * 对话式配置工具：写入、掩码、来源识别、开关。
 *
 * 这里用假的凭据服务/剪贴板/探针跑真代码，不需要 dsh 进程。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { buildSetupTools, readDotEnv } from '../lib/setup-tools.mjs'

const docsKey = 'tia_live_0123456789abcdef0123456789abcdef'
const simKey = 'sim_live_aaaabbbbccccddddeeeeffff00001111'

function fakeCredentials(initial = {}) {
  const store = new Map(Object.entries(initial))
  const writes = []
  return {
    writes,
    store,
    async resolve(ref) {
      const value = store.get(ref)
      return value ? { value, source: 'file' } : undefined
    },
    async describe(ref) {
      const value = store.get(ref)
      return value ? { configured: true, source: 'file' } : { configured: false }
    },
    async set(ref, value) {
      writes.push([ref, value])
      store.set(ref, value)
    },
  }
}

const okProbe = async () => ({ ok: true, status: 200, serverName: 'stub', serverVersion: '1', note: 'stub 1' })

function tools(overrides = {}) {
  const credentials = overrides.credentials ?? fakeCredentials()
  const built = buildSetupTools({
    credentials,
    version: 'test',
    readClipboard: overrides.readClipboard ?? (async () => docsKey),
    probe: overrides.probe ?? okProbe,
    env: overrides.env ?? {},
    cwd: overrides.cwd ?? os.tmpdir(),
    dshHome: overrides.dshHome ?? os.tmpdir(),
    allowDirectInput: overrides.allowDirectInput ?? false,
  })
  return { tools: built, byName: Object.fromEntries(built.map((tool) => [tool.name, tool])), credentials }
}

test('默认注册三个工具，直接贴 Key 的那个要显式打开', () => {
  const { tools: list } = tools()
  assert.deepEqual(list.map((tool) => tool.name).sort(), [
    'tiaforge_import_env',
    'tiaforge_import_key',
    'tiaforge_set_endpoint',
    'tiaforge_status',
  ])
  const direct = tools({ allowDirectInput: true }).tools.map((tool) => tool.name)
  assert.ok(direct.includes('tiaforge_set_key'))
})

test('status：只报就绪度，不碰密钥值', async () => {
  const credentials = fakeCredentials({ TIA_DOCS_KEY: docsKey })
  const { byName } = tools({ credentials })
  const value = await byName.tiaforge_status.execute({})

  // tialink 不阻塞就绪（令牌只影响鉴权）→ ready = docsKey + tialink = 2
  assert.equal(value.ready, 2)
  assert.equal(value.total, 5)
  assert.match(value.summary, /2\/5/)
  // 给模型直接照抄的下一步，别让它自己推断
  assert.match(value.next, /tiaforge_import_key/)
  const tialink = value.services.find((row) => row.server === 'tialink')
  // 令牌=鉴权；读写=那台机器的许可。这两件事不许混成一句"只读不需要令牌"
  assert.match(tialink.hint, /令牌只管网关鉴权/)
  assert.match(tialink.hint, /许可/)
  // say 是给模型照抄的成品话术，必须带实际地址、且不出现"只读/令牌"的错误因果
  assert.match(value.say, /TiaLink 端点/)
  assert.equal(/只读/.test(value.say), false, 'say 里不该出现"只读"这种因果句')
  assert.equal(tialink.optional, true)
  assert.equal(JSON.stringify(value).includes(docsKey), false, 'status 回执里出现了 Key 原文')
})

test('import_key：从剪贴板认出一把就写进去，回执只有掩码', async () => {
  const { byName, credentials } = tools({ readClipboard: async () => `  ${docsKey}\n` })
  const value = await byName.tiaforge_import_key.execute({})

  assert.equal(credentials.store.get('TIA_DOCS_KEY'), docsKey)
  assert.equal(value.ref, 'TIA_DOCS_KEY')
  assert.equal(value.probe.ok, true)
  assert.match(value.summary, /约 25 秒内生效/)
  assert.equal(JSON.stringify(value).includes(docsKey), false, '回执里出现了 Key 原文')
})

test('import_key：剪贴板里是别的服务的 Key，就别硬塞', async () => {
  const { byName, credentials } = tools({ readClipboard: async () => simKey })
  await assert.rejects(() => byName.tiaforge_import_key.execute({ ref: 'TIA_DOCS_KEY' }), /不是 TIA_DOCS_KEY/)
  assert.equal(credentials.writes.length, 0)
})

test('import_key：剪贴板不像密钥就报原因，不写任何东西', async () => {
  const { byName, credentials } = tools({ readClipboard: async () => '这是我的密码 hunter2' })
  await assert.rejects(() => byName.tiaforge_import_key.execute({}), /不像密钥|空白|特殊字符/)
  assert.equal(credentials.writes.length, 0)
})

test('import_key：探针失败要说出来，但 Key 已经写进去了', async () => {
  const failing = async () => ({ ok: false, status: 401, error: '401：Key 无效或没带上' })
  const { byName, credentials } = tools({ probe: failing })
  const value = await byName.tiaforge_import_key.execute({})

  assert.equal(credentials.store.get('TIA_DOCS_KEY'), docsKey)
  assert.match(value.summary, /测试连接没通过/)
  assert.equal(value.probe.status, 401)
})

test('import_env：环境变量与 .env 都能搬，且支持只挑某个 ref', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiaforge-env-'))
  fs.writeFileSync(path.join(dir, '.env'), `# 注释\nTIA_SIM_KEY="${simKey}"\n`)

  const { byName, credentials } = tools({ env: { TIA_DOCS_KEY: docsKey }, cwd: dir, dshHome: dir })
  const value = await byName.tiaforge_import_env.execute({})

  assert.equal(credentials.store.get('TIA_DOCS_KEY'), docsKey)
  assert.equal(credentials.store.get('TIA_SIM_KEY'), simKey)
  assert.equal(JSON.stringify(value).includes(docsKey), false)
  assert.equal(JSON.stringify(value).includes(simKey), false)

  const only = tools({ env: { TIA_DOCS_KEY: docsKey, TIA_LAD_KEY: 'lad_live_0123456789abcdef' } })
  await only.byName.tiaforge_import_env.execute({ refs: ['TIA_DOCS_KEY'] })
  assert.deepEqual(only.credentials.writes.map(([ref]) => ref), ['TIA_DOCS_KEY'])
})

test('import_env：值不合法就跳过并说清楚', async () => {
  const { byName, credentials } = tools({ env: { TIA_SIM_KEY: 'not-a-key' } })
  const value = await byName.tiaforge_import_env.execute({})
  assert.equal(credentials.writes.length, 0)
  assert.match(value.summary, /跳过/)
})

test('set_key（显式打开）：写入但提醒会进会话记录', async () => {
  const { byName, credentials } = tools({ allowDirectInput: true })
  const value = await byName.tiaforge_set_key.execute({ ref: 'TIA_DOCS_KEY', value: docsKey })
  assert.equal(credentials.store.get('TIA_DOCS_KEY'), docsKey)
  assert.match(value.summary, /会话记录/)
  assert.equal(JSON.stringify(value).includes(docsKey), false)
})

test('导入 TIALINK_TOKEN 会给 tialink 行补上 Authorization（只在那时）', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tiaforge-toolhome-'))
  const token = 'gw-token-0123456789abcdef'

  const docs = tools({ readClipboard: async () => docsKey, dshHome: home })
  await docs.byName.tiaforge_import_key.execute({})
  assert.equal(fs.existsSync(path.join(home, 'cordis.patch.yml')), false, '普通 Key 不该动 home patch')

  const gw = tools({ readClipboard: async () => token, dshHome: home })
  const value = await gw.byName.tiaforge_import_key.execute({ ref: 'TIALINK_TOKEN' })
  const patch = fs.readFileSync(path.join(home, 'cordis.patch.yml'), 'utf8')
  assert.ok(patch.includes('dsh-tiaforge: TiaLink 令牌'))
  assert.ok(patch.includes("Authorization: 'Bearer \${credential:TIALINK_TOKEN}'"))
  assert.match(value.summary, /Authorization/)
  assert.equal(JSON.stringify(value).includes(token), false, '回执里出现了令牌原文')
})

test('status：say 里用的是凭据库里的实际地址，不是内置默认值', async () => {
  const credentials = fakeCredentials({ TIALINK_URL: 'http://192.168.1.110:8080/mcp' })
  const { byName } = tools({ credentials })
  const value = await byName.tiaforge_status.execute({})
  const tialink = value.services.find((row) => row.server === 'tialink')

  assert.equal(tialink.url, 'http://192.168.1.110:8080/mcp')
  assert.notEqual(tialink.urlSource, 'default')
  assert.match(value.say, /192\.168\.1\.110:8080/)
  assert.equal(value.say.includes('127.0.0.1'), false, 'say 不该提内置默认值')
})

test('set_endpoint：改地址走凭据库，校验协议与服务名', async () => {
  const { byName, credentials } = tools()
  const value = await byName.tiaforge_set_endpoint.execute({
    server: 'tialink',
    url: 'http://192.168.1.110:8080/mcp',
  })
  assert.equal(credentials.store.get('TIALINK_URL'), 'http://192.168.1.110:8080/mcp')
  assert.match(value.summary, /25 秒/)
  assert.match(value.summary, /探测通过/, '改完地址要当场探测并给结论')
  assert.equal(value.ref, 'TIALINK_URL')

  await assert.rejects(() => byName.tiaforge_set_endpoint.execute({ server: 'tialink', url: '192.168.1.110:8080' }), /http/)
  await assert.rejects(() => byName.tiaforge_set_endpoint.execute({ server: 'nope', url: 'http://x/mcp' }), /不认识的端点/)
})

test('set_endpoint：地址连不上要给具体结论（不是只说 disconnected）', async () => {
  const cases = [
    [{ ok: false, code: 'ECONNREFUSED' }, /端口拒绝连接/],
    [{ ok: false, code: 'UND_ERR_CONNECT_TIMEOUT' }, /不通.*内网|内网.*防火墙/],
    [{ ok: false, code: 'ENOTFOUND' }, /解析失败/],
    [{ ok: false, status: 401 }, /要求鉴权/],
    [{ ok: false, status: 404 }, /路径不对.*\/mcp/],
  ]
  for (const [reply, expected] of cases) {
    const { byName } = tools({ probe: async () => reply })
    const value = await byName.tiaforge_set_endpoint.execute({ server: 'tialink', url: 'http://192.168.1.110:8080/mcp' })
    assert.match(value.summary, expected)
    assert.equal(value.probe.ok, false)
  }
})

test('readDotEnv：只认 KEY=VALUE，去引号、忽略注释', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiaforge-dotenv-'))
  const file = path.join(dir, '.env')
  fs.writeFileSync(file, 'A=1\n#B=2\nC="x y"\nD=\ninvalid line\n')
  assert.deepEqual(readDotEnv(file), { A: '1', C: 'x y' })
  assert.deepEqual(readDotEnv(path.join(dir, 'missing.env')), {})
})
