import { createStore } from 'zustand/vanilla'
import { db } from '@/hooks/usePersistentStore'
import { postEvent } from '@/concurrency/bus'

/**
 * 中途失败的录入草稿（仅记录员这一侧的数据：形态条目 / 孢子印 / 采集点）。
 * 保存冲突或写库报错时，表单内容先落到这里，之后可从记录员页面一键恢复重来。
 */
export type DraftKind = 'record' | 'spore' | 'point'

export interface RecoveryDraft {
  /** `${targetId}:${kind}`，同一目标同类草稿只留一份 */
  id: string
  scope: 'entry' | 'point'
  targetId: string
  kind: DraftKind
  /** 展示用：条目编号或采集点名称 */
  code: string
  /** 表单内容（JSON 序列化，按 kind 反序列化） */
  payload: string
  /** 打开时看到的版本；恢复后继续保存仍要做乐观锁校验 */
  baseVersion?: number
  /** 失败原因摘要 */
  reason: string
  updatedBy: string
  updatedAt: string
}

export function draftId(targetId: string, kind: DraftKind): string {
  return `${targetId}:${kind}`
}

export interface DraftState {
  drafts: RecoveryDraft[]
  loaded: boolean
  hydrate: () => Promise<void>
  upsertDraft: (draft: Omit<RecoveryDraft, 'id' | 'updatedAt'> & { updatedAt?: string }) => Promise<void>
  removeDraft: (id: string) => Promise<void>
  draftsOf: (targetId: string) => RecoveryDraft[]
}

export const draftStore = createStore<DraftState>((set, get) => ({
  drafts: [],
  loaded: false,
  hydrate: async () => {
    const drafts = await db.drafts.toArray()
    drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    set({ drafts, loaded: true })
  },
  upsertDraft: async (draft) => {
    const row: RecoveryDraft = {
      ...draft,
      id: draftId(draft.targetId, draft.kind),
      updatedAt: draft.updatedAt ?? new Date().toISOString()
    }
    await db.drafts.put(row)
    await get().hydrate()
    postEvent({ type: 'draft-changed' })
  },
  removeDraft: async (id) => {
    await db.drafts.delete(id)
    await get().hydrate()
    postEvent({ type: 'draft-changed' })
  },
  draftsOf: (targetId) => get().drafts.filter((item) => item.targetId === targetId)
}))

/** 草稿的中文类型名 */
export const DRAFT_KIND_LABELS: Record<DraftKind, string> = {
  record: '形态描述',
  spore: '孢子印观察',
  point: '采集点信息'
}
