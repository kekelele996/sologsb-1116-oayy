import { createStore } from 'zustand/vanilla'
import type { SporePrint } from '@/types'
import { RECORDER_SPORE_FIELDS, FIELD_LABELS } from '@/types/fields'
import { db, syncAll, syncDelete } from '@/hooks/usePersistentStore'
import { saveWithVersion, type SaveWithVersionResult } from '@/utils/version'

export interface SporeState {
  spores: SporePrint[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 带版本检查的保存；版本冲突时抛出 ConflictError */
  save: (
    spore: SporePrint,
    baseVersion: number,
    baseSnapshot: SporePrint
  ) => Promise<SaveWithVersionResult<SporePrint>>
  remove: (id: string) => Promise<void>
  removeByRecord: (recordId: string) => Promise<void>
}

export const sporeStore = createStore<SporeState>((set, get) => ({
  spores: [],
  loaded: false,
  hydrate: async () => {
    const spores = await syncAll<SporePrint>(db.spores)
    spores.sort((a, b) => b.observeDate.localeCompare(a.observeDate))
    set({ spores, loaded: true })
  },
  save: async (spore, baseVersion, baseSnapshot) => {
    const result = await saveWithVersion<SporePrint>({
      table: db.spores,
      kind: 'spore',
      id: spore.id,
      draft: spore,
      baseVersion,
      baseSnapshot,
      editableFields: RECORDER_SPORE_FIELDS,
      fieldLabels: FIELD_LABELS
    })
    await get().hydrate()
    return result
  },
  remove: async (id) => {
    await syncDelete<SporePrint>(db.spores, id)
    await get().hydrate()
  },
  removeByRecord: async (recordId) => {
    const targets = get().spores.filter((item) => item.recordId === recordId)
    await Promise.all(targets.map((item) => syncDelete<SporePrint>(db.spores, item.id)))
    await get().hydrate()
  }
}))
