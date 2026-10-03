import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import {
  getSessionOwner,
  lockStore,
  LOCK_HEARTBEAT_INTERVAL
} from '@/stores/lockStore'
import type { EntityKind, Role } from '@/types/concurrency'

export interface UseEditorLockResult {
  /** 自己是否持有锁（可写） */
  locked: Ref<boolean>
  /** 是否只读（被他人锁定） */
  readOnly: Ref<boolean>
  /** 锁持有者会话 ID（他人持有时显示） */
  lockHolder: Ref<string | null>
  /** 尝试获取锁 */
  tryAcquire: () => Promise<boolean>
  /** 主动释放锁 */
  release: () => Promise<void>
}

/**
 * 编辑锁 composable：
 * - 打开编辑时尝试获取锁，成功则可写，失败则只读
 * - 心跳续期，窗口关闭 / 崩溃后锁自动过期释放
 * - 实体切换时自动释放旧锁、获取新锁
 */
export function useEditorLock(
  kind: EntityKind,
  entityId: Ref<string>,
  role: Role
): UseEditorLockResult {
  const owner = getSessionOwner()
  const locked = ref(false)
  const readOnly = ref(true)
  const lockHolder = ref<string | null>(null)

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null

  function startHeartbeat(): void {
    stopHeartbeat()
    heartbeatTimer = setInterval(() => {
      void lockStore.getState().heartbeat(owner)
    }, LOCK_HEARTBEAT_INTERVAL)
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  async function tryAcquire(): Promise<boolean> {
    if (!entityId.value) {
      locked.value = false
      readOnly.value = true
      return false
    }
    const ok = await lockStore.getState().acquire(kind, entityId.value, role)
    locked.value = ok
    readOnly.value = !ok
    if (ok) {
      lockHolder.value = null
      startHeartbeat()
    } else {
      stopHeartbeat()
      const lk = await lockStore.getState().getLock(kind, entityId.value, role)
      lockHolder.value = lk?.owner ?? '其他窗口'
    }
    return ok
  }

  async function release(): Promise<void> {
    stopHeartbeat()
    if (entityId.value) {
      await lockStore.getState().release(kind, entityId.value, role)
    }
    locked.value = false
    readOnly.value = true
    lockHolder.value = null
  }

  // 实体切换：释放旧锁，获取新锁
  watch(entityId, async (newId, oldId) => {
    if (oldId) {
      await lockStore.getState().release(kind, oldId, role)
    }
    locked.value = false
    readOnly.value = true
    if (newId) {
      await tryAcquire()
    }
  })

  // 窗口关闭 / 刷新时同步释放所有锁
  function handleBeforeUnload(): void {
    void lockStore.getState().releaseAll(owner)
  }

  // 页面重新可见时检查锁是否仍有效（可能在后台期间过期被抢）
  async function handleVisibility(): Promise<void> {
    if (document.visibilityState === 'visible' && entityId.value) {
      const lk = await lockStore.getState().getLock(kind, entityId.value, role)
      if (!lk || lk.owner !== owner) {
        // 锁已过期或被抢，重新尝试
        await tryAcquire()
      }
    }
  }

  onMounted(() => {
    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('visibilitychange', handleVisibility)
    if (entityId.value) {
      void tryAcquire()
    }
  })

  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', handleBeforeUnload)
    document.removeEventListener('visibilitychange', handleVisibility)
    stopHeartbeat()
    void lockStore.getState().releaseAll(owner)
  })

  return { locked, readOnly, lockHolder, tryAcquire, release }
}
