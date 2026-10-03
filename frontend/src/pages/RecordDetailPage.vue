<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { CollectPoint, SporeColor, SporePrint } from '@/types'
import { SPORE_COLORS } from '@/types'
import type { FieldConflict } from '@/types/concurrency'
import { ConflictError } from '@/types/concurrency'
import GeoPointForm from '@/components/common/GeoPointForm.vue'
import GillAttachmentTag from '@/components/common/GillAttachmentTag.vue'
import SporePrintSwatch from '@/components/common/SporePrintSwatch.vue'
import TraitsSummary from '@/components/common/TraitsSummary.vue'
import ConflictDialog from '@/components/common/ConflictDialog.vue'
import { useStore } from '@/hooks/usePersistentStore'
import { useEditorLock } from '@/hooks/useEditorLock'
import { useVersionedDraft } from '@/hooks/useVersionedDraft'
import { recordStore } from '@/stores/recordStore'
import { sporeStore } from '@/stores/sporeStore'
import { pointStore } from '@/stores/pointStore'
import { identifyStore } from '@/stores/identifyStore'
import { sporeColorHex } from '@/utils/spore'
import { uid } from '@/utils/id'

const route = useRoute()
const router = useRouter()
const recordState = useStore(recordStore)
const sporeState = useStore(sporeStore)
const pointState = useStore(pointStore)
const identifyState = useStore(identifyStore)

const record = computed(() => recordState.records.find((item) => item.id === route.params.id) ?? null)
const spore = computed(() => sporeState.spores.find((item) => item.recordId === record.value?.id) ?? null)
const point = computed(() => pointState.points.find((item) => item.id === record.value?.pointId) ?? null)
const logs = computed(() => identifyState.logs.filter((item) => item.recordId === record.value?.id))
/** 当前条目所属采集点名称 */
const recordPointName = computed(() => point.value?.name ?? '未关联')

// 编辑锁：记录员角色，同一条目同一时间只允许一个窗口写
const { readOnly, lockHolder } = useEditorLock(
  'record',
  computed(() => record.value?.id ?? ''),
  'recorder'
)

// 版本化草稿：固定打开时的版本与快照
const {
  baseVersion: sporeBaseVersion,
  baseSnapshot: sporeBaseSnapshot,
  reset: resetSporeVersion,
  commit: commitSpore
} = useVersionedDraft(spore)
const {
  baseVersion: pointBaseVersion,
  baseSnapshot: pointBaseSnapshot,
  reset: resetPointVersion,
  commit: commitPoint
} = useVersionedDraft(point)

const sporeForm = reactive({
  id: '',
  color: '白色' as SporeColor,
  shape: '',
  hours: 12,
  observeDate: new Date().toISOString().slice(0, 10),
  moisture: ''
})

const pointDraft = reactive<CollectPoint>({
  id: '',
  name: '',
  longitude: 0,
  latitude: 0,
  altitude: 0,
  vegetation: '针阔混交林',
  substrate: '落叶层',
  companionTrees: '',
  collectDate: '',
  collector: '',
  recorder: '',
  version: 1
})

// 冲突对话框
const conflictVisible = ref(false)
const conflictConflicts = ref<FieldConflict[]>([])
const conflictBaseVersion = ref(1)
const conflictCurrentVersion = ref(1)

function showConflict(e: ConflictError): void {
  conflictConflicts.value = e.conflicts
  conflictBaseVersion.value = e.baseVersion
  conflictCurrentVersion.value = e.currentVersion
  conflictVisible.value = true
}

/** 从 store 最新数据同步表单与版本基准 */
function syncForms(): void {
  const currentSpore = spore.value
  if (currentSpore) {
    sporeForm.id = currentSpore.id
    sporeForm.color = currentSpore.color
    sporeForm.shape = currentSpore.shape
    sporeForm.hours = currentSpore.hours
    sporeForm.observeDate = currentSpore.observeDate
    sporeForm.moisture = currentSpore.moisture
    resetSporeVersion(currentSpore)
  }
  const currentPoint = point.value
  if (currentPoint) {
    Object.assign(pointDraft, currentPoint)
    resetPointVersion(currentPoint)
  }
}

watch(
  () => [record.value?.id, spore.value?.id, pointState.points.length] as const,
  () => {
    syncForms()
  },
  { immediate: true }
)

/** 重新载入 store 并同步表单（冲突后重试） */
async function refreshFromStore(): Promise<void> {
  await Promise.all([sporeStore.getState().hydrate(), pointStore.getState().hydrate()])
  syncForms()
}

async function handleRetry(): Promise<void> {
  await refreshFromStore()
  ElMessage.info('已载入最新版本，请重新编辑后保存')
}

async function saveSpore(): Promise<void> {
  if (!record.value) return
  const row: SporePrint = {
    id: sporeForm.id || uid('spo'),
    recordId: record.value.id,
    color: sporeForm.color,
    shape: sporeForm.shape.trim(),
    hours: Number(sporeForm.hours) || 0,
    observeDate: sporeForm.observeDate,
    moisture: sporeForm.moisture.trim(),
    recorder: spore.value?.recorder || record.value.recorder || '',
    version: spore.value?.version ?? 1
  }
  try {
    const result = await sporeStore
      .getState()
      .save(row, sporeBaseVersion.value, sporeBaseSnapshot.value ?? row)
    commitSpore(result.saved)
    sporeForm.id = row.id
    ElMessage.success(`孢子印观察已记录：${row.color}`)
  } catch (e) {
    if (e instanceof ConflictError) {
      showConflict(e)
    } else {
      throw e
    }
  }
}

async function savePoint(): Promise<void> {
  if (!pointDraft.name.trim()) {
    ElMessage.warning('采集点名称不能为空')
    return
  }
  try {
    const result = await pointStore
      .getState()
      .save({ ...pointDraft }, pointBaseVersion.value, pointBaseSnapshot.value ?? { ...pointDraft })
    commitPoint(result.saved)
    ElMessage.success('采集点信息已更新')
  } catch (e) {
    if (e instanceof ConflictError) {
      showConflict(e)
    } else {
      throw e
    }
  }
}

async function removeSpore(): Promise<void> {
  if (!sporeForm.id) return
  await sporeStore.getState().remove(sporeForm.id)
  sporeForm.id = ''
  ElMessage.success('孢子印记录已删除')
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div v-if="record">
        <h2 class="page-title">{{ record.tempName || '未命名条目' }}</h2>
        <p class="page-sub">
          <span class="mono">{{ record.code }}</span> · 采集点
          {{ recordPointName }} · 采集日期
          {{ record.collectDate }} · 采集人 {{ record.collector || '—' }}
          <el-tag size="small" effect="plain" round class="ver-tag">记录稿 v{{ record.version }}</el-tag>
        </p>
      </div>
      <div v-else>
        <h2 class="page-title">条目详情</h2>
        <p class="page-sub">未找到该条目，可能已被删除。</p>
      </div>
      <div class="head-actions">
        <el-button @click="router.push('/atlas')">返回图谱</el-button>
        <el-button v-if="record" @click="router.push('/identify')">去鉴定</el-button>
      </div>
    </div>

    <el-alert
      v-if="readOnly"
      class="lock-banner"
      type="warning"
      show-icon
      :title="`该条目正被其他窗口编辑（会话 ${lockHolder ?? '未知'}），当前为只读模式。对方关闭窗口或超时后将自动释放。`"
    />

    <template v-if="record">
      <el-card shadow="never" class="block">
        <template #header>
          <div class="block-head">
            <span>形态描述</span>
            <GillAttachmentTag :attachment="record.attachment" with-hint />
          </div>
        </template>
        <TraitsSummary :record="record" :spore="spore" :default-open="['cap', 'flesh', 'gill', 'stipe', 'eco']" />
        <p v-if="record.note" class="note">现场备注：{{ record.note }}</p>
      </el-card>

      <el-card shadow="never" class="block">
        <template #header>
          <div class="block-head">
            <span>孢子印观察</span>
            <SporePrintSwatch :color="spore?.color ?? null" size="large" :caption="spore ? `获取 ${spore.hours} h` : '尚未记录'" />
          </div>
        </template>
        <div class="spore-body">
          <div class="spore-current" :style="{ background: spore ? sporeColorHex(spore.color) : '#f2f4f6' }">
            <div v-if="spore" class="spore-info">
              <p class="spore-color">{{ spore.color }}</p>
              <p class="spore-meta">印形：{{ spore.shape || '—' }}</p>
              <p class="spore-meta">时长：{{ spore.hours }} 小时 · 观察日期 {{ spore.observeDate }}</p>
              <p class="spore-meta">样本干湿度：{{ spore.moisture || '—' }}</p>
            </div>
            <p v-else class="spore-empty">该条目尚未登记孢子印观察</p>
          </div>
          <el-form label-width="92px" class="spore-form">
            <el-form-item label="印色">
              <el-select v-model="sporeForm.color" style="width: 100%" :disabled="readOnly">
                <el-option v-for="color in SPORE_COLORS" :key="color" :label="color" :value="color" />
              </el-select>
            </el-form-item>
            <el-form-item label="印形">
              <el-input v-model="sporeForm.shape" placeholder="如 圆形印痕，边缘略散" :disabled="readOnly" />
            </el-form-item>
            <el-form-item label="时长(h)">
              <el-input-number v-model="sporeForm.hours" :min="0" :step="1" :controls="false" style="width: 100%" :disabled="readOnly" />
            </el-form-item>
            <el-form-item label="观察日期">
              <el-date-picker v-model="sporeForm.observeDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" :disabled="readOnly" />
            </el-form-item>
            <el-form-item label="干湿度">
              <el-input v-model="sporeForm.moisture" type="textarea" :rows="2" placeholder="如 子实体偏干，印痕较薄" :disabled="readOnly" />
            </el-form-item>
            <div class="form-actions">
              <el-button type="primary" :disabled="readOnly" @click="saveSpore">{{ sporeForm.id ? '更新孢子印' : '登记孢子印' }}</el-button>
              <el-button v-if="sporeForm.id" type="danger" plain :disabled="readOnly" @click="removeSpore">删除记录</el-button>
            </div>
          </el-form>
        </div>
      </el-card>

      <el-card shadow="never" class="block">
        <template #header>采集点信息（含经纬度校验）</template>
        <GeoPointForm v-model="pointDraft" with-meta :disabled="readOnly" />
        <div class="form-actions">
          <el-button type="primary" :disabled="readOnly" @click="savePoint">保存采集点</el-button>
        </div>
      </el-card>

      <el-card shadow="never" class="block">
        <template #header>鉴定留痕（{{ logs.length }} 条）</template>
        <el-table :data="logs" border stripe>
          <el-table-column prop="date" label="日期" width="120" />
          <el-table-column prop="conclusion" label="结论学名" min-width="160" />
          <el-table-column prop="basis" label="依据" width="110" />
          <el-table-column label="参考图鉴" min-width="180">
            <template #default="{ row }: { row: { referenceBook: string; referencePage: string } }">
              {{ row.referenceBook || '—' }} {{ row.referencePage }}
            </template>
          </el-table-column>
          <el-table-column prop="confidence" label="置信度" width="90" />
          <el-table-column label="复核" width="110">
            <template #default="{ row }: { row: { needReview: boolean; reviewer: string } }">
              <el-tag v-if="row.needReview" type="warning" size="small" effect="dark">待复核</el-tag>
              <span v-else class="muted">{{ row.reviewer || '已复核' }}</span>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="logs.length === 0" description="尚无鉴定结论，去「鉴定工作页」生成" />
      </el-card>
    </template>

    <ConflictDialog
      v-model:visible="conflictVisible"
      :conflicts="conflictConflicts"
      :base-version="conflictBaseVersion"
      :current-version="conflictCurrentVersion"
      @retry="handleRetry"
    />
  </div>
</template>

<style scoped>
.head-actions {
  display: flex;
  gap: 8px;
}
.ver-tag {
  margin-left: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.lock-banner {
  margin-bottom: 12px;
  border-radius: 8px;
}
.block {
  border-radius: 12px;
  margin-bottom: 16px;
}
.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.note {
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f7f5f0;
  font-size: 12px;
  color: #6f7d72;
}
.spore-body {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
.spore-current {
  flex: 1 1 260px;
  min-height: 180px;
  border-radius: 12px;
  border: 1px solid #e8e2d6;
  padding: 16px;
  display: flex;
  align-items: center;
}
.spore-info p {
  margin: 2px 0;
}
.spore-color {
  font-size: 20px;
  font-weight: 700;
}
.spore-meta {
  font-size: 12px;
  color: #4b5b50;
}
.spore-empty {
  font-size: 13px;
  color: #7f8d82;
}
.spore-form {
  flex: 1 1 320px;
}
.form-actions {
  display: flex;
  gap: 8px;
  padding-left: 92px;
}
</style>
