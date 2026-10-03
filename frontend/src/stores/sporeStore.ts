import { createStore } from 'zustand/vanilla'
import type { NewRow, SporePrint } from '@/types'
import { ROLE_RECORDER } from '@/types'
import { db, syncAll, syncDelete } from '@/hooks/usePersistentStore'
import { saveVersioned, type SaveOutcome } from '@/concurrency/versioning'
import { postEvent } from '@/concurrency/bus'

export interface SporeState {
  spores: SporePrint[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 保存孢子印观察（记录员域），base 为打开时看到的整行 */
  save: (
    row: SporePrint | NewRow<SporePrint>,
    base: SporePrint | undefined,
    editor: string
  ) => Promise<SaveOutcome<SporePrint>>
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
  save: async (row, base, editor) => {
    const outcome = await saveVersioned(db.spores, 'spores', ROLE_RECORDER, row, { base, editor })
    await get().hydrate()
    postEvent({ type: 'data-changed', domain: 'spores' })
    return outcome
  },
  remove: async (id) => {
    await syncDelete(db.spores, id)
    await get().hydrate()
    postEvent({ type: 'data-changed', domain: 'spores' })
  },
  removeByRecord: async (recordId) => {
    const targets = get().spores.filter((item) => item.recordId === recordId)
    await Promise.all(targets.map((item) => syncDelete(db.spores, item.id)))
    await get().hydrate()
    postEvent({ type: 'data-changed', domain: 'spores' })
  }
}))
