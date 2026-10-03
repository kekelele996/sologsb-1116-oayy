/**
 * 多人共用机器上的并发控制基础类型。
 *
 * - owner：字段归属。记录员（recorder）拥有采集点 / 形态条目 / 孢子印；
 *   鉴定人（identifier）拥有鉴定结论与复核。两边的数据层写入互相隔绝。
 * - version：乐观锁版本号。打开一行时记下看到的版本，保存时核对，
 *   别人动过就拒绝整行回写，避免晚到的保存把整块带回旧值。
 */

export type EditorRole = 'recorder' | 'identifier'

export const ROLE_RECORDER: EditorRole = 'recorder'
export const ROLE_IDENTIFIER: EditorRole = 'identifier'

export const ROLE_LABELS: Record<EditorRole, string> = {
  recorder: '记录员',
  identifier: '鉴定人'
}

/** 所有可并发编辑的数据行都带版本与归属 */
export interface VersionedRow {
  /** 乐观锁版本：打开时看到的版本；每次成功保存 +1 */
  version: number
  /** 归属角色：决定哪一侧能写 */
  owner: EditorRole
  /** 最后修改人署名（窗口里填写的采集人 / 鉴定人名） */
  updatedBy: string
  /** 最后修改时间（ISO，含时分秒，用于区分同日多次修改） */
  updatedAt: string
}

/** 新建行时的入参：版本与归属由数据层补齐 */
export type NewRow<T extends VersionedRow> = Omit<T, keyof VersionedRow>

/** 各业务域中文名（越权 / 冲突提示用） */
export const DOMAIN_LABELS = {
  records: '菌物条目（形态描述）',
  spores: '孢子印观察',
  points: '采集点',
  identifies: '鉴定结论与复核'
} as const
