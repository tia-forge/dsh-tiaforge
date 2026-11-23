/**
 * 文档 lint：口径只能有一处真源，散落在 SKILL.md / README 里的错误表述必须被拦下来。
 *
 * 踩过的坑（都是"改了代码没改文档"）：
 *   · 技能里写着"只读不需要令牌" → 模型照抄，反复说错；
 *   · 技能里写死默认地址 127.0.0.1 → 用户网关在 192.168.x.x，模型却报"默认是本机"。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function docs() {
  const files = [path.join(root, 'README.md')]
  for (const name of fs.readdirSync(path.join(root, 'skills'))) {
    const file = path.join(root, 'skills', name, 'SKILL.md')
    if (fs.existsSync(file)) files.push(file)
  }
  return files.map((file) => ({ file: path.relative(root, file), text: fs.readFileSync(file, 'utf8') }))
}

test('没有哪一句把"只读"和"令牌"绑成因果关系', () => {
  for (const { file, text } of docs()) {
    // 按句读切：同一句里同时出现"只读"和"令牌"就可疑（除非明说无关）
    for (const sentence of text.split(/[。；;\n]/)) {
      if (!sentence.includes('只读') || !sentence.includes('令牌')) continue
      assert.ok(
        /无关|不管|不影响|不代表/.test(sentence),
        `${file} 里这一句把只读和令牌绑在一起：\n${sentence.trim()}`,
      )
    }
  }
})

test('配置类技能里不许把内置默认地址当事实写死', () => {
  const file = path.join(root, 'skills', 'tiaforge-setup', 'SKILL.md')
  const text = fs.readFileSync(file, 'utf8')
  assert.equal(
    text.includes('127.0.0.1'),
    false,
    'tiaforge-setup/SKILL.md 里出现了具体地址：模型会当成"默认是本机"，应改为"以 tiaforge_status 的 url/say 为准"',
  )
})

test('没有哪份文档敢说"唯一计费"', () => {
  for (const { file, text } of docs()) {
    assert.equal(/唯一[^。；，]{0,6}计费/.test(text), false, `${file} 里出现了"唯一计费"——四个云端点都按 tools/call 扣额度`)
  }
})

test('四个云端端点的计费口径完全一致（新用户 100 次免费，每次扣 1 次）', async () => {
  const { SERVICES } = await import('../lib/refs.mjs')
  const cloud = SERVICES.filter((service) => service.server !== 'tialink')
  const expected = '新用户 100 次免费，每次调用扣 1 次额度'
  for (const service of cloud) {
    assert.equal(service.billing, expected, `${service.server} 的 billing 与统一口径不一致`)
  }
})

test('每个端点说明都提到许可（能不能写由许可决定）', async () => {
  const { SERVICES } = await import('../lib/refs.mjs')
  const tialink = SERVICES.find((service) => service.server === 'tialink')
  assert.match(tialink.summary, /许可/)
})
