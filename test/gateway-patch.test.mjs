/**
 * TiaLink 令牌覆盖块：只在"用户真填了令牌"时才往 home patch 加 Authorization。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { applyBlock, hasGatewayAuth, resolveHomePatchPath, syncGatewayAuth } from '../lib/gateway-patch.mjs'

const marker = '# >>> dsh-tiaforge: TiaLink 令牌'

test('插入：空文件 → 有说明头 + 覆盖块，且只出现一次', () => {
  const once = applyBlock('', true)
  assert.match(once, /dsh home-level patch/)
  assert.equal(once.split(marker).length - 1, 1)
  assert.match(once, /Authorization: 'Bearer \$\{credential:TIALINK_TOKEN\}'/)

  const twice = applyBlock(once, true)
  assert.equal(twice, once, '已经有块时不该再插一遍')
})

test('插入：保留用户已有内容', () => {
  const text = '# 我的偏好\n- id: ui-theme\n  config:\n    appearance: dark\n'
  const out = applyBlock(text, true)
  assert.ok(out.startsWith('# 我的偏好\n- id: ui-theme'))
  assert.ok(out.includes(marker))
})

test('移除：删掉整段标记块，别的内容逐字保留', () => {
  const text = '# 我的偏好\n- id: ui-theme\n  config:\n    appearance: dark\n'
  const added = applyBlock(text, true)
  const removed = applyBlock(added, false)
  assert.equal(removed.includes(marker), false)
  assert.equal(removed.includes('Authorization'), false)
  assert.ok(removed.includes('- id: ui-theme'))
  assert.ok(removed.includes('appearance: dark'))
})

test('移除：没有块时不动（返回原文）', () => {
  const text = '# 只有我的内容\n'
  assert.equal(applyBlock(text, false), text)
})

test('CRLF 文件保持 CRLF', () => {
  const out = applyBlock('# h\r\n', true)
  const lines = out.split('\n')
  assert.equal(lines.every((line, index) => index === lines.length - 1 || line.endsWith('\r')), true)
})

test('syncGatewayAuth：落盘、备份、可查询状态', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tiaforge-home-'))
  const file = resolveHomePatchPath(home)

  assert.equal(hasGatewayAuth(home), false)
  const first = syncGatewayAuth({ dshHome: home, enabled: true })
  assert.equal(first.changed, true)
  assert.equal(hasGatewayAuth(home), true)
  assert.ok(fs.existsSync(file))

  const again = syncGatewayAuth({ dshHome: home, enabled: true })
  assert.equal(again.changed, false, '内容没变时不该重复写')

  const off = syncGatewayAuth({ dshHome: home, enabled: false })
  assert.equal(off.changed, true)
  assert.ok(off.backup && fs.existsSync(off.backup))
  assert.equal(hasGatewayAuth(home), false)
})
