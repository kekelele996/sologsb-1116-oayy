/**
 * 同机多窗口协同通道：
 * - 锁变化：别的窗口立刻知道「写权在谁手里」，界面切只读；
 * - 数据变化：别的窗口重新拉取列表，保证看到的版本是新的；
 * - 草稿变化：失败恢复横幅即时刷新。
 * 不支持 BroadcastChannel 的旧浏览器退化为无跨窗即时通知（轮询 + 锁 TTL 仍生效）。
 */

export type BusEvent =
  | { type: 'lock-changed'; scope: string; targetId: string }
  | { type: 'data-changed'; domain: 'records' | 'spores' | 'points' | 'identifies' }
  | { type: 'draft-changed' }

const CHANNEL_NAME = 'gbfungiguide-concurrency'

let channel: BroadcastChannel | null = null
try {
  channel = new BroadcastChannel(CHANNEL_NAME)
} catch {
  channel = null
}

export function postEvent(event: BusEvent): void {
  channel?.postMessage(event)
}

export function subscribeEvents(handler: (event: BusEvent) => void): () => void {
  if (!channel) return () => {}
  const listener = (message: MessageEvent<BusEvent>) => handler(message.data)
  channel.addEventListener('message', listener)
  return () => channel?.removeEventListener('message', listener)
}
