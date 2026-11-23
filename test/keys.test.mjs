/**
 * 剪贴板里的东西能不能当 Key 用：认得出来才写，认不出来就老实说不知道。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { KEY_NAMES, maskKey, matchKey, validateKey } from '../lib/keys.mjs'

const docsKey = 'tia_live_0123456789abcdef0123456789abcdef'
const simKey = 'sim_live_aaaabbbbccccddddeeeeffff00001111'

test('按前缀认出是哪一把', () => {
  assert.equal(matchKey(docsKey).ref, 'TIA_DOCS_KEY')
  assert.equal(matchKey(simKey).ref, 'TIA_SIM_KEY')
  assert.equal(matchKey('  lad_live_0123456789abcdef  ').ref, 'TIA_LAD_KEY')
  assert.equal(matchKey('render_live_0123456789abcdef').ref, 'TIA_RENDER_KEY')
})

test('认得出来才返回值；认不出来只说原因', () => {
  const spaced = matchKey('tia_live_0123 456789abcdef')
  assert.equal(spaced.ref, undefined)
  assert.match(spaced.reason, /空白|特殊字符/)

  const multiline = matchKey(`复制的时候带了两行\n${docsKey}`)
  assert.match(multiline.reason, /换行/)

  const unknown = matchKey('sk-0123456789abcdef')
  assert.match(unknown.reason, /认不出/)

  assert.match(matchKey('').reason, /空/)
})

test('显式 ref 也要过格式：前缀不对就拒', () => {
  assert.equal(validateKey('TIA_DOCS_KEY', docsKey), undefined)
  assert.match(validateKey('TIA_DOCS_KEY', simKey), /应以 tia_ 开头/)
  assert.match(validateKey('TIA_DOCS_KEY', 'short'), /太短/)
  assert.match(validateKey('TIA_DOCS_KEY', `${docsKey}\n${docsKey}`), /多行/)
  assert.match(validateKey('TIALINK_TOKEN', 'aaaa bbbb cccc dddd'), /空白|特殊字符/)
  assert.match(validateKey('NOT_A_REF', docsKey), /不认识/)
})

test('掩码：有前缀、有尾四位，且绝不含原文', () => {
  const masked = maskKey(simKey)
  assert.equal(masked, `sim_…${simKey.slice(-4)}`)
  assert.equal(masked.includes('live'), false)
  assert.equal(masked.includes(simKey.slice(10, 20)), false)
  assert.equal(maskKey(''), '')
})

test('KEY_NAMES 覆盖五个服务并且不含 URL 引用', () => {
  assert.deepEqual([...KEY_NAMES].sort(), [
    'TIALINK_TOKEN',
    'TIA_DOCS_KEY',
    'TIA_LAD_KEY',
    'TIA_RENDER_KEY',
    'TIA_SIM_KEY',
  ])
})
