import { createStore } from 'zustand/vanilla'
import type { CollectPoint } from '@/types'
import { RECORDER_POINT_FIELDS, FIELD_LABELS } from '@/types/fields'
import { db, syncAll, syncDelete } from '@/hooks/usePersistentStore'
import { saveWithVersion, type SaveWithVersionResult } from '@/utils/version'

export interface PointState {
  points: CollectPoint[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 带版本检查的保存；版本冲突时抛出 ConflictError */
  save: (
    point: CollectPoint,
    baseVersion: number,
    baseSnapshot: CollectPoint
  ) => Promise<SaveWithVersionResult<CollectPoint>>
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
  save: async (point, baseVersion, baseSnapshot) => {
    const result = await saveWithVersion<CollectPoint>({
      table: db.points,
      kind: 'point',
      id: point.id,
      draft: point,
      baseVersion,
      baseSnapshot,
      editableFields: RECORDER_POINT_FIELDS,
      fieldLabels: FIELD_LABELS
    })
    await get().hydrate()
    return result
  },
  remove: async (id) => {
    await syncDelete<CollectPoint>(db.points, id)
    await get().hydrate()
  }
}))
