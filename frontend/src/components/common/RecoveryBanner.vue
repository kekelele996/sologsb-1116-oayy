<script setup lang="ts">
import { ElMessageBox } from 'element-plus'
import { DRAFT_KIND_LABELS, type RecoveryDraft } from '@/stores/draftStore'
import { formatDateTime } from '@/utils/versionMeta'

const props = withDefaults(
  defineProps<{
    drafts: RecoveryDraft[]
    /** 横幅标题，说明这些草稿属于哪一页 / 哪一条 */
    title?: string
  }>(),
  { title: '有上次中途失败、尚未写库的录入内容' }
)

const emit = defineEmits<{
  (event: 'resume', draft: RecoveryDraft): void
  (event: 'discard', draft: RecoveryDraft): void
}>()

async function discard(draft: RecoveryDraft): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认丢弃这份「${DRAFT_KIND_LABELS[draft.kind]}」草稿？丢弃后不能找回。`,
      '丢弃草稿',
      { type: 'warning' }
    )
  } catch {
    return
  }
  emit('discard', draft)
}
</script>

<template>
  <el-alert v-if="props.drafts.length" type="warning" show-icon :closable="false" class="recovery-banner">
    <template #title>{{ props.title }}（{{ props.drafts.length }}）</template>
    <template #default>
      <div class="draft-list">
        <div v-for="draft in props.drafts" :key="draft.id" class="draft-row">
          <div class="draft-info">
            <el-tag size="small" effect="plain">{{ DRAFT_KIND_LABELS[draft.kind] }}</el-tag>
            <span class="draft-code">{{ draft.code || '未命名目标' }}</span>
            <span class="draft-meta">
              基于 v{{ draft.baseVersion ?? '?' }} · {{ draft.updatedBy || '未署名' }} ·
              {{ formatDateTime(draft.updatedAt) }}
            </span>
          </div>
          <div class="draft-actions">
            <el-button size="small" type="primary" @click="emit('resume', draft)">恢复重来</el-button>
            <el-button size="small" plain @click="discard(draft)">丢弃</el-button>
          </div>
        </div>
      </div>
      <p class="draft-reason">失败原因：{{ drafts[0]?.reason }}</p>
    </template>
  </el-alert>
</template>

<style scoped>
.recovery-banner {
  margin-bottom: 14px;
}
.draft-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}
.draft-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.draft-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.draft-code {
  font-weight: 600;
  font-size: 13px;
}
.draft-meta {
  font-size: 12px;
  color: #7f8d82;
}
.draft-actions {
  display: flex;
  gap: 6px;
}
.draft-reason {
  margin: 4px 0 0;
  font-size: 12px;
  color: #a45b1f;
}
</style>
