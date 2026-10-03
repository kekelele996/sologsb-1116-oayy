<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type {
  FungusRecord,
  GillAttachment,
  NewRow,
  SporeColor,
  VersionedRow
} from '@/types'
import {
  CAP_MARGINS,
  CAP_SHAPES,
  CAP_TEXTURES,
  FLESH_REACTIONS,
  GILL_ATTACHMENTS,
  GILL_DENSITIES,
  ROLE_RECORDER,
  RING_TYPES,
  SPORE_COLORS,
  VOLVA_TYPES
} from '@/types'
import GillAttachmentTag from '@/components/common/GillAttachmentTag.vue'
import SporePrintSwatch from '@/components/common/SporePrintSwatch.vue'
import TraitsSummary from '@/components/common/TraitsSummary.vue'
import VersionBadge from '@/components/common/VersionBadge.vue'
import RecoveryBanner from '@/components/common/RecoveryBanner.vue'
import { useStore } from '@/hooks/usePersistentStore'
import { useEditLock } from '@/hooks/useEditLock'
import { useCandidateMatch, EMPTY_CRITERIA, type MatchCriteria } from '@/hooks/useCandidateMatch'
import { recordStore } from '@/stores/recordStore'
import { sporeStore } from '@/stores/sporeStore'
import { pointStore } from '@/stores/pointStore'
import { identifyStore } from '@/stores/identifyStore'
import { sessionStore, currentEditorName } from '@/stores/sessionStore'
import { draftStore, type RecoveryDraft } from '@/stores/draftStore'
import { reportSaveError } from '@/concurrency/saveErrors'
import { uid } from '@/utils/id'

const router = useRouter()
const recordState = useStore(recordStore)
const sporeState = useStore(sporeStore)
const pointState = useStore(pointStore)
const identifyState = useStore(identifyStore)
const session = useStore(sessionStore)
const draftState = useStore(draftStore)

const isRecorder = computed(() => session.role === ROLE_RECORDER)

const filterAttachment = ref<GillAttachment | ''>('')
const filterColor = ref<SporeColor | ''>('')
const keyword = ref('')
const compareIds = ref<string[]>([])

const criteria = computed<MatchCriteria>(() => ({
  ...EMPTY_CRITERIA,
  attachment: filterAttachment.value,
  sporeColor: filterColor.value
}))
const { candidates } = useCandidateMatch(
  computed(() => recordState.records),
  computed(() => sporeState.spores),
  criteria
)

/** 图谱筛选：印色 + 着生方式 + 关键字（未设条件时按编号排序） */
const visible = computed(() => {
  if (!filterAttachment.value && !filterColor.value && !keyword.value.trim()) {
    return recordState.records.map((record) => ({
      record,
      spore: sporeState.spores.find((item) => item.recordId === record.id) ?? null,
      percent: 0,
      matched: [] as string[]
    }))
  }
  const text = keyword.value.trim().toLowerCase()
  return candidates.value
    .filter((item) => {
      if (filterAttachment.value && item.record.attachment !== filterAttachment.value) return false
      if (filterColor.value && item.spore?.color !== filterColor.value) return false
      if (text) {
        const haystack = [item.record.code, item.record.tempName, item.record.hostTree, item.record.collector]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(text)) return false
      }
      return true
    })
    .map((item) => ({ record: item.record, spore: item.spore, percent: item.percent, matched: item.matched }))
})

function pointName(pointId: string): string {
  return pointState.points.find((point) => point.id === pointId)?.name ?? '未关联采集点'
}

function identifyOf(recordId: string): { conclusion: string; confidence: string; needReview: boolean } | null {
  const log = identifyState.logs.find((item) => item.recordId === recordId)
  return log ? { conclusion: log.conclusion, confidence: log.confidence, needReview: log.needReview } : null
}

function toggleCompare(id: string): void {
  compareIds.value = compareIds.value.includes(id)
    ? compareIds.value.filter((item) => item !== id)
    : compareIds.value.length >= 3
      ? compareIds.value
      : [...compareIds.value, id]
  if (compareIds.value.length >= 3) ElMessage.info('对比视图最多并排 3 条')
}

function goCompare(): void {
  if (compareIds.value.length < 2) {
    ElMessage.warning('至少选择 2 条才能对比')
    return
  }
  void router.push({ path: '/compare', query: { ids: compareIds.value.join(',') } })
}

/* ---------- 新建 / 编辑条目对话框 ---------- */
type DialogMode = 'create' | 'edit'
const dialogVisible = ref(false)
const dialogMode = ref<DialogMode>('create')
/** 编辑对象 ID；新建时为空（此时不持锁） */
const editingId = ref('')
/** 新建态在打开对话框时就分配好的 ID，保证失败草稿与恢复后的行是同一个 id */
const pendingCreateId = ref('')
/** 打开对话框时看到的整行（版本核对基准） */
const baseRecord = ref<FungusRecord | null>(null)
const saving = ref(false)

const form = reactive({
  id: '',
  code: '',
  tempName: '',
  pointId: '',
  fruitBodyCount: 1,
  capDiameter: 5,
  capShape: '平展' as FungusRecord['capShape'],
  capMargin: '全缘' as FungusRecord['capMargin'],
  capTexture: '光滑' as FungusRecord['capTexture'],
  fleshThickness: 1,
  fleshReaction: '不变色' as FungusRecord['fleshReaction'],
  attachment: '直生' as GillAttachment,
  gillDensity: '中等' as FungusRecord['gillDensity'],
  stipeLength: 5,
  stipeDiameter: 1,
  ring: '无菌环' as FungusRecord['ring'],
  volva: '无菌环' as FungusRecord['volva'],
  odor: '',
  hostTree: '',
  collectDate: new Date().toISOString().slice(0, 10),
  collector: '',
  note: ''
})

/** 编辑既有条目时申请条目写锁：同一条目别的窗口（含鉴定页）只读 */
const editLock = useEditLock({
  scope: 'entry',
  targetId: computed(() => editingId.value)
})

watch(
  () => [pointState.points.length, form.pointId] as const,
  () => {
    if (!form.pointId && pointState.points.length > 0) form.pointId = pointState.points[0].id
  },
  { immediate: true }
)

type RecordFormShape = Omit<FungusRecord, keyof VersionedRow | 'pointId'> & { pointId: string }

function fillFormFromRecord(record: FungusRecord): void {
  Object.assign(form, {
    id: record.id,
    code: record.code,
    tempName: record.tempName,
    pointId: record.pointId,
    fruitBodyCount: record.fruitBodyCount,
    capDiameter: record.capDiameter,
    capShape: record.capShape,
    capMargin: record.capMargin,
    capTexture: record.capTexture,
    fleshThickness: record.fleshThickness,
    fleshReaction: record.fleshReaction,
    attachment: record.attachment,
    gillDensity: record.gillDensity,
    stipeLength: record.stipeLength,
    stipeDiameter: record.stipeDiameter,
    ring: record.ring,
    volva: record.volva,
    odor: record.odor,
    hostTree: record.hostTree,
    collectDate: record.collectDate,
    collector: record.collector,
    note: record.note
  })
}

function openCreate(): void {
  if (!isRecorder.value) {
    ElMessage.warning('形态条目归记录员填写，请先在左上角切换为「记录员」身份')
    return
  }
  dialogMode.value = 'create'
  editingId.value = ''
  pendingCreateId.value = uid('rec')
  baseRecord.value = null
  Object.assign(form, {
    id: pendingCreateId.value,
    code: `REC-${String(recordState.records.length + 1).padStart(3, '0')}`,
    tempName: '',
    pointId: pointState.points[0]?.id ?? '',
    fruitBodyCount: 1,
    capDiameter: 5,
    capShape: '平展',
    capMargin: '全缘',
    capTexture: '光滑',
    fleshThickness: 1,
    fleshReaction: '不变色',
    attachment: '直生',
    gillDensity: '中等',
    stipeLength: 5,
    stipeDiameter: 1,
    ring: '无菌环',
    volva: '无菌托',
    odor: '',
    hostTree: '',
    collectDate: new Date().toISOString().slice(0, 10),
    collector: session.recorderName,
    note: ''
  })
  dialogVisible.value = true
}

async function openEdit(record: FungusRecord): Promise<void> {
  if (!isRecorder.value) {
    ElMessage.warning('形态条目归记录员修改，请先在左上角切换为「记录员」身份')
    return
  }
  dialogMode.value = 'edit'
  editingId.value = record.id
  baseRecord.value = null
  fillFormFromRecord(record)
  dialogVisible.value = true
  const granted = await editLock.request()
  // 申请锁期间可能又被别处改过，以 store 里最新整行作为版本基准
  const latest = recordStore.getState().records.find((item) => item.id === record.id) ?? record
  baseRecord.value = latest
  fillFormFromRecord(latest)
  if (!granted) {
    ElMessage.warning('该条目正被另一窗口编辑，当前为只读；对方关闭后可再取得写权')
  }
}

async function reloadLatest(): Promise<void> {
  if (!editingId.value) return
  await recordStore.getState().hydrate()
  const latest = recordState.records.find((item) => item.id === editingId.value)
  if (!latest) {
    ElMessage.error('该条目已被删除')
    await closeDialog()
    return
  }
  baseRecord.value = latest
  fillFormFromRecord(latest)
}

async function closeDialog(): Promise<void> {
  dialogVisible.value = false
  await editLock.release()
  editingId.value = ''
  pendingCreateId.value = ''
  baseRecord.value = null
}

function buildRow(): RecordFormShape {
  return {
    id: dialogMode.value === 'edit' ? editingId.value : pendingCreateId.value,
    code: form.code.trim(),
    tempName: form.tempName.trim(),
    fruitBodyCount: Number(form.fruitBodyCount) || 1,
    pointId: form.pointId,
    capDiameter: Number(form.capDiameter) || 0,
    capShape: form.capShape,
    capMargin: form.capMargin,
    capTexture: form.capTexture,
    fleshThickness: Number(form.fleshThickness) || 0,
    fleshReaction: form.fleshReaction,
    attachment: form.attachment,
    gillDensity: form.gillDensity,
    stipeLength: Number(form.stipeLength) || 0,
    stipeDiameter: Number(form.stipeDiameter) || 0,
    ring: form.ring,
    volva: form.volva,
    odor: form.odor.trim(),
    hostTree: form.hostTree.trim(),
    collectDate: form.collectDate,
    collector: form.collector.trim(),
    note: form.note.trim()
  }
}

/** 保存失败（冲突 / IO 错误）：把表单内容留成草稿，之后可从记录员这侧恢复重来 */
async function stashDraft(reason: string): Promise<void> {
  const targetId = dialogMode.value === 'edit' ? editingId.value : pendingCreateId.value || form.id || uid('rec')
  await draftStore.getState().upsertDraft({
    scope: 'entry',
    targetId,
    kind: 'record',
    code: form.code.trim() || '新建条目',
    payload: JSON.stringify({ ...form, id: targetId }),
    baseVersion: baseRecord.value?.version,
    reason,
    updatedBy: currentEditorName() || '未署名'
  })
}

async function submit(): Promise<void> {
  if (!isRecorder.value) {
    ElMessage.warning('鉴定人身份不能写形态条目')
    return
  }
  if (dialogMode.value === 'edit' && !editLock.writable.value) {
    ElMessage.warning('写权不在本窗口，不能保存；请等待持有写权的窗口关闭')
    return
  }
  if (!form.code.trim()) {
    ElMessage.warning('请填写采集编号')
    return
  }
  if (!form.pointId) {
    ElMessage.warning('请选择采集点')
    return
  }
  if (
    dialogMode.value === 'create' &&
    recordState.records.some((item) => item.code === form.code.trim())
  ) {
    ElMessage.warning(`采集编号「${form.code}」已存在，请换一个`)
    return
  }

  const base = dialogMode.value === 'edit' ? baseRecord.value ?? undefined : undefined
  const row = buildRow()
  saving.value = true
  try {
    const outcome = await recordStore.getState().save(row as FungusRecord | NewRow<FungusRecord>, base, currentEditorName())
    ElMessage.success(
      dialogMode.value === 'edit'
        ? `条目 ${row.code} 已更新到 v${outcome.version}（打开时为 v${base?.version ?? 0}）`
        : `条目 ${row.code} 已建立（v${outcome.version}）`
    )
    await draftStore
      .getState()
      .removeDraft(`${dialogMode.value === 'edit' ? editingId.value : pendingCreateId.value}:record`)
      .catch(() => undefined)
    await closeDialog()
  } catch (error) {
    const result = await reportSaveError(error, '形态条目')
    if (!result.ownership) {
      // 版本冲突或写库失败：旧值没有被写回，表单内容转存为恢复草稿
      await stashDraft(result.message)
      ElMessage.info('本次未写入；你填的内容已留为草稿，可在上方横幅恢复重来')
    }
  } finally {
    saving.value = false
  }
}

/** 恢复草稿：重新打开对话框并尝试取得写权 */
async function resumeDraft(draft: RecoveryDraft): Promise<void> {
  if (draft.kind !== 'record') {
    void router.push(`/atlas/${draft.targetId}`)
    return
  }
  let payload: typeof form
  try {
    payload = JSON.parse(draft.payload) as typeof form
    Object.assign(form, payload)
  } catch {
    ElMessage.error('草稿内容已损坏，无法恢复')
    return
  }
  const existing = recordState.records.find((item) => item.id === draft.targetId)
  dialogMode.value = existing ? 'edit' : 'create'
  editingId.value = existing ? draft.targetId : ''
  pendingCreateId.value = existing ? '' : draft.targetId
  baseRecord.value = null
  dialogVisible.value = true
  let granted = true
  if (existing) {
    granted = await editLock.request()
    await reloadLatest().catch(() => undefined)
    // 恢复草稿要以草稿里的内容覆盖最新值（用户稍后自行合并）
    Object.assign(form, payload)
    baseRecord.value = recordStore.getState().records.find((item) => item.id === draft.targetId) ?? null
    if (!granted) ElMessage.warning('写权仍在另一窗口，草稿已载入，拿到写权后才能保存')
  }
}

async function removeRecord(record: FungusRecord): Promise<void> {
  if (!isRecorder.value) {
    ElMessage.warning('删除条目归记录员操作')
    return
  }
  await ElMessageBox.confirm(
    `确认删除条目「${record.code}」？其孢子印与鉴定留痕一并清理。删除前需取得该条目的写权。`,
    '删除确认',
    { type: 'warning' }
  )
  editingId.value = record.id
  const granted = await editLock.request()
  if (!granted) {
    ElMessage.error('该条目正被另一窗口编辑，不能删除')
    await editLock.release()
    editingId.value = ''
    return
  }
  await sporeStore.getState().removeByRecord(record.id)
  const logs = identifyState.logs.filter((item) => item.recordId === record.id)
  await Promise.all(logs.map((item) => identifyStore.getState().remove(item.id)))
  await recordStore.getState().remove(record.id)
  await editLock.release()
  editingId.value = ''
  ElMessage.success('条目已删除')
}

/** 该条目是否有可恢复草稿 */
function draftMarker(recordId: string): RecoveryDraft[] {
  return draftState.drafts.filter((item) => item.targetId === recordId)
}
</script>

<template>
  <div class="page">
    <RecoveryBanner
      v-if="isRecorder && draftState.drafts.length"
      :drafts="draftState.drafts"
      title="中途失败的录入草稿（记录员恢复入口）"
      @resume="resumeDraft"
      @discard="(draft) => draftStore.getState().removeDraft(draft.id)"
    />

    <div class="page-head">
      <div>
        <h2 class="page-title">图谱总览</h2>
        <p class="page-sub">
          网格卡片展示菌盖形态要点、孢子印色块与鉴定状态；可按孢子印印色与菌褶/菌管着生方式筛选。
          形态修改走「补形态」编辑对话框，保存前核对打开版本，冲突字段会被拦下。
        </p>
      </div>
      <div class="head-actions">
        <el-button v-if="compareIds.length > 0" type="primary" plain @click="goCompare">
          对比已选 {{ compareIds.length }} 条
        </el-button>
        <el-button type="primary" :disabled="!isRecorder" @click="openCreate">
          <el-icon><Plus /></el-icon>新建条目
        </el-button>
      </div>
    </div>
    <el-alert
      v-if="!isRecorder"
      type="info"
      :closable="false"
      class="role-alert"
      title="当前是鉴定人身份：本页形态、采集点为只读；补形态请切换为记录员，落结论请去鉴定工作页。"
    />

    <div class="toolbar">
      <el-select v-model="filterColor" placeholder="全部印色" clearable style="width: 150px">
        <el-option v-for="color in SPORE_COLORS" :key="color" :label="color" :value="color" />
      </el-select>
      <el-select v-model="filterAttachment" placeholder="全部着生方式" clearable style="width: 170px">
        <el-option v-for="item in GILL_ATTACHMENTS" :key="item" :label="item" :value="item" />
      </el-select>
      <el-input v-model="keyword" placeholder="编号 / 暂定名 / 树种 / 采集人" clearable style="width: 260px" />
      <el-tag type="info" effect="plain">命中 {{ visible.length }} / {{ recordState.records.length }} 条</el-tag>
      <el-button
        v-if="filterColor || filterAttachment || keyword"
        @click="(() => { filterColor = ''; filterAttachment = ''; keyword = '' })()"
      >
        清空条件
      </el-button>
    </div>

    <div class="card-grid">
      <el-card v-for="item in visible" :key="item.record.id" shadow="hover" class="atlas-card">
        <div class="card-top">
          <div>
            <div class="rec-name">{{ item.record.tempName || '未命名条目' }}</div>
            <div class="mono muted">{{ item.record.code }} · {{ pointName(item.record.pointId) }}</div>
          </div>
          <div class="tags">
            <GillAttachmentTag :attachment="item.record.attachment" />
            <SporePrintSwatch :color="item.spore?.color ?? null" :caption="item.spore ? `${item.spore.hours} h` : '未做印'" />
          </div>
        </div>
        <div class="cap-line">
          <el-tag size="small" effect="plain">{{ item.record.capShape }}</el-tag>
          <el-tag size="small" effect="plain">{{ item.record.capMargin }}</el-tag>
          <el-tag size="small" effect="plain">{{ item.record.capTexture }}</el-tag>
          <el-tag size="small" effect="plain">直径 {{ item.record.capDiameter }} cm</el-tag>
          <el-tag size="small" effect="plain">菌肉 {{ item.record.fleshReaction }}</el-tag>
        </div>
        <TraitsSummary :record="item.record" :spore="item.spore" :default-open="['gill']" class="traits" />
        <div class="ident-line">
          <template v-if="identifyOf(item.record.id)">
            <el-tag type="success" size="small" effect="dark">
              {{ identifyOf(item.record.id)?.conclusion }}
            </el-tag>
            <span class="muted">
              置信度 {{ identifyOf(item.record.id)?.confidence }}
              <template v-if="identifyOf(item.record.id)?.needReview"> · 待复核</template>
            </span>
          </template>
          <el-tag v-else type="warning" size="small" effect="plain">尚无鉴定结论</el-tag>
          <el-tag v-if="item.percent > 0" size="small" effect="plain">匹配度 {{ item.percent }}%</el-tag>
        </div>
        <div class="version-line">
          <VersionBadge :row="item.record" />
          <el-tag v-if="draftMarker(item.record.id).length" type="danger" size="small" effect="plain">
            有 {{ draftMarker(item.record.id).length }} 份未恢复草稿
          </el-tag>
        </div>
        <div class="card-actions">
          <el-button size="small" @click="router.push(`/atlas/${item.record.id}`)">详情</el-button>
          <el-button size="small" type="warning" plain :disabled="!isRecorder" @click="openEdit(item.record)">
            补形态
          </el-button>
          <el-button
            size="small"
            :type="compareIds.includes(item.record.id) ? 'primary' : 'default'"
            @click="toggleCompare(item.record.id)"
          >
            {{ compareIds.includes(item.record.id) ? '已加入对比' : '加入对比' }}
          </el-button>
          <el-button size="small" type="danger" plain :disabled="!isRecorder" @click="removeRecord(item.record)">删除</el-button>
        </div>
      </el-card>
      <el-empty v-if="visible.length === 0" description="没有命中的条目，调整筛选条件或新建条目" />
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'edit' ? `补形态：${form.code || '条目'}` : '新建菌物条目'"
      width="720px"
      :close-on-click-modal="false"
      @close="void closeDialog()"
    >
      <div class="dialog-status">
        <template v-if="dialogMode === 'edit'">
          <VersionBadge v-if="baseRecord" :row="baseRecord" detailed />
          <el-tag v-if="editLock.writable.value" type="success" size="small" effect="dark">本窗口持有写权</el-tag>
          <el-tag v-else-if="editLock.heldByOther.value" type="info" size="small" effect="dark">
            只读：写权在「{{ editLock.lock.value?.holderName }}」窗口
          </el-tag>
          <el-tag v-else type="warning" size="small" effect="plain">尚未取得写权</el-tag>
          <el-button
            v-if="!editLock.writable.value"
            size="small"
            :loading="editLock.acquiring.value"
            @click="editLock.request()"
          >
            申请写权
          </el-button>
          <el-button size="small" @click="reloadLatest">重新载入最新值</el-button>
        </template>
        <el-tag v-else type="success" size="small" effect="plain">新建无需写锁</el-tag>
      </div>
      <fieldset :disabled="dialogMode === 'edit' && !editLock.writable.value" class="dialog-fieldset">
      <el-form label-width="110px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="采集编号" required>
              <el-input v-model="form.code" placeholder="如 BHS-2026-003" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="暂定名">
              <el-input v-model="form.tempName" placeholder="如 橙黄牛肝菌（暂定）" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="采集点" required>
              <el-select v-model="form.pointId" style="width: 100%">
                <el-option v-for="point in pointState.points" :key="point.id" :label="point.name" :value="point.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="子实体数量">
              <el-input-number v-model="form.fruitBodyCount" :min="1" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-divider content-position="left">菌盖</el-divider>
        <el-row :gutter="12">
          <el-col :span="6">
            <el-form-item label="直径(cm)">
              <el-input-number v-model="form.capDiameter" :min="0" :step="0.5" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="形状">
              <el-select v-model="form.capShape" style="width: 100%">
                <el-option v-for="item in CAP_SHAPES" :key="item" :label="item" :value="item" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="边缘">
              <el-select v-model="form.capMargin" style="width: 100%">
                <el-option v-for="item in CAP_MARGINS" :key="item" :label="item" :value="item" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="表面质地">
              <el-select v-model="form.capTexture" style="width: 100%">
                <el-option v-for="item in CAP_TEXTURES" :key="item" :label="item" :value="item" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-divider content-position="left">菌肉 / 菌褶菌管</el-divider>
        <el-row :gutter="12">
          <el-col :span="6">
            <el-form-item label="菌肉厚(cm)">
              <el-input-number v-model="form.fleshThickness" :min="0" :step="0.1" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="变色反应">
              <el-select v-model="form.fleshReaction" style="width: 100%">
                <el-option v-for="item in FLESH_REACTIONS" :key="item" :label="item" :value="item" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="着生方式">
              <el-select v-model="form.attachment" style="width: 100%">
                <el-option v-for="item in GILL_ATTACHMENTS" :key="item" :label="item" :value="item" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="菌褶密度">
              <el-select v-model="form.gillDensity" style="width: 100%">
                <el-option v-for="item in GILL_DENSITIES" :key="item" :label="item" :value="item" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-divider content-position="left">菌柄 / 菌环菌托</el-divider>
        <el-row :gutter="12">
          <el-col :span="6">
            <el-form-item label="柄长(cm)">
              <el-input-number v-model="form.stipeLength" :min="0" :step="0.5" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="柄径(cm)">
              <el-input-number v-model="form.stipeDiameter" :min="0" :step="0.1" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="菌环">
              <el-select v-model="form.ring" style="width: 100%">
                <el-option v-for="item in RING_TYPES" :key="item" :label="item" :value="item" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="菌托">
              <el-select v-model="form.volva" style="width: 100%">
                <el-option v-for="item in VOLVA_TYPES" :key="item" :label="item" :value="item" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-divider content-position="left">气味与生境</el-divider>
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="气味">
              <el-input v-model="form.odor" placeholder="如 淡淡坚果味" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="关联树种">
              <el-input v-model="form.hostTree" placeholder="如 辽东栎" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="采集人">
              <el-input v-model="form.collector" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="采集日期">
          <el-date-picker v-model="form.collectDate" type="date" value-format="YYYY-MM-DD" style="width: 220px" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" type="textarea" :rows="2" placeholder="仅作形态记录，不可作为食用依据" />
        </el-form-item>
      </el-form>
      </fieldset>
      <template #footer>
        <el-button @click="closeDialog">取消</el-button>
        <el-button
          type="primary"
          :loading="saving"
          :disabled="dialogMode === 'edit' && !editLock.writable.value"
          @click="submit"
        >
          {{ dialogMode === 'edit' ? `保存（基于打开版本 v${baseRecord?.version ?? '?'}）` : '保存条目' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.head-actions {
  display: flex;
  gap: 8px;
}
.role-alert {
  margin-bottom: 12px;
}
.atlas-card {
  border-radius: 12px;
}
.card-top {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: flex-start;
}
.rec-name {
  font-size: 15px;
  font-weight: 600;
}
.tags {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-end;
}
.cap-line {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 10px 0;
}
.traits {
  margin-bottom: 10px;
}
.ident-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.version-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.card-actions {
  display: flex;
  gap: 8px;
}
.dialog-status {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f7f5f0;
}
.dialog-fieldset[disabled] {
  opacity: 0.75;
}
</style>
