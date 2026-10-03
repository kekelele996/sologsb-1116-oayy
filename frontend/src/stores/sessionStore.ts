import { createStore } from 'zustand/vanilla'
import type { EditorRole } from '@/types'
import { ROLE_RECORDER } from '@/types'

/**
 * 当前窗口的操作身份。共用机器上每人先在左上角选「我是记录员 / 鉴定人」并署名：
 * - 记录员：只能写采集点、形态条目、孢子印；
 * - 鉴定人：只能写鉴定结论与复核。
 * 身份存在 localStorage，刷新不丢。
 */
export interface SessionState {
  role: EditorRole
  recorderName: string
  identifierName: string
  setRole: (role: EditorRole) => void
  setRecorderName: (name: string) => void
  setIdentifierName: (name: string) => void
}

const STORAGE_KEY = 'gbfg.session'

interface PersistedSession {
  role?: EditorRole
  recorderName?: string
  identifierName?: string
}

function loadPersisted(): PersistedSession {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as PersistedSession
  } catch {
    return {}
  }
}

function persist(state: Pick<SessionState, 'role' | 'recorderName' | 'identifierName'>): void {
  const data: PersistedSession = {
    role: state.role,
    recorderName: state.recorderName,
    identifierName: state.identifierName
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // 存储不可用时身份仅保存在内存
  }
}

const persisted = loadPersisted()

export const sessionStore = createStore<SessionState>((set, get) => ({
  role: persisted.role ?? ROLE_RECORDER,
  recorderName: persisted.recorderName ?? '',
  identifierName: persisted.identifierName ?? '',
  setRole: (role) => {
    set({ role })
    persist(get())
  },
  setRecorderName: (name) => {
    set({ recorderName: name })
    persist(get())
  },
  setIdentifierName: (name) => {
    set({ identifierName: name })
    persist(get())
  }
}))

/** 当前角色对应的署名 */
export function currentEditorName(): string {
  const state = sessionStore.getState()
  return state.role === 'recorder' ? state.recorderName.trim() : state.identifierName.trim()
}
