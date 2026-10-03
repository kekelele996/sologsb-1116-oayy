import { createStore } from 'zustand/vanilla'
import type { CollectPoint, NewRow } from '@/types'
import { ROLE_RECORDER } from '@/types'
import { db, syncAll, syncDelete } from '@/hooks/usePersistentStore'
import { saveVersioned, type SaveOutcome } from '@/concurrency/versioning'
import { postEvent } from '@/concurrency/bus'

export interface PointState {
  points: CollectPoint[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 保存采集点（记录员域），base 为打开时看到的整行 */
  save: (
    row: CollectPoint | NewRow<CollectPoint>,
    base: CollectPoint | undefined,
    editor: string
  ) => Promise<SaveOutcome<CollectPoint>>
  remove: (id: string) => Promise<void>
}

export const pointStore = createStore<PointState>((set, get) => ({
  points: [],
  loaded: false,
  hydrate: async () => {
    const points = await syncAll<CollectPoint>(db.points)
    points.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    set({ points, loaded: true })
  },
  save: async (row, base, editor) => {
    const outcome = await saveVersioned(db.points, 'points', ROLE_RECORDER, row, { base, editor })
    await get().hydrate()
    postEvent({ type: 'data-changed', domain: 'points' })
    return outcome
  },
  remove: async (id) => {
    await syncDelete(db.points, id)
    await get().hydrate()
    postEvent({ type: 'data-changed', domain: 'points' })
  }
}))
