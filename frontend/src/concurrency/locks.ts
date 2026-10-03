import { db } from '@/hooks/usePersistentStore'
import { CLIENT_ID } from './client'
import { postEvent } from './bus'

/** 锁租约：窗口存活期间靠心跳续租；窗口关闭或卡死，TTL 过后自动放开 */
export const LOCK_TTL_MS = 8000

/** 锁作用域：同一条目（形态/孢子印/鉴定结论共用 entry 锁）或独立采集点（point 锁） */
export type LockScope = 'entry' | 'point'

export interface EditLockRow {
  /** `${scope}:${targetId}` */
  key: string
  scope: LockScope
  targetId: string
  holderClient: string
  holderName: string
  holderRole: 'recorder' | 'identifier'
  acquiredAt: number
  expiresAt: number
}

function lockKey(scope: LockScope, targetId: string): string {
  return `${scope}:${targetId}`
}

function isLive(lock: EditLockRow, now = Date.now()): boolean {
  return lock.expiresAt > now
}

export interface LockInfo {
  scope: LockScope
  targetId: string
  holderClient: string
  holderName: string
  holderRole: 'recorder' | 'identifier'
  mine: boolean
}

function toInfo(lock: EditLockRow): LockInfo {
  return {
    scope: lock.scope,
    targetId: lock.targetId,
    holderClient: lock.holderClient,
    holderName: lock.holderName,
    holderRole: lock.holderRole,
    mine: lock.holderClient === CLIENT_ID
  }
}

/** 清理某把锁的过期租约（若仍有效则原样保留） */
async function purgeIfExpired(key: string): Promise<EditLockRow | undefined> {
  const lock = await db.locks.get(key)
  if (lock && !isLive(lock)) {
    await db.locks.delete(key)
    return undefined
  }
  return lock
}

/** 取得写锁：自己已持有则续租；别人持有（且未过期）则失败，调用方进入只读 */
export async function acquireLock(params: {
  scope: LockScope
  targetId: string
  holderName: string
  holderRole: 'recorder' | 'identifier'
}): Promise<{ granted: boolean; lock?: LockInfo; heldBy?: LockInfo }> {
  const key = lockKey(params.scope, params.targetId)
  const now = Date.now()
  return db.transaction('rw', db.locks, async () => {
    const existing = await purgeIfExpired(key)
    if (existing && existing.holderClient !== CLIENT_ID) {
      return { granted: false, heldBy: toInfo(existing) }
    }
    const row: EditLockRow = {
      key,
      scope: params.scope,
      targetId: params.targetId,
      holderClient: CLIENT_ID,
      holderName: params.holderName.trim() || '未署名窗口',
      holderRole: params.holderRole,
      acquiredAt: existing?.acquiredAt ?? now,
      expiresAt: now + LOCK_TTL_MS
    }
    await db.locks.put(row)
    postEvent({ type: 'lock-changed', scope: params.scope, targetId: params.targetId })
    return { granted: true, lock: toInfo(row) }
  })
}

/** 续租：锁丢失（被 TTL 回收后别人拿走）时返回 false，调用方应立即转只读 */
export async function renewLock(scope: LockScope, targetId: string): Promise<boolean> {
  const key = lockKey(scope, targetId)
  const lock = await db.locks.get(key)
  if (!lock || lock.holderClient !== CLIENT_ID) return false
  const next: EditLockRow = { ...lock, expiresAt: Date.now() + LOCK_TTL_MS }
  await db.locks.put(next)
  return true
}

/** 主动释放（保存完成 / 关闭页面 / 离开条目） */
export async function releaseLock(scope: LockScope, targetId: string): Promise<void> {
  const key = lockKey(scope, targetId)
  const lock = await db.locks.get(key)
  if (lock?.holderClient === CLIENT_ID) {
    await db.locks.delete(key)
    postEvent({ type: 'lock-changed', scope, targetId })
  }
}

/** 读取锁状态，过期锁顺手回收 */
export async function readLock(scope: LockScope, targetId: string): Promise<LockInfo | null> {
  const key = lockKey(scope, targetId)
  const lock = await purgeIfExpired(key)
  return lock ? toInfo(lock) : null
}

/** 启动时 / 周期性清掉所有过期锁（卡死窗口的锁靠它兜底放开） */
export async function sweepExpiredLocks(): Promise<number> {
  const now = Date.now()
  const stale = await db.locks.where('expiresAt').belowOrEqual(now).primaryKeys()
  if (stale.length) await db.locks.bulkDelete(stale)
  return stale.length
}
