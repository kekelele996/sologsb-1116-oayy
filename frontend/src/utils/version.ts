import type { Table } from 'dexie'
import { ConflictError, type EntityKind, type FieldConflict } from '@/types/concurrency'

/** 浅比较两个值是否相等（支持基本类型与普通对象/数组） */
export function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return a === b
  if (typeof a !== typeof b) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    if (a.length !== b.length) return false
    return a.every((item, idx) => isEqual(item, b[idx]))
  }
  if (typeof a === 'object') {
    const ak = Object.keys(a as object)
    const bk = Object.keys(b as object)
    if (ak.length !== bk.length) return false
    return ak.every((k) => isEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  }
  return false
}

/** 找出 next 相对 base 发生变化的字段（仅比较 fields 内的字段） */
export function changedFields<T>(next: Partial<T>, base: T, fields: readonly (keyof T)[]): (keyof T)[] {
  return fields.filter((f) => !isEqual(next[f], base[f]))
}

export interface SaveWithVersionArgs<T extends { id: string; version?: number }> {
  table: Table<T, string>
  kind: EntityKind
  id: string
  /** 自己的草稿 */
  draft: T
  /** 打开时看到的版本 */
  baseVersion: number
  /** 打开时的快照 */
  baseSnapshot: T
  /** 自己阵营可编辑的字段（归属隔离） */
  editableFields: readonly (keyof T)[]
  /** 字段标签（用于冲突提示） */
  fieldLabels: Record<string, string>
}

export interface SaveWithVersionResult<T> {
  saved: T
  /** 是否合并了对方的改动（版本不一致但无字段冲突时为 true） */
  merged: boolean
  /** 对方改过的字段（合并时返回，用于提示） */
  theirChanges: FieldConflict[]
}

/**
 * 带版本检查与字段级合并的保存：
 * - 实体不存在 → 新建，version = 1
 * - 版本一致 → 仅写入 editableFields 内自己改过的字段，version + 1
 * - 版本不一致 → 做字段级三方合并；若双方都改了同一字段则抛出 ConflictError（不写旧值）
 */
export async function saveWithVersion<T extends { id: string; version?: number }>(
  args: SaveWithVersionArgs<T>
): Promise<SaveWithVersionResult<T>> {
  const { table, kind, id, draft, baseVersion, baseSnapshot, editableFields, fieldLabels } = args

  const current = await table.get(id)

  if (!current) {
    const row: T = { ...draft, version: 1 }
    await table.put(row)
    return { saved: row, merged: false, theirChanges: [] }
  }

  const currentVersion = current.version ?? 1

  if (currentVersion === baseVersion) {
    // 对方没改：以 current 为底，只写自己改过的字段
    const next = { ...current } as T
    for (const f of editableFields) {
      if (!isEqual(draft[f], baseSnapshot[f])) {
        ;(next as Record<string, unknown>)[f as string] = draft[f]
      }
    }
    next.version = currentVersion + 1
    await table.put(next)
    return { saved: next, merged: false, theirChanges: [] }
  }

  // 对方改过：计算双方各自改动的字段
  const theirChanged = changedFields(current, baseSnapshot, editableFields)
  const yourChanged = changedFields(draft, baseSnapshot, editableFields)
  const conflictFields = theirChanged.filter((f) => yourChanged.includes(f))

  const toFieldConflict = (f: keyof T): FieldConflict => ({
    field: String(f),
    label: fieldLabels[String(f)] ?? String(f),
    baseValue: (baseSnapshot as Record<string, unknown>)[f as string],
    yourValue: (draft as Record<string, unknown>)[f as string],
    theirValue: (current as Record<string, unknown>)[f as string]
  })

  const theirChanges = theirChanged.map(toFieldConflict)
  const conflicts = conflictFields.map(toFieldConflict)

  if (conflicts.length > 0) {
    throw new ConflictError(kind, id, baseVersion, currentVersion, conflicts, theirChanges)
  }

  // 无字段冲突：以 current 为底，合并自己改过的字段
  const next = { ...current } as T
  for (const f of yourChanged) {
    ;(next as Record<string, unknown>)[f as string] = draft[f]
  }
  next.version = currentVersion + 1
  await table.put(next)
  return { saved: next, merged: true, theirChanges }
}
