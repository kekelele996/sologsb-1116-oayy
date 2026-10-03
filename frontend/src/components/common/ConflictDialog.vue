<script setup lang="ts">
import type { FieldConflict } from '@/types/concurrency'

defineProps<{
  visible: boolean
  conflicts: FieldConflict[]
  baseVersion: number
  currentVersion: number
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'retry'): void
}>()

function formatValue(value: unknown): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function close(): void {
  emit('update:visible', false)
}

function retry(): void {
  emit('retry')
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="保存冲突：他人已修改此条目"
    width="720px"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="conflict-tip">
      你打开时版本为 <b>v{{ baseVersion }}</b>，当前已被他人更新到 <b>v{{ currentVersion }}</b>。
      以下字段双方都做了修改，直接保存会盖掉对方的改动，已停止写入旧值。
    </div>
    <el-table :data="conflicts" border stripe size="small" class="conflict-table">
      <el-table-column prop="label" label="字段" width="120" />
      <el-table-column label="你打开时" min-width="140">
        <template #default="{ row }">{{ formatValue(row.baseValue) }}</template>
      </el-table-column>
      <el-table-column label="你的修改" min-width="140">
        <template #default="{ row }">
          <span class="your-value">{{ formatValue(row.yourValue) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="对方修改" min-width="140">
        <template #default="{ row }">
          <span class="their-value">{{ formatValue(row.theirValue) }}</span>
        </template>
      </el-table-column>
    </el-table>
    <div class="conflict-hint">点击「刷新并重试」将载入对方最新版本，在此基础上重新编辑。</div>
    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" @click="retry">刷新并重试</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.conflict-tip {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #fdf6ec;
  border: 1px solid #f5dab1;
  color: #8a5a1f;
  font-size: 13px;
  line-height: 1.6;
}
.conflict-table {
  width: 100%;
}
.your-value {
  color: #2f7a4d;
  font-weight: 600;
}
.their-value {
  color: #c0392b;
  font-weight: 600;
}
.conflict-hint {
  margin-top: 10px;
  font-size: 12px;
  color: #7f8d82;
}
</style>
