import type { Table } from 'dexie'
import { DOMAIN_LABELS, type EditorRole, type NewRow, type VersionedRow } from '@/types'

/** 不参与「字段是否被改动」比对的元数据 / 主键字段 */
const META_KEYS = new Set(['id', 'version', 'owner', 'updatedBy', 'updatedAt'])

/** 冲突提示里展示的字段中文名 */
export const FIELD_LABELS: Record<string, string> = {
  // FungusRecord 形态条目
  code: '采集编号',
  tempName: '暂定名',
  fruitBodyCount: '子实体数量',
  pointId: '所属采集点',
  capDiameter: '菌盖直径',
  capShape: '菌盖形状',
  capMargin: '菌盖边缘',
  capTexture: '表面质地',
  fleshThickness: '菌肉厚度',
  fleshReaction: '菌肉变色反应',
  attachment: '着生方式',
  gillDensity: '菌褶密度',
  stipeLength: '菌柄长度',
  stipeDiameter: '菌柄直径',
  ring: '菌环',
  volva: '菌托',
  odor: '气味',
  hostTree: '关联树种',
  collectDate: '采集/观察日期',
  collector: '采集人',
  note: '现场备注',
  // SporePrint 孢子印
  color: '印色',
  shape: '印形',
  hours: '获取时长',
  observeDate: '观察日期',
  moisture: '样本干湿度',
  // CollectPoint 采集点
  name: '名称',
  longitude: '经度',
  latitude: '纬度',
  altitude: '海拔',
  vegetation: '植被类型',
  substrate: '基物',
  companionTrees: '伴生树种',
  // IdentifyLog 鉴定结论
  conclusion: '结论学名',
  basis: '鉴定依据',
  referenceBook: '参考图鉴',
  referencePage: '页码',
  confidence: '置信度',
  needReview: '待复核标记',
  reviewer: '复核人',
  date: '结论日期'
}

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key
}

/** 越权写入：记录员一侧写鉴定结论，或鉴定人一侧写采集/形态数据 */
export class OwnershipError extends Error {
  readonly domain: keyof typeof DOMAIN_LABELS
  readonly expected: EditorRole
  constructor(domain: keyof typeof DOMAIN_LABELS, expected: EditorRole) {
    super(`「${DOMAIN_LABELS[domain]}」归${expected === 'recorder' ? '记录员' : '鉴定人'}所有，当前角色无权写入`)
    this.name = 'OwnershipError'
    this.domain = domain
    this.expected = expected
  }
}

/**
 * 乐观版本冲突：保存时发现库里版本与打开时看到的不一致。
 * - clobberedFields：对方改了、而我这次没有跟着改的字段——若直接整行写回会把它们盖回旧值；
 * - divergedFields：双方都动过的字段（需人工核对，不自动合并）。
 */
export class VersionConflictError extends Error {
  readonly baseVersion: number
  readonly currentVersion: number
  readonly clobberedFields: string[]
  readonly divergedFields: string[]
  readonly deleted: boolean
  constructor(params: {
    baseVersion: number
    currentVersion: number
    clobberedFields: string[]
    divergedFields: string[]
    deleted?: boolean
  }) {
    const parts: string[] = []
    if (params.deleted) parts.push('该记录在你打开后已被他人删除')
    if (params.clobberedFields.length) {
      parts.push(`直接保存会把对方刚填的内容盖回旧值：${params.clobberedFields.map(fieldLabel).join('、')}`)
    }
    if (params.divergedFields.length) {
      parts.push(`这些字段双方都改过：${params.divergedFields.map(fieldLabel).join('、')}`)
    }
    super(parts.join('；') || '打开后该记录已被他人修改')
    this.name = 'VersionConflictError'
    this.baseVersion = params.baseVersion
    this.currentVersion = params.currentVersion
    this.clobberedFields = params.clobberedFields
    this.divergedFields = params.divergedFields
    this.deleted = params.deleted ?? false
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a && b && typeof a === 'object') {
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
      return a.every((item, index) => deepEqual(item, b[index]))
    }
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    const ak = Object.keys(ao)
    const bk = Object.keys(bo)
    if (ak.length !== bk.length) return false
    return ak.every((k) => deepEqual(ao[k], bo[k]))
  }
  return false
}

/** next 相对 base 发生变化的业务字段（不含版本元数据） */
export function findChangedFields(base: object, next: object): string[] {
  const keys = new Set([...Object.keys(base), ...Object.keys(next)])
  const changed: string[] = []
  keys.forEach((key) => {
    if (META_KEYS.has(key)) return
    if (!deepEqual((base as Record<string, unknown>)[key], (next as Record<string, unknown>)[key])) {
      changed.push(key)
    }
  })
  return changed
}

export interface SaveContext<T extends VersionedRow> {
  /** 打开编辑时看到的整行快照；新建时不传 */
  base?: T
  /** 本次操作人署名 */
  editor: string
}

export type SaveOutcome<T extends VersionedRow> =
  | { status: 'created'; version: 1; row: T }
  | { status: 'updated'; version: number; row: T }

/**
 * 带归属与乐观版本的写入：
 * 1. 归属不符直接拒绝（记录员 / 鉴定人各写各的域）；
 * 2. 版本对不上时逐字段比对，点出会被盖回旧值的字段并停下，绝不整行覆盖；
 * 3. 校验通过才把版本 +1 落库。
 */
export async function saveVersioned<T extends VersionedRow>(
  table: Table<T, string>,
  domain: keyof typeof DOMAIN_LABELS,
  role: EditorRole,
  next: T | NewRow<T>,
  ctx: SaveContext<T>
): Promise<SaveOutcome<T>> {
  const id = (next as unknown as { id: string }).id
  return table.db.transaction('rw', table, async () => {
    const existing = await table.get(id)

    if (!existing) {
      if (ctx.base) {
        // 打开时还在，保存时没了——已被另一窗口删除
        throw new VersionConflictError({
          baseVersion: ctx.base.version,
          currentVersion: 0,
          clobberedFields: [],
          divergedFields: [],
          deleted: true
        })
      }
      const row = {
        ...(next as object),
        owner: role,
        version: 1,
        updatedBy: ctx.editor.trim() || '未署名',
        updatedAt: new Date().toISOString()
      } as T
      await table.put(row)
      return { status: 'created', version: 1, row }
    }

    if (existing.owner !== role) {
      throw new OwnershipError(domain, existing.owner)
    }

    if (!ctx.base) {
      throw new Error('保存既有记录必须携带打开时看到的整行快照（base），不能凭当前表单覆盖')
    }

    if (existing.version !== ctx.base.version) {
      const remoteKeys = findChangedFields(ctx.base, existing)
      const localKeys = new Set(findChangedFields(ctx.base, next))
      const clobberedFields = remoteKeys.filter((key) => !localKeys.has(key))
      const divergedFields = remoteKeys.filter((key) => localKeys.has(key))
      throw new VersionConflictError({
        baseVersion: ctx.base.version,
        currentVersion: existing.version,
        clobberedFields,
        divergedFields
      })
    }

    const row = {
      ...(next as object),
      owner: existing.owner,
      version: existing.version + 1,
      updatedBy: ctx.editor.trim() || existing.updatedBy || '未署名',
      updatedAt: new Date().toISOString()
    } as T
    await table.put(row)
    return { status: 'updated', version: row.version, row }
  })
}
