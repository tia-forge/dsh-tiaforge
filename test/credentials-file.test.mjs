/**
 * 凭据文件编辑器的测试：只改我们那几个键，别人写的一个字节都不许动。
 *
 * 背景：`$DSH_HOME/.credentials.yaml` 是 dsh 自己的托管文件，里面还有
 * `records:`（登录态/授权记录）和用户自己加的注释。我们只在 refs: 分节里动手。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { applyRefUpdates, mergeRefs, parseRefs, resolveCredentialsPath } from '../lib/credentials-file.mjs'

const sample = `version: 1
records:
  client-connection/browser-session:
    kind: grant
    payload:
      version: 1
      secret: abc123
refs:
  # 用户的注解，别动
  OTHER_KEY: "keep-me"

  DEEPSEEK_API_KEY: sk-old
`

test('读：只取 refs 分节，records 不参与', () => {
  const refs = parseRefs(sample)
  assert.equal(refs.get('OTHER_KEY'), 'keep-me')
  assert.equal(refs.get('DEEPSEEK_API_KEY'), 'sk-old')
  assert.equal(refs.has('secret'), false)
})

test('写：新增 + 覆盖 + 删除，其余字节原样保留', () => {
  const merged = mergeRefs(sample, new Map([
    ['TIA_DOCS_KEY', 'tia_live_a'],
    ['DEEPSEEK_API_KEY', 'sk-new'],
    ['OTHER_KEY', null],
  ]))

  const refs = parseRefs(merged)
  assert.equal(refs.get('TIA_DOCS_KEY'), 'tia_live_a')
  assert.equal(refs.get('DEEPSEEK_API_KEY'), 'sk-new')
  assert.equal(refs.has('OTHER_KEY'), false)

  // records 与版本头逐字保留
  assert.ok(merged.includes('  client-connection/browser-session:'))
  assert.ok(merged.includes('      secret: abc123'))
  assert.ok(merged.startsWith('version: 1\nrecords:\n'))
  // 别人的注释也留着
  assert.ok(merged.includes('# 用户的注解，别动'))
})

test('写：没有 refs 分节时补一节，不动已有内容', () => {
  const text = 'version: 1\nrecords: {}\n'
  const merged = mergeRefs(text, new Map([['TIA_SIM_KEY', 'k1']]))
  const refs = parseRefs(merged)
  assert.equal(refs.get('TIA_SIM_KEY'), 'k1')
  assert.ok(merged.includes('records: {}'))
})

test('写：多行值被替换时整段清掉，不留残行', () => {
  const text = 'version: 1\nrefs:\n  MULTI: >\n    第一行\n    第二行\n  KEEP: 1\n'
  const merged = mergeRefs(text, new Map([['MULTI', 'single']]))
  const refs = parseRefs(merged)
  assert.equal(refs.get('MULTI'), 'single')
  assert.equal(refs.get('KEEP'), '1')
  assert.equal(merged.includes('第一行'), false)
})

test('写：CRLF 文件仍然保持 CRLF', () => {
  const text = 'version: 1\r\nrefs:\r\n  A: 1\r\nrecords: {}\r\n'
  const merged = mergeRefs(text, new Map([['B', '2']]))
  // 每一行都必须以 CRLF 结尾：不能出现裸 LF
  const lines = merged.split('\n')
  assert.equal(
    lines.every((line, index) => index === lines.length - 1 || line.endsWith('\r')),
    true,
  )
  assert.equal(parseRefs(merged).get('B'), '2')
})

test('写：文件不存在时造出 dsh 认的三节结构（records 必须是 {}，不能是 null）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiaforge-'))
  const file = path.join(dir, '.credentials.yaml')
  applyRefUpdates(file, new Map([['TIA_DOCS_KEY', 'k']]))

  const text = fs.readFileSync(file, 'utf8')
  assert.match(text, /^version: 1/)
  assert.match(text, /records: \{\}/)
  assert.equal(parseRefs(text).get('TIA_DOCS_KEY'), 'k')

  // 二次写入：只改一行，并留一份备份
  const result = applyRefUpdates(file, new Map([['TIA_DOCS_KEY', 'k2']]))
  assert.ok(result.backup && fs.existsSync(result.backup))
  assert.equal(parseRefs(fs.readFileSync(file, 'utf8')).get('TIA_DOCS_KEY'), 'k2')
})

test('写：内容没变就不落盘（不产生多余备份）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiaforge-'))
  const file = path.join(dir, '.credentials.yaml')
  fs.writeFileSync(file, 'version: 1\nrefs:\n  TIA_DOCS_KEY: "k"\nrecords: {}\n')
  const result = applyRefUpdates(file, new Map([['TIA_DOCS_KEY', 'k']]))
  assert.deepEqual(result.changed, [])
  assert.equal(fs.readdirSync(dir).filter((name) => name.includes('.bak-')).length, 0)
})

test('路径：--creds > 环境变量 > $DSH_HOME > ~/.dsh', () => {
  const saved = { DSH_HOME: process.env.DSH_HOME, TIAFORGE_CREDENTIALS: process.env.TIAFORGE_CREDENTIALS }
  try {
    delete process.env.DSH_HOME
    delete process.env.TIAFORGE_CREDENTIALS
    assert.equal(resolveCredentialsPath('/tmp/x.yaml'), path.resolve('/tmp/x.yaml'))
    assert.ok(resolveCredentialsPath().endsWith(path.join('.dsh', '.credentials.yaml')))

    process.env.DSH_HOME = '/tmp/dsh-home'
    assert.equal(resolveCredentialsPath(), path.join(path.resolve('/tmp/dsh-home'), '.credentials.yaml'))

    process.env.TIAFORGE_CREDENTIALS = '/tmp/creds.yaml'
    assert.equal(resolveCredentialsPath(), path.resolve('/tmp/creds.yaml'))
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
