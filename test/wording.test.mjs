/**
 * 口径回归：不许再把"只读"和"令牌"绑在一起。
 *
 * 踩过两次：模型照着 refs.mjs 的 summary / keyTitle 原话复述，于是反复说
 * "只读不需要令牌，写入才需要"——这是错的：令牌管鉴权（连不连得上），
 * 能不能写由那台机器的许可决定。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { SERVICES } from '../lib/refs.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const FORBIDDEN = [/只读不需要/, /不需要令牌/, /只读已可用/, /只读访问不需要/]

function scan(label, text) {
  for (const pattern of FORBIDDEN) {
    assert.equal(pattern.test(text), false, `${label} 里出现了错误口径：${pattern}`)
  }
}

test('端点元数据里的文案不许把只读和令牌绑在一起', () => {
  const tialink = SERVICES.find((service) => service.server === 'tialink')
  scan('tialink.summary', tialink.summary)
  scan('tialink.keyTitle', tialink.keyTitle)
  assert.match(tialink.summary, /许可/, 'summary 要讲清"能不能写由许可决定"')
})

test('技能与 README 里也不许出现', () => {
  const skills = fs.readdirSync(path.join(root, 'skills'))
  for (const name of skills) {
    const file = path.join(root, 'skills', name, 'SKILL.md')
    if (!fs.existsSync(file)) continue
    scan(`skills/${name}/SKILL.md`, fs.readFileSync(file, 'utf8'))
  }
  scan('README.md', fs.readFileSync(path.join(root, 'README.md'), 'utf8'))
})

test('工具返回值里的 hint 也不能出现', async () => {
  const { buildSetupTools } = await import('../lib/setup-tools.mjs')
  const store = new Map()
  const credentials = {
    async resolve(ref) {
      return store.has(ref) ? { value: store.get(ref), source: 'file' } : undefined
    },
    async describe(ref) {
      return store.has(ref) ? { configured: true, source: 'file' } : { configured: false }
    },
    async set(ref, value) {
      store.set(ref, value)
    },
  }
  const tools = buildSetupTools({ credentials, readClipboard: async () => '', env: {}, cwd: root, dshHome: root })
  const status = tools.find((tool) => tool.name === 'tiaforge_status')
  const value = await status.execute({})
  scan('tiaforge_status 返回值', JSON.stringify(value))
})
