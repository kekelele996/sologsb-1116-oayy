<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { IdentifyLog, NewRow } from '@/types'
import {
  CAP_MARGINS,
  CAP_SHAPES,
  CAP_TEXTURES,
  FLESH_REACTIONS,
  GILL_ATTACHMENTS,
  GILL_DENSITIES,
  ID_BASES,
  ID_CONFIDENCES,
  ROLE_IDENTIFIER,
  SPORE_COLORS
} from '@/types'
import GillAttachmentTag from '@/components/common/GillAttachmentTag.vue'
import SporePrintSwatch from '@/components/common/SporePrintSwatch.vue'
import VersionBadge from '@/components/common/VersionBadge.vue'
import { useStore } from '@/hooks/usePersistentStore'
import { useEditLock } from '@/hooks/useEditLock'
import { EMPTY_CRITERIA, useCandidateMatch, type MatchCriteria } from '@/hooks/useCandidateMatch'
import { recordStore } from '@/stores/recordStore'
import { sporeStore } from '@/stores/sporeStore'
import { identifyStore } from '@/stores/identifyStore'
import { pointStore } from '@/stores/pointStore'
import { sessionStore, currentEditorName } from '@/stores/sessionStore'
import { reportSaveError } from '@/concurrency/saveErrors'
import { uid } from '@/utils/id'

const recordState = useStore(recordStore)
const sporeState = useStore(sporeStore)
const identifyState = useStore(identifyStore)
const pointState = useStore(pointStore)
const session = useStore(sessionStore)

const isIdentifier = computed(() => session.role === ROLE_IDENTIFIER)

const criteria = reactive<MatchCriteria>({ ...EMPTY_CRITERIA })
const { candidates, hasCondition } = useCandidateMatch(
  computed(() => recordState.records),
  computed(() => sporeState.spores),
  computed(() => ({ ...criteria }))
)

const activeRecordId = ref('')
const active = computed(() => recordState.records.find((item) => item.id === activeRecordId.value) ?? null)

/** 同条目写锁：记录员详情窗口与鉴定窗口同时开着时，只有一个能写 */
const entryLock = useEditLock({
  scope: 'entry',
  targetId: computed(() => activeRecordId.value),
  role: () => ROLE_IDENTIFIER
})

const logForm = reactive({
  id: '',
  conclusion: '',
  basis: '形态特征' as IdentifyLog['basis'],
  referenceBook: '',
  referencePage: '',
  confidence: '中' as IdentifyLog['confidence'],
  needReview: true,
  reviewer: ''
})
/** 修订最新一条时的打开快照（版本基准）；新增留痕时为 null */
const baseLog = ref<IdentifyLog | null>(null)
const saving = ref(false)

const isRevising = computed(() => Boolean(logForm.id))
const latestLog = computed(() =>
  activeRecordId.value ? identifyState.logs.find((item) => item.recordId === activeRecordId.value) : undefined
)

watch(
  () => [recordState.records.length, activeRecordId.value] as const,
  () => {
    if (!activeRecordId.value && recordState.records.length > 0) {
      activeRecordId.value = recordState.records[0].id
    }
  },
  { immediate: true }
)

// 切换目标条目：表单重置、锁由 useEditLock 自动随 targetId 切换
watch(activeRecordId, () => resetForm())

function resetForm(): void {
  logForm.id = ''
  logForm.conclusion = ''
  logForm.basis = '形态特征'
  logForm.referenceBook = ''
  logForm.referencePage = ''
  logForm.confidence = '中'
  logForm.needReview = true
  logForm.reviewer = ''
  baseLog.value = null
}

function pointName(pointId: string): string {
  return pointState.points.find((point) => point.id === pointId)?.name ?? '未关联采集点'
}

function resetCriteria(): void {
  Object.assign(criteria, EMPTY_CRITERIA)
}

function pickCandidate(recordId: string, conclusion: string): void {
  activeRecordId.value = recordId
  if (entryLock.writable.value) logForm.conclusion = conclusion
  ElMessage.info('已把候选条目的暂定名填入结论，请核对后保存')
}

/** 依据候选条目生成学名草稿（暂定名去掉括号说明） */
function draftConclusion(tempName: string): string {
  return tempName.replace(/[（(].*?[)）]/g, '').trim()
}

/** 载入最新一条结论，进入「修订 / 复核」模式（保存时按其版本核对） */
function reviseLatest(): void {
  const log = latestLog.value
  if (!log) {
    ElMessage.warning('该条目还没有结论，可直接新增一条留痕')
    return
  }
  if (!entryLock.writable.value) {
    ElMessage.warning('先取得写权才能修订 / 复核')
    return
  }
  baseLog.value = log
  logForm.id = log.id
  logForm.conclusion = log.conclusion
  logForm.basis = log.basis
  logForm.referenceBook = log.referenceBook
  logForm.referencePage = log.referencePage
  logForm.confidence = log.confidence
  logForm.needReview = log.needReview
  logForm.reviewer = log.reviewer
  ElMessage.info(`已载入 v${log.version}，修改后保存会再次核对版本`)
}

async function startWriting(): Promise<void> {
  if (!active.value) {
    ElMessage.warning('请先在候选名录中选择条目')
    return
  }
  if (!isIdentifier.value) {
    ElMessage.warning('鉴定结论归鉴定人填写，请先在左上角切换为「鉴定人」身份')
    return
  }
  const granted = await entryLock.request()
  if (!granted) {
    ElMessage.warning(`该条目写权在「${entryLock.lock.value?.holderName ?? '另一窗口'}」，当前只读`)
  }
}

async function saveLog(): Promise<void> {
  if (!active.value) {
    ElMessage.warning('请先在候选名录中选择要落结论的条目')
    return
  }
  if (!isIdentifier.value) {
    ElMessage.warning('记录员身份不能写鉴定结论')
    return
  }
  if (!entryLock.writable.value) {
    ElMessage.warning('写权不在本窗口，不能保存；请先取得写权或等待对方关闭')
    return
  }
  if (!logForm.conclusion.trim()) {
    ElMessage.warning('请填写结论学名')
    return
  }
  const payload = {
    id: logForm.id || uid('idf'),
    recordId: active.value.id,
    conclusion: logForm.conclusion.trim(),
    basis: logForm.basis,
    referenceBook: logForm.referenceBook.trim(),
    referencePage: logForm.referencePage.trim(),
    confidence: logForm.confidence,
    needReview: logForm.needReview,
    reviewer: logForm.reviewer.trim(),
    date: new Date().toISOString().slice(0, 10)
  } satisfies IdentifyLog | NewRow<IdentifyLog>
  saving.value = true
  try {
    const outcome = await identifyStore
      .getState()
      .save(payload, baseLog.value ?? undefined, currentEditorName())
    ElMessage.success(
      isRevising.value
        ? `${active.value.code} 结论已修订到 v${outcome.version}（打开时 v${baseLog.value?.version}）`
        : `${active.value.code} 已记录结论：${payload.conclusion}（v${outcome.version}）`
    )
    resetForm()
  } catch (error) {
    // 鉴定侧不落恢复草稿（中途失败统一从记录员侧重来）；冲突字段直接展示并停下
    await reportSaveError(error, '鉴定结论')
    const latest = identifyState.logs.find((item) => item.id === payload.id)
    if (latest) baseLog.value = latest
  } finally {
    saving.value = false
  }
}

const latestOf = (recordId: string): IdentifyLog | undefined =>
  identifyState.logs.find((item) => item.recordId === recordId)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">鉴定工作页</h2>
        <p class="page-sub">
          左侧勾选观察到的形态特征与孢子印条件，右侧实时给出候选名录排序；点「取得写权」后落结论或复核，
          保存时核对打开版本，对方改过就拦下并点出字段。
        </p>
      </div>
      <el-tag type="info" effect="plain">{{ hasCondition ? '已设条件，按匹配度排序' : '未设条件，按编号排序' }}</el-tag>
    </div>

    <el-alert
      v-if="!isIdentifier"
      type="info"
      :closable="false"
      class="role-alert"
      title="当前是记录员身份：鉴定结论与复核归鉴定人填写（本页只读）；形态、孢子印请在图谱/详情页录入。"
    />

    <div class="layout">
      <el-card shadow="never" class="criteria-card">
        <template #header>
          <div class="card-head">
            <span>特征勾选</span>
            <el-button link type="primary" size="small" @click="resetCriteria">重置</el-button>
          </div>
        </template>
        <el-form label-width="88px" size="small">
          <el-form-item label="着生方式">
            <el-select v-model="criteria.attachment" placeholder="不限" clearable style="width: 100%">
              <el-option v-for="item in GILL_ATTACHMENTS" :key="item" :label="item" :value="item" />
            </el-select>
          </el-form-item>
          <el-form-item label="孢子印">
            <el-select v-model="criteria.sporeColor" placeholder="不限" clearable style="width: 100%">
              <el-option v-for="color in SPORE_COLORS" :key="color" :label="color" :value="color" />
            </el-select>
          </el-form-item>
          <el-form-item label="菌盖形状">
            <el-select v-model="criteria.capShape" placeholder="不限" clearable style="width: 100%">
              <el-option v-for="item in CAP_SHAPES" :key="item" :label="item" :value="item" />
            </el-select>
          </el-form-item>
          <el-form-item label="菌盖边缘">
            <el-select v-model="criteria.capMargin" placeholder="不限" clearable style="width: 100%">
              <el-option v-for="item in CAP_MARGINS" :key="item" :label="item" :value="item" />
            </el-select>
          </el-form-item>
          <el-form-item label="表面质地">
            <el-select v-model="criteria.capTexture" placeholder="不限" clearable style="width: 100%">
              <el-option v-for="item in CAP_TEXTURES" :key="item" :label="item" :value="item" />
            </el-select>
          </el-form-item>
          <el-form-item label="菌褶密度">
            <el-select v-model="criteria.gillDensity" placeholder="不限" clearable style="width: 100%">
              <el-option v-for="item in GILL_DENSITIES" :key="item" :label="item" :value="item" />
            </el-select>
          </el-form-item>
          <el-form-item label="菌肉反应">
            <el-select v-model="criteria.fleshReaction" placeholder="不限" clearable style="width: 100%">
              <el-option v-for="item in FLESH_REACTIONS" :key="item" :label="item" :value="item" />
            </el-select>
          </el-form-item>
          <el-form-item label="关联树种">
            <el-input v-model="criteria.hostTree" placeholder="如 辽东栎" clearable />
          </el-form-item>
        </el-form>
        <div class="rule">
          <p>权重：着生方式 26 · 孢子印 22 · 菌盖形状 12 · 表面质地 10 · 菌褶密度 10 · 边缘 8 · 菌肉反应 8 · 树种 4</p>
          <p>印色与着生方式不一致时，若属于该印色的先验组合仍计半分。</p>
        </div>
      </el-card>

      <div class="right">
        <el-card shadow="never" class="candidate-card">
          <template #header>候选名录（按匹配度排序，共 {{ candidates.length }} 条）</template>
          <div class="candidate-list">
            <button
              v-for="item in candidates"
              :key="item.record.id"
              type="button"
              class="candidate"
              :class="{ active: activeRecordId === item.record.id }"
              @click="activeRecordId = item.record.id"
            >
              <div class="candidate-top">
                <span class="mono">{{ item.record.code }}</span>
                <span class="cand-name">{{ item.record.tempName || '未命名条目' }}</span>
                <span class="percent">{{ item.percent }}%</span>
              </div>
              <el-progress :percentage="item.percent" :show-text="false" :stroke-width="6" />
              <div class="candidate-tags">
                <GillAttachmentTag :attachment="item.record.attachment" />
                <SporePrintSwatch :color="item.spore?.color ?? null" :caption="`${item.record.capShape} · ${item.record.gillDensity}褶`" />
              </div>
              <div class="match-line">
                <span v-if="item.matched.length" class="hit">命中：{{ item.matched.join('、') }}</span>
                <span v-if="item.missed.length" class="miss">未命中：{{ item.missed.join('、') }}</span>
              </div>
              <div class="candidate-actions">
                <el-button
                  size="small"
                  type="primary"
                  plain
                  :disabled="!isIdentifier"
                  @click.stop="pickCandidate(item.record.id, draftConclusion(item.record.tempName))"
                >
                  以该条为结论草稿
                </el-button>
                <span v-if="latestOf(item.record.id)" class="muted">
                  已有结论 v{{ latestOf(item.record.id)?.version }}：{{ latestOf(item.record.id)?.conclusion }}
                </span>
                <span v-else class="muted">尚无结论</span>
              </div>
            </button>
            <el-empty v-if="candidates.length === 0" description="暂无条目，先去图谱总览新建" />
          </div>
        </el-card>

        <el-card shadow="never" class="log-card">
          <template #header>
            记录鉴定结论 / 复核
            <span v-if="active" class="muted"> · 目标条目 {{ active.code }}（{{ pointName(active.pointId) }}）</span>
          </template>

          <div class="lock-bar">
            <template v-if="active">
              <el-tag v-if="entryLock.writable.value" type="success" size="small" effect="dark">本窗口持有写权</el-tag>
              <el-tag v-else-if="entryLock.heldByOther.value" type="info" size="small" effect="dark">
                只读：写权在「{{ entryLock.lock.value?.holderName }}」窗口，关闭/卡死后自动放开
              </el-tag>
              <el-tag v-else type="warning" size="small" effect="plain">尚未取得写权</el-tag>
              <el-button
                size="small"
                type="primary"
                plain
                :loading="entryLock.acquiring.value"
                :disabled="!isIdentifier || entryLock.writable.value"
                @click="startWriting"
              >
                取得写权开始落结论
              </el-button>
              <el-button
                v-if="latestLog"
                size="small"
                :disabled="!entryLock.writable.value"
                @click="reviseLatest"
              >
                修订 / 复核最新一条
              </el-button>
            </template>
          </div>

          <div v-if="latestLog" class="latest-bar">
            <VersionBadge :row="latestLog" detailed />
            <span class="muted">
              {{ latestLog.conclusion }} · {{ latestLog.confidence }}置信
              <template v-if="latestLog.needReview"> · 待复核</template>
            </span>
          </div>

          <el-form label-width="92px">
            <fieldset :disabled="!entryLock.writable.value" class="log-fieldset">
            <el-form-item label="结论学名" required>
              <el-input v-model="logForm.conclusion" placeholder="如 Lepista sordida" />
            </el-form-item>
            <el-row :gutter="12">
              <el-col :span="12">
                <el-form-item label="依据">
                  <el-select v-model="logForm.basis" style="width: 100%">
                    <el-option v-for="item in ID_BASES" :key="item" :label="item" :value="item" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="置信度">
                  <el-select v-model="logForm.confidence" style="width: 100%">
                    <el-option v-for="item in ID_CONFIDENCES" :key="item" :label="item" :value="item" />
                  </el-select>
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="12">
              <el-col :span="14">
                <el-form-item label="参考图鉴">
                  <el-input v-model="logForm.referenceBook" placeholder="如 《菌物图鉴》" />
                </el-form-item>
              </el-col>
              <el-col :span="10">
                <el-form-item label="页码">
                  <el-input v-model="logForm.referencePage" placeholder="如 P.145" />
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="12">
              <el-col :span="12">
                <el-form-item label="复核人">
                  <el-input v-model="logForm.reviewer" placeholder="如 祁野" />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="待复核">
                  <el-switch v-model="logForm.needReview" />
                </el-form-item>
              </el-col>
            </el-row>
            <div class="form-actions">
              <el-button
                type="primary"
                :loading="saving"
                :disabled="!entryLock.writable.value"
                @click="saveLog"
              >
                <template v-if="isRevising">保存修订（基于打开版本 v{{ baseLog?.version ?? '?' }}）</template>
                <template v-else>保存鉴定结论（新增留痕）</template>
              </el-button>
              <el-button v-if="isRevising" @click="resetForm">改为新增一条</el-button>
            </div>
            </fieldset>
          </el-form>
        </el-card>
      </div>
    </div>
  </div>
</template>

<style scoped>
.role-alert {
  margin-bottom: 12px;
}
.layout {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-start;
}
.criteria-card {
  width: 300px;
  border-radius: 12px;
}
.right {
  flex: 1 1 520px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.candidate-card,
.log-card {
  border-radius: 12px;
}
.candidate-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 460px;
  overflow: auto;
}
.candidate {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid #e8e2d6;
  border-radius: 10px;
  background: #fff;
  text-align: left;
  cursor: pointer;
}
.candidate.active {
  border-color: #c96f3a;
  box-shadow: 0 0 0 1px #c96f3a inset;
}
.candidate-top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cand-name {
  font-size: 13px;
  font-weight: 600;
}
.percent {
  margin-left: auto;
  font-size: 13px;
  color: #c96f3a;
  font-weight: 600;
}
.candidate-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.match-line {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
}
.hit {
  color: #2f7a4d;
}
.miss {
  color: #a45b1f;
}
.candidate-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rule {
  padding: 8px 10px;
  border-radius: 8px;
  background: #f7f5f0;
  font-size: 11px;
  color: #6f7d72;
  line-height: 1.7;
}
.rule p {
  margin: 0;
}
.lock-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f7f5f0;
}
.latest-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.log-fieldset[disabled] {
  border: 0;
  padding: 0;
  opacity: 0.8;
}
.form-actions {
  padding-left: 92px;
}
</style>
