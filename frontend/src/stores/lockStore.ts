import { createStore } from 'zustand/vanilla'
import { db } from '@/hooks/usePersistentStore'
import type { EditLock, EntityKind, Role } from '@/types/concurrency'

/** 锁心跳间隔（ms） */
export const LOCK_HEARTBEAT_INTERVAL = 5_000
/** 锁过期时长（ms）：心跳超时即视为窗口关闭/卡死，自动释放 */
export const LOCK_TTL = 20_000

/** 生成锁主键 */
export function lockKey(kind: EntityKind, entityId: string, role: Role): string {
  return `${kind}:${entityId}:${role}`
}

/** 获取当前会话 ID（每个标签页/窗口独立） */
export function getSessionOwner(): string {
  try {
    let owner = sessionStorage.getItem('gbf_session')
    if (!owner) {
      owner = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
      sessionStorage.setItem('gbf_session', owner)
    }
    return owner
  } catch {
    return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  }
}

interface LockState {
  locks: EditLock[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 尝试获取锁；成功返回 true，被他人持有返回 false */
  acquire: (kind: EntityKind, entityId: string, role: Role) => Promise<boolean>
  /** 释放自己在某实体上的锁 */
  release: (kind: EntityKind, entityId: string, role: Role) => Promise<void>
  /** 释放自己持有的全部锁（窗口关闭时调用） */
  releaseAll: (owner: string) => Promise<void>
  /** 心跳：续期自己的所有锁 */
  heartbeat: (owner: string) => Promise<void>
  /** 读取某实体上的锁（无论持有者） */
  getLock: (kind: EntityKind, entityId: string, role: Role) => Promise<EditLock | undefined>
  /** 判断某实体是否被他人锁定 */
  isLockedByOther: (kind: EntityKind, entityId: string, role: Role, owner: string) => Promise<boolean>
}

export const lockStore = createStore<LockState>((set, get) => ({
  locks: [],
  loaded: false,
  hydrate: async () => {
    const now = Date.now()
    // 清理过期锁
    const all = await db.locks.toArray()
    const alive = all.filter((lk) => lk.expiresAt > now)
    const expired = all.filter((lk) => lk.expiresAt <= now)
    if (expired.length > 0) {
      await db.locks.bulkDelete(expired.map((lk) => lk.key))
    }
    set({ locks: alive, loaded: true })
  },
  acquire: async (kind, entityId, role) => {
    const owner = getSessionOwner()
    const key = lockKey(kind, entityId, role)
    const now = Date.now()
    const existing = await db.locks.get(key)

    if (existing && existing.expiresAt > now && existing.owner !== owner) {
      // 被他人持有且未过期
      return false
    }

    // 自己已持有或锁已过期：写入新锁（续期）
    const lock: EditLock = {
      key,
      owner,
      role,
      kind,
      entityId,
      acquiredAt: existing && existing.owner === owner ? existing.acquiredAt : now,
      heartbeatAt: now,
      expiresAt: now + LOCK_TTL
    }
    await db.locks.put(lock)

    // 同步内存状态
    const locks = get().locks.filter((lk) => lk.key !== key)
    locks.push(lock)
    set({ locks })
    return true
  },
  release: async (kind, entityId, role) => {
    const owner = getSessionOwner()
    const key = lockKey(kind, entityId, role)
    const existing = await db.locks.get(key)
    if (existing && existing.owner === owner) {
      await db.locks.delete(key)
      set({ locks: get().locks.filter((lk) => lk.key !== key) })
    }
  },
  releaseAll: async (owner) => {
    const mine = await db.locks.where('owner').equals(owner).toArray()
    if (mine.length > 0) {
      await db.locks.bulkDelete(mine.map((lk) => lk.key))
      set({ locks: get().locks.filter((lk) => lk.owner !== owner) })
    }
  },
  heartbeat: async (owner) => {
    const now = Date.now()
    const mine = await db.locks.where('owner').equals(owner).toArray()
    if (mine.length === 0) return
    const updated = mine.map((lk) => ({
      ...lk,
      heartbeatAt: now,
      expiresAt: now + LOCK_TTL
    }))
    await db.locks.bulkPut(updated)
    const keys = new Set(updated.map((lk) => lk.key))
    set({
      locks: get().locks.map((lk) => (keys.has(lk.key) ? { ...lk, heartbeatAt: now, expiresAt: now + LOCK_TTL } : lk))
    })
  },
  getLock: async (kind, entityId, role) => {
    const key = lockKey(kind, entityId, role)
    const lk = await db.locks.get(key)
    if (lk && lk.expiresAt <= Date.now()) {
      // 已过期，清理并返回 undefined
      await db.locks.delete(key)
      set({ locks: get().locks.filter((item) => item.key !== key) })
      return undefined
    }
    return lk
  },
  isLockedByOther: async (kind, entityId, role, owner) => {
    const lk = await get().getLock(kind, entityId, role)
    return !!lk && lk.owner !== owner
  }
}))
