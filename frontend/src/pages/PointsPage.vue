<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { CollectPoint, NewRow } from '@/types'
import { ROLE_RECORDER } from '@/types'
import GeoPointForm from '@/components/common/GeoPointForm.vue'
import RecoveryBanner from '@/components/common/RecoveryBanner.vue'
import VersionBadge from '@/components/common/VersionBadge.vue'
import { useStore } from '@/hooks/usePersistentStore'
import { useEditLock } from '@/hooks/useEditLock'
import { pointStore } from '@/stores/pointStore'
import { recordStore } from '@/stores/recordStore'
import { sessionStore, currentEditorName } from '@/stores/sessionStore'
import { draftStore, type RecoveryDraft } from '@/stores/draftStore'
import { reportSaveError } from '@/concurrency/saveErrors'
import { uid } from '@/utils/id'

const pointState = useStore(pointStore)
const recordState = useStore(recordStore)
const session = useStore(sessionStore)
const draftState = useStore(draftStore)

const isRecorder = computed(() => session.role === ROLE_RECORDER)

const editingId = ref<string | null>(null)
/** 打开编辑时快照（版本基准） */
const basePoint = ref<CollectPoint | null>(null)
const pendingCreateId = ref('')
const saving = ref(false)
const draft = reactive<CollectPoint>({
  id: '',
  name: '',
  longitude: 116.4,
  latitude: 39.9,
  altitude: 800,
  vegetation: '针阔混交林',
  substrate: '落叶层',
  companionTrees: '',
  collectDate: new Date().toISOString().slice(0, 10),
  collector: '',
  version: 0,
  owner: 'recorder',
  updatedBy: '',
  updatedAt: ''
})

/** 正在编辑的采集点写锁（新建时目标为空，不持锁） */
const editLock = useEditLock({
  scope: 'point',
  targetId: computed(() => editingId.value ?? '')
})

const isEdit = computed(() => editingId.value !== null)
const formLocked = computed(() => isEdit.value && !editLock.writable.value)

const coordError = computed<string | null>(() => {
  const { longitude, latitude } = draft
  if (longitude < -180 || longitude > 180) return '经度必须在 -180 ~ 180 之间'
  if (latitude < -90 || latitude > 90) return '纬度必须在 -90 ~ 90 之间'
  if (longitude === 0 && latitude === 0) return '经纬度不能同时为 0'
  return null
})

watch(
  () => pointState.loaded,
  () => {
    if (!editingId.value && !draft.name && pointState.points.length > 0) {
      draft.name = ''
    }
  }
)

function newDraftRow(): CollectPoint {
  return {
    id: '',
    name: '',
    longitude: 116.4,
    latitude: 39.9,
    altitude: 800,
    vegetation: '针阔混交林',
    substrate: '落叶层',
    companionTrees: '',
    collectDate: new Date().toISOString().slice(0, 10),
    collector: session.recorderName,
    version: 0,
    owner: 'recorder',
    updatedBy: '',
    updatedAt: ''
  }
}

function resetDraft(): void {
  void editLock.release()
  editingId.value = null
  basePoint.value = null
  pendingCreateId.value = ''
  Object.assign(draft, newDraftRow())
}

async function edit(point: CollectPoint): Promise<void> {
  if (!isRecorder.value) {
    ElMessage.warning('采集点归记录员维护，请先切换为「记录员」身份')
    return
  }
  editingId.value = point.id
  basePoint.value = null
  Object.assign(draft, point)
  const granted = await editLock.request()
  // 申请锁期间可能已被别处改过，以最新整行为版本基准
  const latest = pointState.points.find((item) => item.id === point.id) ?? point
  basePoint.value = latest
  Object.assign(draft, latest)
  if (!granted) ElMessage.warning('该采集点正被另一窗口编辑，当前为只读')
}

async function stashDraft(reason: string): Promise<void> {
  const targetId = isEdit.value ? editingId.value! : pendingCreateId.value || draft.id || uid('pt')
  await draftStore.getState().upsertDraft({
    scope: 'point',
    targetId,
    kind: 'point',
    code: draft.name.trim() || '新建采集点',
    payload: JSON.stringify({ ...draft, id: targetId }),
    baseVersion: basePoint.value?.version,
    reason,
    updatedBy: currentEditorName() || '未署名'
  })
}

async function submit(): Promise<void> {
  if (!isRecorder.value) {
    ElMessage.warning('鉴定人身份不能写采集点')
    return
  }
  if (isEdit.value && !editLock.writable.value) {
    ElMessage.warning('写权不在本窗口，不能保存')
    return
  }
  if (!draft.name.trim()) {
    ElMessage.warning('请填写采集点名称')
    return
  }
  if (coordError.value) {
    ElMessage.warning(coordError.value)
    return
  }
  const id = isEdit.value ? editingId.value! : pendingCreateId.value || uid('pt')
  if (!isEdit.value) pendingCreateId.value = id
  const row: CollectPoint | NewRow<CollectPoint> = {
    ...draft,
    id,
    name: draft.name.trim(),
    companionTrees: draft.companionTrees.trim(),
    collector: draft.collector.trim()
  }
  saving.value = true
  try {
    const outcome = await pointStore
      .getState()
      .save(row, basePoint.value ?? undefined, currentEditorName())
    ElMessage.success(isEdit.value ? `采集点已更新（v${outcome.version}）` : '采集点已建立')
    await draftStore.getState().removeDraft(`${id}:point`).catch(() => undefined)
    resetDraft()
  } catch (error) {
    const result = await reportSaveError(error, '采集点')
    if (!result.ownership) {
      await stashDraft(result.message)
      ElMessage.info('本次未写入；内容已留为草稿，可在上方横幅恢复')
    }
  } finally {
    saving.value = false
  }
}

async function resumePointDraft(draftRow: RecoveryDraft): Promise<void> {
  let payload: CollectPoint
  try {
    payload = JSON.parse(draftRow.payload) as CollectPoint
  } catch {
    ElMessage.error('草稿内容已损坏，无法恢复')
    return
  }
  const existing = pointState.points.find((item) => item.id === draftRow.targetId)
  if (existing) {
    editingId.value = existing.id
    pendingCreateId.value = ''
    const granted = await editLock.request()
    basePoint.value = pointState.points.find((item) => item.id === existing.id) ?? existing
    Object.assign(draft, basePoint.value, payload)
    if (!granted) ElMessage.warning('写权仍在另一窗口，草稿已载入，拿到写权后才能保存')
  } else {
    editingId.value = null
    pendingCreateId.value = draftRow.targetId
    basePoint.value = null
    Object.assign(draft, newDraftRow(), payload, { id: draftRow.targetId })
  }
  ElMessage.success('采集点草稿已载入表单，核对后保存')
}

function recordsOf(pointId: string): number {
  return recordState.records.filter((record) => record.pointId === pointId).length
}

/** 主要基物：该采集点下条目最常见的基物（采集点自身基物优先） */
function mainSubstrate(point: CollectPoint): string {
  const list = recordState.records.filter((record) => record.pointId === point.id)
  if (list.length === 0) return point.substrate
  return point.substrate
}

async function remove(point: CollectPoint): Promise<void> {
  const count = recordsOf(point.id)
  if (count > 0) {
    ElMessage.error(`「${point.name}」下仍有 ${count} 条菌物条目，请先清理条目`)
    return
  }
  if (!isRecorder.value) {
    ElMessage.warning('删除采集点归记录员操作')
    return
  }
  await ElMessageBox.confirm(`确认删除采集点「${point.name}」？删除前需取得写权。`, '删除确认', {
    type: 'warning'
  })
  editingId.value = point.id
  const granted = await editLock.request()
  if (!granted) {
    ElMessage.error('该采集点正被另一窗口编辑，不能删除')
    await editLock.release()
    editingId.value = null
    return
  }
  await pointStore.getState().remove(point.id)
  await draftStore.getState().removeDraft(`${point.id}:point`).catch(() => undefined)
  await editLock.release()
  editingId.value = null
  ElMessage.success('采集点已删除')
}

const pointDrafts = computed(() => draftState.drafts.filter((item) => item.kind === 'point'))
</script>

<template>
  <div class="page">
    <RecoveryBanner
      v-if="isRecorder && pointDrafts.length"
      :drafts="pointDrafts"
      title="中途失败的采集点草稿（记录员恢复入口）"
      @resume="resumePointDraft"
      @discard="(d) => draftStore.getState().removeDraft(d.id)"
    />
    <div class="page-head">
      <div>
        <h2 class="page-title">采集点管理</h2>
        <p class="page-sub">
          经纬度与海拔表单带格式校验；编辑既有采集点需取得该点写锁，保存前核对打开版本，冲突字段会被拦下。
        </p>
      </div>
      <el-button :disabled="!isRecorder" @click="resetDraft">清空表单</el-button>
    </div>
    <el-alert
      v-if="!isRecorder"
      type="info"
      :closable="false"
      class="role-alert"
      title="当前是鉴定人身份：采集点归记录员维护（本页只读）。"
    />

    <el-card shadow="never" class="form-card">
      <template #header>
        <div class="form-head">
          <span>{{ isEdit ? '编辑采集点' : '新增采集点' }}</span>
          <template v-if="isEdit">
            <el-tag v-if="editLock.writable.value" type="success" size="small" effect="dark">本窗口持有写权</el-tag>
            <el-tag v-else-if="editLock.heldByOther.value" type="info" size="small" effect="dark">
              只读：写权在「{{ editLock.lock.value?.holderName }}」
            </el-tag>
            <el-tag v-else type="warning" size="small" effect="plain">尚未取得写权</el-tag>
            <el-button size="small" :loading="editLock.acquiring.value" @click="editLock.request()">申请写权</el-button>
            <span v-if="basePoint" class="muted">打开版本 v{{ basePoint.version }}</span>
          </template>
        </div>
      </template>
      <fieldset :disabled="formLocked" class="form-fieldset">
        <GeoPointForm v-model="draft" with-meta />
        <div class="actions">
          <el-button
            type="primary"
            :loading="saving"
            :disabled="isEdit && !editLock.writable.value"
            @click="submit"
          >
            {{ isEdit ? `保存修改（基于 v${basePoint?.version ?? '?'}）` : '新增采集点' }}
          </el-button>
          <el-button v-if="isEdit" @click="resetDraft">放弃编辑</el-button>
        </div>
      </fieldset>
    </el-card>

    <h3 class="section-title">采集点清单（{{ pointState.points.length }}）</h3>
    <div class="card-grid">
      <el-card v-for="point in pointState.points" :key="point.id" shadow="hover" class="point-card">
        <div class="point-head">
          <div>
            <div class="point-name">{{ point.name }}</div>
            <div class="muted">
              {{ point.longitude.toFixed(4) }}, {{ point.latitude.toFixed(4) }} · {{ point.altitude }} m
            </div>
          </div>
          <div class="point-head-tags">
            <VersionBadge :row="point" />
            <el-tag effect="plain" size="small">条目 {{ recordsOf(point.id) }}</el-tag>
          </div>
        </div>
        <el-descriptions :column="1" size="small" border class="desc">
          <el-descriptions-item label="植被类型">{{ point.vegetation }}</el-descriptions-item>
          <el-descriptions-item label="主要基物">{{ mainSubstrate(point) }}</el-descriptions-item>
          <el-descriptions-item label="伴生树种">{{ point.companionTrees || '—' }}</el-descriptions-item>
          <el-descriptions-item label="采集日期">{{ point.collectDate }}</el-descriptions-item>
          <el-descriptions-item label="采集人">{{ point.collector || '—' }}</el-descriptions-item>
        </el-descriptions>
        <div class="point-actions">
          <el-button size="small" :disabled="!isRecorder" @click="edit(point)">编辑</el-button>
          <el-button size="small" type="danger" plain :disabled="!isRecorder" @click="remove(point)">删除</el-button>
        </div>
      </el-card>
      <el-empty v-if="pointState.points.length === 0" description="暂无采集点" />
    </div>
  </div>
</template>

<style scoped>
.role-alert {
  margin-bottom: 12px;
}
.form-card {
  border-radius: 12px;
}
.form-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.form-fieldset[disabled] {
  border: 0;
  padding: 0;
  opacity: 0.8;
}
.actions {
  margin-top: 12px;
}
.point-card {
  border-radius: 12px;
}
.point-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 10px;
}
.point-head-tags {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}
.point-name {
  font-size: 15px;
  font-weight: 600;
}
.desc {
  margin-bottom: 10px;
}
.point-actions {
  display: flex;
  gap: 8px;
}
</style>
