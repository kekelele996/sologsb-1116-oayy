<script setup lang="ts">
import { computed } from 'vue'
import type { VersionedRow } from '@/types'
import { ROLE_LABELS } from '@/types'
import { formatDateTime } from '@/utils/versionMeta'

const props = withDefaults(
  defineProps<{
    row: VersionedRow
    /** 是否同时显示最后修改人 / 时间 */
    detailed?: boolean
    size?: 'small' | 'default'
  }>(),
  { detailed: false, size: 'small' }
)

const tagType = computed(() => (props.row.owner === 'recorder' ? 'success' : 'primary'))
</script>

<template>
  <el-tag :type="tagType" :size="size" effect="plain" class="version-badge">
    v{{ row.version }} · {{ ROLE_LABELS[row.owner] }}
    <template v-if="detailed">
      · {{ row.updatedBy || '未署名' }} · {{ formatDateTime(row.updatedAt) }}
    </template>
  </el-tag>
</template>

<style scoped>
.version-badge {
  font-variant-numeric: tabular-nums;
}
</style>
