import { createStore } from 'zustand/vanilla'
import type { FungusRecord, NewRow } from '@/types'
import { ROLE_RECORDER } from '@/types'
import { db, syncAll, syncDelete } from '@/hooks/usePersistentStore'
import { saveVersioned, type SaveOutcome } from '@/concurrency/versioning'
import { postEvent } from '@/concurrency/bus'

export interface RecordState {
  records: FungusRecord[]
  loaded: boolean
  hydrate: () => Promise<void>
  /**
   * 保存形态条目（记录员域）。
   * - 新建：base 不传；
   * - 修改：base 必须是打开编辑时看到的整行，用于版本核对与冲突字段定位。
   */
  save: (
    row: FungusRecord | NewRow<FungusRecord>,
    base: FungusRecord | undefined,
    editor: string
  ) => Promise<SaveOutcome<FungusRecord>>
  remove: (id: string) => Promise<void>
}

export const recordStore = createStore<RecordState>((set, get) => ({
  records: [],
  loaded: false,
  hydrate: async () => {
    const records = await syncAll<FungusRecord>(db.records)
    records.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))
    set({ records, loaded: true })
  },
  save: async (row, base, editor) => {
    const outcome = await saveVersioned(db.records, 'records', ROLE_RECORDER, row, { base, editor })
    await get().hydrate()
    postEvent({ type: 'data-changed', domain: 'records' })
    return outcome
  },
  remove: async (id) => {
    await syncDelete(db.records, id)
    await get().hydrate()
    postEvent({ type: 'data-changed', domain: 'records' })
  }
}))
