import { createStore } from 'zustand/vanilla'
import type { FungusRecord } from '@/types'
import { RECORDER_RECORD_FIELDS, FIELD_LABELS } from '@/types/fields'
import { db, syncAll, syncDelete } from '@/hooks/usePersistentStore'
import { saveWithVersion, type SaveWithVersionResult } from '@/utils/version'

export interface RecordState {
  records: FungusRecord[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 带版本检查的保存；版本冲突时抛出 ConflictError */
  save: (
    record: FungusRecord,
    baseVersion: number,
    baseSnapshot: FungusRecord
  ) => Promise<SaveWithVersionResult<FungusRecord>>
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
  save: async (record, baseVersion, baseSnapshot) => {
    const result = await saveWithVersion<FungusRecord>({
      table: db.records,
      kind: 'record',
      id: record.id,
      draft: record,
      baseVersion,
      baseSnapshot,
      editableFields: RECORDER_RECORD_FIELDS,
      fieldLabels: FIELD_LABELS
    })
    await get().hydrate()
    return result
  },
  remove: async (id) => {
    await syncDelete<FungusRecord>(db.records, id)
    await get().hydrate()
  }
}))
