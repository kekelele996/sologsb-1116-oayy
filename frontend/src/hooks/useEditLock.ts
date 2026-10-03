import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { EditorRole } from '@/types'
import {
  acquireLock,
  readLock,
  releaseLock,
  renewLock,
  type LockInfo,
  type LockScope
} from '@/concurrency/locks'
import { CLIENT_ID } from '@/concurrency/client'
import { subscribeEvents } from '@/concurrency/bus'
import { currentEditorName, sessionStore } from '@/stores/sessionStore'

/** 心跳续租与轮询节奏：TTL 8s，心跳 2.5s，轮询 4s */
const HEARTBEAT_MS = 2500
const POLL_MS = 4000

export interface EditLockOptions {
  /** 锁作用域：条目（entry）或采集点（point） */
  scope: LockScope
  /** 目标 ID（空串表示当前没有可锁目标） */
  targetId: Ref<string>
  /** 取得锁时使用的角色；默认取当前会话角色 */
  role?: () => EditorRole
}

/**
 * 同一条目 / 采集点被多个窗口打开时，只让一个窗口能写：
 * - 本窗口持有锁 → writable；
 * - 别的窗口持有 → 只读，并显示写权持有者；
 * - 心跳续租；窗口关闭 / 卡死由 TTL 自动放开；
 * - targetId 变化（换条目、关对话框）时自动释放旧锁。
 */
export function useEditLock(options: EditLockOptions) {
  const lock = ref<LockInfo | null>(null)
  const acquiring = ref(false)
  const lost = ref(false)

  const key = computed(() =>
    options.targetId.value ? `${options.scope}:${options.targetId.value}` : ''
  )

  async function refresh(): Promise<void> {
    if (!options.targetId.value) {
      lock.value = null
      return
    }
    const info = await readLock(options.scope, options.targetId.value)
    lock.value = info
    if (info?.mine) lost.value = false
  }

  async function request(): Promise<boolean> {
    if (!options.targetId.value) return false
    acquiring.value = true
    try {
      const role = options.role ? options.role() : sessionStore.getState().role
      const result = await acquireLock({
        scope: options.scope,
        targetId: options.targetId.value,
        holderName: currentEditorName(),
        holderRole: role
      })
      lock.value = result.lock ?? result.heldBy ?? null
      lost.value = false
      return result.granted
    } finally {
      acquiring.value = false
    }
  }

  async function release(): Promise<void> {
    if (!options.targetId.value) return
    await releaseLock(options.scope, options.targetId.value)
    lock.value = null
    lost.value = false
  }

  // 心跳续租：租不下来说明锁已被 TTL 回收并易主，立刻转只读
  const heartbeat = window.setInterval(() => {
    if (!options.targetId.value || lock.value?.holderClient !== CLIENT_ID) return
    void (async () => {
      const ok = await renewLock(options.scope, options.targetId.value)
      if (!ok) {
        lost.value = true
        await refresh()
      }
    })()
  }, HEARTBEAT_MS)

  // 轮询兜底：BroadcastChannel 不可用或心跳异常时，最多 POLL_MS 感知到锁变化
  const poll = window.setInterval(() => {
    if (options.targetId.value) void refresh()
  }, POLL_MS)

  const unsubscribe = subscribeEvents((event) => {
    if (
      event.type === 'lock-changed' &&
      event.scope === options.scope &&
      event.targetId === options.targetId.value
    ) {
      void refresh()
    }
  })

  // 目标切换：释放旧锁，加载新目标的锁状态
  watch(key, async (newKey, oldKey) => {
    if (oldKey && lock.value?.holderClient === CLIENT_ID && oldKey !== newKey) {
      const [oldScope, ...rest] = oldKey.split(':')
      await releaseLock(oldScope as LockScope, rest.join(':'))
    }
    lost.value = false
    await refresh()
  })

  // 页面正常关闭 / 刷新：尽力同步释放，TTL 再兜底崩溃场景
  function onUnload(): void {
    if (options.targetId.value && lock.value?.holderClient === CLIENT_ID) {
      // beforeunload 中异步事务不一定完成；使用 navigator.sendBeacon 无法操作 IDB，
      // 因此这里只做释放尝试，崩溃/未完成时由 TTL 自动放开。
      void releaseLock(options.scope, options.targetId.value)
    }
  }
  window.addEventListener('pagehide', onUnload)

  onBeforeUnmount(() => {
    window.clearInterval(heartbeat)
    window.clearInterval(poll)
    window.removeEventListener('pagehide', onUnload)
    unsubscribe()
    void release()
  })

  void refresh()

  return {
    lock,
    acquiring,
    /** 锁曾属于本窗口但续租失败（被 TTL 回收后易主） */
    lost,
    writable: computed(() => lock.value?.holderClient === CLIENT_ID && !lost.value),
    heldByOther: computed(() => Boolean(lock.value && lock.value.holderClient !== CLIENT_ID)),
    request,
    release,
    refresh
  }
}
