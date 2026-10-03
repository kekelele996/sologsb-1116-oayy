import { ref, watch, type Ref } from 'vue'

export interface VersionedDraft<T extends { id: string; version?: number }> {
  /** 打开时看到的版本 */
  baseVersion: Ref<number>
  /** 打开时的快照（深拷贝，不随后续 hydrate 变化） */
  baseSnapshot: Ref<T | null>
  /** 重置基准（切换实体时调用） */
  reset: (item: T) => void
  /** 保存成功后提交基准（更新为最新版本，避免下次保存误判冲突） */
  commit: (saved: T) => void
}

/**
 * 版本化草稿：固定打开时的版本与快照，用于乐观并发控制。
 * 实体 id 变化时自动重置基准；保存成功后需调用 commit 更新基准。
 */
export function useVersionedDraft<T extends { id: string; version?: number }>(
  source: Ref<T | null | undefined>
): VersionedDraft<T> {
  const baseVersion = ref(1) as Ref<number>
  const baseSnapshot = ref<T | null>(null) as Ref<T | null>

  function reset(item: T): void {
    baseVersion.value = item.version ?? 1
    baseSnapshot.value = structuredClone(item)
  }

  function commit(saved: T): void {
    baseVersion.value = saved.version ?? 1
    baseSnapshot.value = structuredClone(saved)
  }

  watch(
    () => source.value?.id,
    () => {
      if (source.value) {
        reset(source.value)
      } else {
        baseSnapshot.value = null
      }
    },
    { immediate: true }
  )

  return { baseVersion, baseSnapshot, reset, commit }
}
