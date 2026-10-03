import { createStore } from 'zustand/vanilla'
import type { IdentifyLog, NewRow } from '@/types'
import { ROLE_IDENTIFIER } from '@/types'
import { db, syncAll, syncDelete } from '@/hooks/usePersistentStore'
import { saveVersioned, type SaveOutcome } from '@/concurrency/versioning'
import { postEvent } from '@/concurrency/bus'

export interface IdentifyState {
  logs: IdentifyLog[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 落鉴定结论 / 复核（鉴定人域），base 为修订既有结论时打开的整行 */
  save: (
    row: IdentifyLog | NewRow<IdentifyLog>,
    base: IdentifyLog | undefined,
    editor: string
  ) => Promise<SaveOutcome<IdentifyLog>>
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
  save: async (row, base, editor) => {
    const outcome = await saveVersioned(db.identifies, 'identifies', ROLE_IDENTIFIER, row, { base, editor })
    await get().hydrate()
    postEvent({ type: 'data-changed', domain: 'identifies' })
    return outcome
  },
  remove: async (id) => {
    await syncDelete(db.identifies, id)
    await get().hydrate()
    postEvent({ type: 'data-changed', domain: 'identifies' })
  },
  latestOf: (recordId) => get().logs.find((item) => item.recordId === recordId)
}))
