<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { CollectPoint, NewRow, SporeColor, SporePrint } from '@/types'
import { ROLE_RECORDER, SPORE_COLORS } from '@/types'
import GeoPointForm from '@/components/common/GeoPointForm.vue'
import GillAttachmentTag from '@/components/common/GillAttachmentTag.vue'
import SporePrintSwatch from '@/components/common/SporePrintSwatch.vue'
import TraitsSummary from '@/components/common/TraitsSummary.vue'
import VersionBadge from '@/components/common/VersionBadge.vue'
import RecoveryBanner from '@/components/common/RecoveryBanner.vue'
import { useStore } from '@/hooks/usePersistentStore'
import { useEditLock } from '@/hooks/useEditLock'
import { recordStore } from '@/stores/recordStore'
import { sporeStore } from '@/stores/sporeStore'
import { pointStore } from '@/stores/pointStore'
import { identifyStore } from '@/stores/identifyStore'
import { sessionStore, currentEditorName } from '@/stores/sessionStore'
import { draftStore, type RecoveryDraft } from '@/stores/draftStore'
import { reportSaveError } from '@/concurrency/saveErrors'
import { sporeColorHex } from '@/utils/spore'
import { uid } from '@/utils/id'

const route = useRoute()
const router = useRouter()
const recordState = useStore(recordStore)
const sporeState = useStore(sporeStore)
const pointState = useStore(pointStore)
const identifyState = useStore(identifyStore)
const session = useStore(sessionStore)
const draftState = useStore(draftStore)

const isRecorder = computed(() => session.role === ROLE_RECORDER)

const recordId = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))

/** 整条目一把写锁：本窗口拿到后，形态（图谱页）/ 孢子印 / 采集点保存都放行；别的窗口只读 */
const entryLock = useEditLock({
  scope: 'entry',
  targetId: recordId,
  role: () => ROLE_RECORDER
})

const record = computed(() => recordState.records.find((item) => item.id === recordId.value) ?? null)
const spore = computed(() => sporeState.spores.find((item) => item.recordId === recordId.value) ?? null)
/** 本条目关联的采集点（响应式跟随版本号变化） */
const linkedPoint = computed(() =>
  record.value ? pointState.points.find((item) => item.id === record.value?.pointId) ?? null : null
)
const logs = computed(() => identifyState.logs.filter((item) => item.recordId === recordId.value))
/** 当前条目所属采集点名称（在脚本内取，避免模板内箭头函数丢失空值收窄） */
const recordPointName = computed(() => {
  const current = record.value
  if (!current) return '未关联'
  return pointState.points.find((item) => item.id === current.pointId)?.name ?? '未关联'
})

const sporeForm = reactive({
  id: '',
  color: '白色' as SporeColor,
  shape: '',
  hours: 12,
  observeDate: new Date().toISOString().slice(0, 10),
  moisture: ''
})
/** 孢子印打开时快照（版本基准） */
const baseSpore = ref<SporePrint | null>(null)

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
  // VersionedRow 占位，实际值以库里为准
  version: 0,
  owner: 'recorder',
  updatedBy: '',
  updatedAt: ''
})
/** 采集点打开时快照（版本基准） */
const basePoint = ref<CollectPoint | null>(null)

watch(
  // 监听版本号：别的窗口保存后广播刷新，版本一变就重新载入表单与基准快照（只读期安全，持锁期别人写不了）
  () => [record.value?.id, spore.value?.id, spore.value?.version, linkedPoint.value?.version] as const,
  () => {
    if (!record.value) return
    const current = spore.value
    if (current) {
      baseSpore.value = current
      sporeForm.id = current.id
      sporeForm.color = current.color
      sporeForm.shape = current.shape
      sporeForm.hours = current.hours
      sporeForm.observeDate = current.observeDate
      sporeForm.moisture = current.moisture
    } else {
      baseSpore.value = null
    }
    if (linkedPoint.value) {
      basePoint.value = linkedPoint.value
      Object.assign(pointDraft, linkedPoint.value)
    }
  },
  { immediate: true }
)

// 记录员进入详情页即尝试取得写权；鉴定人不需要（本页对其只读）
watch(
  [isRecorder, recordId],
  async ([recorder]) => {
    if (recorder && recordId.value && !entryLock.writable.value && !entryLock.heldByOther.value) {
      await entryLock.request()
    }
  },
  { immediate: true }
)

/** 本条目的录入草稿（形态草稿跳回图谱页恢复，孢子印 / 采集点在此就地恢复） */
const entryDrafts = computed(() => draftState.drafts.filter((item) => item.targetId === recordId.value))

async function stashSporeDraft(reason: string): Promise<void> {
  if (!record.value) return
  await draftStore.getState().upsertDraft({
    scope: 'entry',
    targetId: record.value.id,
    kind: 'spore',
    code: record.value.code,
    payload: JSON.stringify(sporeForm),
    baseVersion: baseSpore.value?.version,
    reason,
    updatedBy: currentEditorName() || '未署名'
  })
}

async function stashPointDraft(reason: string): Promise<void> {
  if (!pointDraft.id) return
  await draftStore.getState().upsertDraft({
    scope: 'point',
    targetId: pointDraft.id,
    kind: 'point',
    code: pointDraft.name || '采集点',
    payload: JSON.stringify(pointDraft),
    baseVersion: basePoint.value?.version,
    reason,
    updatedBy: currentEditorName() || '未署名'
  })
}

async function saveSpore(): Promise<void> {
  if (!record.value) return
  if (!entryLock.writable.value) {
    ElMessage.warning('写权在另一窗口，孢子印当前只读；等对方关闭后点「申请写权」')
    return
  }
  const row: SporePrint | NewRow<SporePrint> = {
    id: sporeForm.id || uid('spo'),
    recordId: record.value.id,
    color: sporeForm.color,
    shape: sporeForm.shape.trim(),
    hours: Number(sporeForm.hours) || 0,
    observeDate: sporeForm.observeDate,
    moisture: sporeForm.moisture.trim()
  }
  try {
    const outcome = await sporeStore
      .getState()
      .save(row, baseSpore.value ?? undefined, currentEditorName())
    sporeForm.id = outcome.row.id
    baseSpore.value = outcome.row
    await draftStore.getState().removeDraft(`${record.value.id}:spore`).catch(() => undefined)
    ElMessage.success(`孢子印观察已记录：${outcome.row.color}（v${outcome.version}）`)
  } catch (error) {
    const result = await reportSaveError(error, '孢子印')
    if (!result.ownership) {
      await stashSporeDraft(result.message)
      ElMessage.info('本次未写入；内容已留为草稿，可在上方横幅恢复')
    }
  }
}

async function savePoint(): Promise<void> {
  if (!pointDraft.name.trim()) {
    ElMessage.warning('采集点名称不能为空')
    return
  }
  if (!entryLock.writable.value) {
    ElMessage.warning('写权在另一窗口，采集点当前只读')
    return
  }
  try {
    const outcome = await pointStore
      .getState()
      .save({ ...pointDraft }, basePoint.value ?? undefined, currentEditorName())
    basePoint.value = outcome.row
    Object.assign(pointDraft, outcome.row)
    await draftStore.getState().removeDraft(`${pointDraft.id}:point`).catch(() => undefined)
    ElMessage.success(`采集点信息已更新（v${outcome.version}）`)
  } catch (error) {
    const result = await reportSaveError(error, '采集点')
    if (!result.ownership) {
      await stashPointDraft(result.message)
      ElMessage.info('本次未写入；内容已留为草稿，可在上方横幅恢复')
    }
  }
}

async function removeSpore(): Promise<void> {
  if (!sporeForm.id) return
  if (!entryLock.writable.value) {
    ElMessage.warning('写权在另一窗口，不能删除')
    return
  }
  await sporeStore.getState().remove(sporeForm.id)
  sporeForm.id = ''
  baseSpore.value = null
  await draftStore.getState().removeDraft(`${recordId.value}:spore`).catch(() => undefined)
  ElMessage.success('孢子印记录已删除')
}

async function resumeDraft(draft: RecoveryDraft): Promise<void> {
  if (draft.kind === 'record') {
    ElMessage.info('形态草稿请回到图谱总览点「恢复重来」')
    void router.push('/atlas')
    return
  }
  if (!entryLock.writable.value) {
    const granted = await entryLock.request()
    if (!granted) {
      ElMessage.warning('写权在另一窗口，拿到写权后再恢复草稿')
      return
    }
  }
  try {
    if (draft.kind === 'spore') {
      Object.assign(sporeForm, JSON.parse(draft.payload))
      ElMessage.success('孢子印草稿已载入表单，核对后保存')
    } else if (draft.kind === 'point') {
      Object.assign(pointDraft, JSON.parse(draft.payload))
      ElMessage.success('采集点草稿已载入表单，核对后保存')
    }
  } catch {
    ElMessage.error('草稿内容已损坏')
  }
}

const readonlyReason = computed(() => {
  if (!isRecorder.value) return '当前是鉴定人身份：采集点、形态、孢子印归记录员填写（本页只读）'
  if (entryLock.heldByOther.value)
    return `只读：同一条目写权在「${entryLock.lock.value?.holderName ?? '另一窗口'}」，对方关闭或卡死后自动放开`
  if (entryLock.lost.value) return '写权已丢失（对方可能在租约过期后取得），当前只读'
  return ''
})
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
        </p>
        <div class="head-meta">
          <VersionBadge :row="record" detailed />
          <el-tag v-if="spore" type="success" size="small" effect="plain">
            孢子印 v{{ spore.version }}
          </el-tag>
          <el-tag v-if="basePoint" type="success" size="small" effect="plain">
            采集点 v{{ basePoint.version }}
          </el-tag>
        </div>
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
      v-if="record && readonlyReason"
      :type="isRecorder ? 'warning' : 'info'"
      :closable="false"
      class="lock-alert"
      :title="readonlyReason"
    >
      <template v-if="isRecorder && !entryLock.writable.value">
        <el-button size="small" :loading="entryLock.acquiring.value" @click="entryLock.request()">申请写权</el-button>
      </template>
    </el-alert>
    <el-alert
      v-else-if="record && entryLock.writable.value"
      type="success"
      :closable="false"
      class="lock-alert"
      title="本窗口持有该条目的写权，其它打开同一条目的窗口（含鉴定页）为只读；关闭本页自动放开。"
    />

    <RecoveryBanner
      v-if="record && entryDrafts.length"
      :drafts="entryDrafts"
      :title="`本条目的未恢复草稿（记录员侧恢复）`"
      @resume="resumeDraft"
      @discard="(draft) => draftStore.getState().removeDraft(draft.id)"
    />

    <template v-if="record">
      <el-card shadow="never" class="block">
        <template #header>
          <div class="block-head">
            <span>形态描述（记录员域，去图谱总览「补形态」修改）</span>
            <GillAttachmentTag :attachment="record.attachment" with-hint />
          </div>
        </template>
        <TraitsSummary :record="record" :spore="spore" :default-open="['cap', 'flesh', 'gill', 'stipe', 'eco']" />
        <p v-if="record.note" class="note">现场备注：{{ record.note }}</p>
      </el-card>

      <el-card shadow="never" class="block">
        <template #header>
          <div class="block-head">
            <span>孢子印观察（记录员域）</span>
            <SporePrintSwatch
              :color="spore?.color ?? null"
              size="large"
              :caption="spore ? `v${spore.version} · 获取 ${spore.hours} h` : '尚未记录'"
            />
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
            <fieldset :disabled="!entryLock.writable.value" class="inline-fieldset">
            <el-form-item label="印色">
              <el-select v-model="sporeForm.color" style="width: 100%">
                <el-option v-for="color in SPORE_COLORS" :key="color" :label="color" :value="color" />
              </el-select>
            </el-form-item>
            <el-form-item label="印形">
              <el-input v-model="sporeForm.shape" placeholder="如 圆形印痕，边缘略散" />
            </el-form-item>
            <el-form-item label="时长(h)">
              <el-input-number v-model="sporeForm.hours" :min="0" :step="1" :controls="false" style="width: 100%" />
            </el-form-item>
            <el-form-item label="观察日期">
              <el-date-picker v-model="sporeForm.observeDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
            <el-form-item label="干湿度">
              <el-input v-model="sporeForm.moisture" type="textarea" :rows="2" placeholder="如 子实体偏干，印痕较薄" />
            </el-form-item>
            <div class="form-actions">
              <el-button type="primary" :disabled="!entryLock.writable.value" @click="saveSpore">
                {{ sporeForm.id ? `更新孢子印（基于 v${baseSpore?.version ?? '?'}）` : '登记孢子印' }}
              </el-button>
              <el-button
                v-if="sporeForm.id"
                type="danger"
                plain
                :disabled="!entryLock.writable.value"
                @click="removeSpore"
              >
                删除记录
              </el-button>
            </div>
            </fieldset>
          </el-form>
        </div>
      </el-card>

      <el-card shadow="never" class="block">
        <template #header>
          采集点信息（记录员域，含经纬度校验）
          <span v-if="basePoint" class="muted-inline"> · 打开版本 v{{ basePoint.version }}</span>
        </template>
        <fieldset :disabled="!entryLock.writable.value" class="inline-fieldset">
          <GeoPointForm v-model="pointDraft" with-meta />
          <div class="form-actions">
            <el-button type="primary" :disabled="!entryLock.writable.value" @click="savePoint">
              保存采集点（基于 v{{ basePoint?.version ?? '?' }}）
            </el-button>
          </div>
        </fieldset>
      </el-card>

      <el-card shadow="never" class="block">
        <template #header>鉴定留痕（鉴定人域，{{ logs.length }} 条；去鉴定工作页写结论/复核）</template>
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
          <el-table-column label="版本" width="80">
            <template #default="{ row }: { row: { version: number } }">
              <span class="mono muted">v{{ row.version }}</span>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="logs.length === 0" description="尚无鉴定结论，去「鉴定工作页」生成" />
      </el-card>
    </template>
  </div>
</template>

<style scoped>
.head-actions {
  display: flex;
  gap: 8px;
}
.head-meta {
  display: flex;
  gap: 8px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.lock-alert {
  margin-bottom: 12px;
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
.muted-inline {
  font-size: 12px;
  color: #7f8d82;
  font-weight: 400;
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
.inline-fieldset[disabled] {
  border: 0;
  padding: 0;
  opacity: 0.8;
}
.form-actions {
  display: flex;
  gap: 8px;
  padding-left: 92px;
}
</style>
