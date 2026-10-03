<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { IdentifyLog } from '@/types'
import {
  CAP_MARGINS,
  CAP_SHAPES,
  CAP_TEXTURES,
  FLESH_REACTIONS,
  GILL_ATTACHMENTS,
  GILL_DENSITIES,
  ID_BASES,
  ID_CONFIDENCES,
  SPORE_COLORS
} from '@/types'
import type { FieldConflict } from '@/types/concurrency'
import { ConflictError } from '@/types/concurrency'
import ConflictDialog from '@/components/common/ConflictDialog.vue'
import GillAttachmentTag from '@/components/common/GillAttachmentTag.vue'
import SporePrintSwatch from '@/components/common/SporePrintSwatch.vue'
import { useStore } from '@/hooks/usePersistentStore'
import { useEditorLock } from '@/hooks/useEditorLock'
import { useVersionedDraft } from '@/hooks/useVersionedDraft'
import { EMPTY_CRITERIA, useCandidateMatch, type MatchCriteria } from '@/hooks/useCandidateMatch'
import { recordStore } from '@/stores/recordStore'
import { sporeStore } from '@/stores/sporeStore'
import { identifyStore } from '@/stores/identifyStore'
import { pointStore } from '@/stores/pointStore'
import { uid } from '@/utils/id'

const recordState = useStore(recordStore)
const sporeState = useStore(sporeStore)
const identifyState = useStore(identifyStore)
const pointState = useStore(pointStore)

const criteria = reactive<MatchCriteria>({ ...EMPTY_CRITERIA })
const { candidates, hasCondition } = useCandidateMatch(
  computed(() => recordState.records),
  computed(() => sporeState.spores),
  computed(() => ({ ...criteria }))
)

const activeRecordId = ref('')
const active = computed(() => recordState.records.find((item) => item.id === activeRecordId.value) ?? null)

/** 该条目的最新鉴定结论（鉴定人在其基础上编辑） */
const latestLog = computed<IdentifyLog | null>(() => {
  const list = identifyState.logs
    .filter((item) => item.recordId === activeRecordId.value)
    .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id))
  return list[0] ?? null
})

// 编辑锁：鉴定人角色，同一条目同一时间只允许一个窗口写结论
const { readOnly, lockHolder } = useEditorLock('record', computed(() => activeRecordId.value), 'identifier')

// 版本化草稿
const {
  baseVersion: logBaseVersion,
  baseSnapshot: logBaseSnapshot,
  reset: resetLogVersion,
  commit: commitLog
} = useVersionedDraft(latestLog)

const logForm = reactive({
  conclusion: '',
  basis: '形态特征' as IdentifyLog['basis'],
  referenceBook: '',
  referencePage: '',
  confidence: '中' as IdentifyLog['confidence'],
  needReview: true,
  reviewer: ''
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

/** 把最新结论载入表单 */
function loadLatestIntoForm(log: IdentifyLog | null): void {
  if (log) {
    logForm.conclusion = log.conclusion
    logForm.basis = log.basis
    logForm.referenceBook = log.referenceBook
    logForm.referencePage = log.referencePage
    logForm.confidence = log.confidence
    logForm.needReview = log.needReview
    logForm.reviewer = log.reviewer
    resetLogVersion(log)
  } else {
    logForm.conclusion = ''
    logForm.referenceBook = ''
    logForm.referencePage = ''
    logForm.reviewer = ''
  }
}

watch(latestLog, (log) => loadLatestIntoForm(log), { immediate: true })

watch(
  () => [recordState.records.length, activeRecordId.value] as const,
  () => {
    if (!activeRecordId.value && recordState.records.length > 0) {
      activeRecordId.value = recordState.records[0].id
    }
  },
  { immediate: true }
)

function pointName(pointId: string): string {
  return pointState.points.find((point) => point.id === pointId)?.name ?? '未关联采集点'
}

function resetCriteria(): void {
  Object.assign(criteria, EMPTY_CRITERIA)
}

function pickCandidate(recordId: string, conclusion: string): void {
  activeRecordId.value = recordId
  logForm.conclusion = conclusion
  ElMessage.info('已把候选条目的暂定名填入结论，请核对后保存')
}

/** 依据候选条目生成学名草稿（暂定名去掉括号说明） */
function draftConclusion(tempName: string): string {
  return tempName.replace(/[（(].*?[)）]/g, '').trim()
}

async function handleRetry(): Promise<void> {
  await identifyStore.getState().hydrate()
  loadLatestIntoForm(latestLog.value)
  ElMessage.info('已载入最新结论，请重新编辑后保存')
}

async function saveLog(): Promise<void> {
  if (!active.value) {
    ElMessage.warning('请先在候选名录中选择要落结论的条目')
    return
  }
  if (!logForm.conclusion.trim()) {
    ElMessage.warning('请填写结论学名')
    return
  }
  const log: IdentifyLog = {
    id: latestLog.value?.id ?? uid('idf'),
    recordId: active.value.id,
    conclusion: logForm.conclusion.trim(),
    basis: logForm.basis,
    referenceBook: logForm.referenceBook.trim(),
    referencePage: logForm.referencePage.trim(),
    confidence: logForm.confidence,
    needReview: logForm.needReview,
    reviewer: logForm.reviewer.trim(),
    date: latestLog.value?.date ?? new Date().toISOString().slice(0, 10),
    identifier: latestLog.value?.identifier || logForm.reviewer.trim() || '',
    version: latestLog.value?.version ?? 1
  }
  try {
    const result = await identifyStore
      .getState()
      .save(log, logBaseVersion.value, logBaseSnapshot.value ?? log)
    commitLog(result.saved)
    ElMessage.success(`${active.value.code} 已记录结论：${log.conclusion}（${log.confidence}）`)
  } catch (e) {
    if (e instanceof ConflictError) {
      showConflict(e)
    } else {
      throw e
    }
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
          左侧勾选观察到的形态特征与孢子印条件，右侧实时给出候选名录排序（着生方式与印色权重最高），确认后落鉴定结论。
        </p>
      </div>
      <el-tag type="info" effect="plain">{{ hasCondition ? '已设条件，按匹配度排序' : '未设条件，按编号排序' }}</el-tag>
    </div>

    <el-alert
      v-if="readOnly"
      class="lock-banner"
      type="warning"
      show-icon
      :title="`该条目的结论正被其他窗口编辑（会话 ${lockHolder ?? '未知'}），当前为只读模式。对方关闭窗口或超时后将自动释放。`"
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
                  :disabled="readOnly"
                  @click.stop="pickCandidate(item.record.id, draftConclusion(item.record.tempName))"
                >
                  以该条为结论草稿
                </el-button>
                <span v-if="latestOf(item.record.id)" class="muted">已有结论：{{ latestOf(item.record.id)?.conclusion }}</span>
                <span v-else class="muted">尚无结论</span>
              </div>
            </button>
            <el-empty v-if="candidates.length === 0" description="暂无条目，先去图谱总览新建" />
          </div>
        </el-card>

        <el-card shadow="never" class="log-card">
          <template #header>
            记录鉴定结论
            <span v-if="active" class="muted"> · 目标条目 {{ active.code }}（{{ pointName(active.pointId) }}）</span>
            <el-tag v-if="latestLog" size="small" effect="plain" round class="ver-tag">鉴定稿 v{{ latestLog.version }}</el-tag>
          </template>
          <el-form label-width="92px">
            <el-form-item label="结论学名" required>
              <el-input v-model="logForm.conclusion" placeholder="如 Lepista sordida" :disabled="readOnly" />
            </el-form-item>
            <el-row :gutter="12">
              <el-col :span="12">
                <el-form-item label="依据">
                  <el-select v-model="logForm.basis" style="width: 100%" :disabled="readOnly">
                    <el-option v-for="item in ID_BASES" :key="item" :label="item" :value="item" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="置信度">
                  <el-select v-model="logForm.confidence" style="width: 100%" :disabled="readOnly">
                    <el-option v-for="item in ID_CONFIDENCES" :key="item" :label="item" :value="item" />
                  </el-select>
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="12">
              <el-col :span="14">
                <el-form-item label="参考图鉴">
                  <el-input v-model="logForm.referenceBook" placeholder="如 《菌物图鉴》" :disabled="readOnly" />
                </el-form-item>
              </el-col>
              <el-col :span="10">
                <el-form-item label="页码">
                  <el-input v-model="logForm.referencePage" placeholder="如 P.145" :disabled="readOnly" />
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="12">
              <el-col :span="12">
                <el-form-item label="复核人">
                  <el-input v-model="logForm.reviewer" placeholder="如 祁野" :disabled="readOnly" />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="待复核">
                  <el-switch v-model="logForm.needReview" :disabled="readOnly" />
                </el-form-item>
              </el-col>
            </el-row>
            <div class="form-actions">
              <el-button type="primary" :disabled="readOnly" @click="saveLog">保存鉴定结论</el-button>
            </div>
          </el-form>
        </el-card>
      </div>
    </div>

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
.layout {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-start;
}
.lock-banner {
  margin-bottom: 12px;
  border-radius: 8px;
}
.ver-tag {
  margin-left: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
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
.form-actions {
  padding-left: 92px;
}
</style>
