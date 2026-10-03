import { createStore } from 'zustand/vanilla'
import type { IdentifyLog } from '@/types'
import { IDENTIFIER_LOG_FIELDS, FIELD_LABELS } from '@/types/fields'
import { db, syncAll, syncDelete } from '@/hooks/usePersistentStore'
import { saveWithVersion, type SaveWithVersionResult } from '@/utils/version'

export interface IdentifyState {
  logs: IdentifyLog[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 带版本检查的保存；版本冲突时抛出 ConflictError */
  save: (
    log: IdentifyLog,
    baseVersion: number,
    baseSnapshot: IdentifyLog
  ) => Promise<SaveWithVersionResult<IdentifyLog>>
  remove: (id: string) => Promise<void>
  latestOf: (recordId: string) => IdentifyLog | undefined
}

export const identifyStore = createStore<IdentifyState>((set, get) => ({
  logs: [],
  loaded: false,
  hydrate: async () => {
    const logs = await syncAll<IdentifyLog>(db.identifies)
    logs.sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id))
    set({ logs, loaded: true })
  },
  save: async (log, baseVersion, baseSnapshot) => {
    const result = await saveWithVersion<IdentifyLog>({
      table: db.identifies,
      kind: 'identify',
      id: log.id,
      draft: log,
      baseVersion,
      baseSnapshot,
      editableFields: IDENTIFIER_LOG_FIELDS,
      fieldLabels: FIELD_LABELS
    })
    await get().hydrate()
    return result
  },
  remove: async (id) => {
    await syncDelete<IdentifyLog>(db.identifies, id)
    await get().hydrate()
  },
  latestOf: (recordId) => get().logs.find((item) => item.recordId === recordId)
}))
