/** 角色：记录员 / 鉴定人 */
export type Role = 'recorder' | 'identifier'

/** 受锁保护的实体类型 */
export type EntityKind = 'record' | 'point' | 'spore' | 'identify'

/** 编辑锁（存于 IndexedDB locks 表） */
export interface EditLock {
  /** 锁主键：`${kind}:${entityId}:${role}` */
  key: string
  /** 持有者会话 ID */
  owner: string
  role: Role
  kind: EntityKind
  entityId: string
  acquiredAt: number
  heartbeatAt: number
  expiresAt: number
}

/** 字段级冲突：双方都改过的字段 */
export interface FieldConflict {
  field: string
  label: string
  baseValue: unknown
  yourValue: unknown
  theirValue: unknown
}

/** 版本冲突错误：保存时发现他人已改过同一实体 */
export class ConflictError extends Error {
  kind: EntityKind
  entityId: string
  baseVersion: number
  currentVersion: number
  /** 会被盖掉的字段（双方都改过） */
  conflicts: FieldConflict[]
  /** 对方改过的全部字段 */
  theirChanges: FieldConflict[]

  constructor(
    kind: EntityKind,
    entityId: string,
    baseVersion: number,
    currentVersion: number,
    conflicts: FieldConflict[],
    theirChanges: FieldConflict[]
  ) {
    super(
      `检测到他人已修改此${kind === 'record' ? '条目' : kind === 'point' ? '采集点' : kind === 'spore' ? '孢子印' : '鉴定结论'}（版本 v${baseVersion} → v${currentVersion}），${conflicts.length} 个字段会被盖掉`
    )
    this.name = 'ConflictError'
    this.kind = kind
    this.entityId = entityId
    this.baseVersion = baseVersion
    this.currentVersion = currentVersion
    this.conflicts = conflicts
    this.theirChanges = theirChanges
  }
}

/** 会话操作者名（用于归属字段回填） */
export const OPERATOR_KEY = 'gbf_operator'

/** 读取当前会话操作者名 */
export function getOperator(): string {
  try {
    return sessionStorage.getItem(OPERATOR_KEY) || '记录员'
  } catch {
    return '记录员'
  }
}

/** 设置当前会话操作者名 */
export function setOperator(name: string): void {
  try {
    sessionStorage.setItem(OPERATOR_KEY, name || '记录员')
  } catch {
    /* sessionStorage 不可用时忽略 */
  }
}
