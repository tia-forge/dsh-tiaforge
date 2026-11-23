/**
 * 配置面一致性：cordis.patch.yml 与 lib/refs.mjs 必须说的是同一件事。
 *
 * 这个测试存在的原因：0.3.x 之前端点把 Key 写在 `!!js process.env.X` 里，
 * 换 Key 只能重启；而且 patch 与 setup 页各写一份 ref 名字，谁改漏都是静默失效。
 * 现在只允许一条路：patch 用 ${credential:REF}，REF 由 lib/refs.mjs 声明。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { KEY_REFS, SERVICES, URL_REFS } from '../lib/refs.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const patch = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')

// 注释里会提到旧写法（"不再用 !!js process.env"），断言只看真正的 YAML 行
const patchCode = patch
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n')

const indexSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

/** 切出一个 `- id: xxx` 行的配置块（到下一个 `- id:` 为止）。 */
function blockOf(id) {
  const lines = patch.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === `- id: ${id}`)
  if (start < 0) return undefined
  let end = start + 1
  while (end < lines.length && !/^\s*-\s+id:/.test(lines[end])) end += 1
  return lines.slice(start, end).join('\n')
}

test('每个端点行都用凭据模板，不再读进程环境变量', () => {
  assert.equal(patchCode.includes('process.env.'), false, 'patch 里不该再出现 process.env')
  assert.equal(patchCode.includes('!!js'), false, 'patch 里不该再出现 !!js 求值')
})

test('五个端点行：serverName / url / Authorization / expandTemplates / failOnStartupError', () => {
  for (const service of SERVICES) {
    const block = blockOf(service.rowId)
    assert.ok(block, `缺少端点行：${service.server}`)
    assert.match(block, new RegExp(`serverName: ${service.server}\\b`), `${service.server}: serverName 不对`)
    assert.match(block, /expandTemplates: true/, `${service.server}: 必须开 expandTemplates`)
    assert.ok(block.includes(`url: \${credential:${service.urlRef}}`), `${service.server}: url 没用凭据引用`)
    if (service.authHeader) {
      assert.ok(
        block.includes(`'Bearer \${credential:${service.keyRef}}'`),
        `${service.server}: Authorization 没用凭据引用`,
      )
    } else {
      // TiaLink 的令牌可选：带上 Authorization 会让"没令牌"变成 waiting-credentials，连只读都连不上
      assert.equal(block.includes('Authorization'), false, `${service.server}: 这一行不该带 Authorization`)
    }
    assert.match(block, /failOnStartupError: false/, `${service.server}: 缺值不能让行激活失败`)
    // 没 inject: [credentials] 就会在并发激活里抢跑，整行被丢（实测报
    // 「MCP credential templates require a credentials provider」）
    assert.match(block, /inject:\s*\n\s+- credentials/, `${service.server}: 缺 inject: [credentials]`)
  }
})

test('expandTemplates 的行数与端点数一致', () => {
  const count = patchCode.match(/expandTemplates: true/g)?.length ?? 0
  assert.equal(count, SERVICES.length)
})

test('ref 名在插件侧只有一份真源', () => {
  // index.js 必须从 lib/refs.mjs 取，不能自己再写一遍清单
  assert.match(indexSource, /from '\.\/lib\/refs\.mjs'/)
  assert.equal(/TIA_[A-Z]+_(URL|KEY)'/.test(indexSource), false, 'index.js 里又硬编码了 ref 名')
  assert.equal(URL_REFS.length, SERVICES.length)
  assert.equal(KEY_REFS.length, SERVICES.length)
  for (const service of SERVICES) {
    assert.ok(URL_REFS.some(([ref, url]) => ref === service.urlRef && url === service.defaultUrl))
    assert.ok(KEY_REFS.some(([ref, server]) => ref === service.keyRef && server === service.server))
  }
})

test('URL 的 Config 字段名唯一，且字段是 volatile（否则设置界面看不见）', () => {
  const fields = SERVICES.map((service) => service.urlField)
  assert.equal(new Set(fields).size, fields.length, 'urlField 有重名')
  for (const field of fields) assert.match(field, /^[a-z][A-Za-z0-9]*$/, `urlField 不像配置字段名：${field}`)

  // 字段集中在 index.js 用 SERVICES 生成，别两处各写一份
  assert.match(indexSource, /z\s*\n?\s*\.string\(\)/, 'index.js 里没有 string 字段定义')
  assert.match(indexSource, /\.volatile\(\)/, 'Config 字段没标 .volatile()，设置界面不会显示')
  assert.match(indexSource, /SERVICES\.map/, 'Config 不是从 SERVICES 生成的')
  // 密钥不许进 Config：profile 的 cordis.patch.yml 是明文（Config 块里只能有 urlField）
  const configBlock = indexSource.slice(indexSource.indexOf('export const Config'), indexSource.indexOf('const SKILLS_DIR'))
  assert.equal(configBlock.includes('key'), false, 'Config 块里出现了 key —— 密钥不能落进 profile 配置')
})

test('发布包会把 setup 页、lib 与 bin 一起带上', () => {
  for (const entry of ['index.js', 'cordis.patch.yml', 'skills', 'lib', 'bin', 'assets', 'test']) {
    assert.ok(pkg.files.includes(entry), `package.json 的 files 少了一项：${entry}`)
  }
  assert.equal(pkg.bin['dsh-tiaforge-setup'], './bin/setup.mjs')
  assert.ok(fs.existsSync(path.join(root, 'bin/setup.mjs')))
  assert.ok(fs.existsSync(path.join(root, 'assets/setup.html')))
})
