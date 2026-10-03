/**
 * 每个浏览器窗口（标签页）的唯一身份。
 * 写锁按窗口授予；同窗口刷新后尽量沿用 sessionStorage 里的身份。
 */
function makeClientId(): string {
  return `win_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

let cached = ''
try {
  const existed = window.sessionStorage.getItem('gbfg.clientId')
  if (existed) cached = existed
} catch {
  // 隐私模式等场景 sessionStorage 不可用时忽略
}
if (!cached) {
  cached = makeClientId()
  try {
    window.sessionStorage.setItem('gbfg.clientId', cached)
  } catch {
    // 同上：内存 ID 也能工作，只是刷新后换身份（锁等 TTL 自然过期）
  }
}

export const CLIENT_ID = cached
