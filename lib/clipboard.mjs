/**
 * 读系统剪贴板（A′ 路线的入口）。
 *
 * 只在用户明确说"我复制好了"之后才调用——这条纪律写在 skills/tiaforge-setup 里，
 * 也写在工具描述里。读不到就抛错，让模型退回到"手改文件 / 打开配置页"。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<string>} 剪贴板全文（已 trim）
 */
export async function readClipboard(options = {}) {
  const timeout = options.timeoutMs ?? 4000
  const [command, args] = commandForPlatform()

  try {
    const { stdout } = await run(command, args, {
      timeout,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    })
    return String(stdout ?? '').replace(/\r\n/g, '\n').trim()
  } catch (error) {
    throw new Error(clipboardHint(error))
  }
}

function commandForPlatform() {
  if (process.platform === 'win32') {
    // Get-Clipboard -Raw 保留换行；powershell.exe 在 Windows 10/11 一定有
    return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard -Raw']]
  }
  if (process.platform === 'darwin') return ['pbpaste', []]
  return ['sh', ['-c', 'command -v wl-paste >/dev/null 2>&1 && wl-paste --no-newline || xclip -o -selection clipboard']]
}

function clipboardHint(error) {
  const code = error?.code
  if (code === 'ENOENT') return '这台机器上找不到读剪贴板的命令（Linux 需要 wl-paste 或 xclip）'
  if (code === 'ETIMEDOUT' || error?.killed) return '读剪贴板超时（远程桌面/无桌面会话时常见）'
  return `读剪贴板失败：${error?.message ?? error}`
}
