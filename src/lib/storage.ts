import { DEFAULT_SETTINGS, SCHEMA_VERSION, STORAGE_KEY } from '../constants'
import type { AppState } from '../types'
import { ymd } from './dates'
import { validateAppState } from './validate'

export const CORRUPT_KEY = `${STORAGE_KEY}.corrupt`

export function emptyState(): AppState {
  return {
    version: SCHEMA_VERSION,
    items: {},
    write: {},
    hist: {},
    settings: { ...DEFAULT_SETTINGS },
    newDay: { d: '', n: 0 },
  }
}

/** 全新安裝、什麼都還沒動過。啟用同步時用來判斷要不要算成「有本機改動」。 */
export function isPristine(state: AppState): boolean {
  return (
    Object.keys(state.items).length === 0 &&
    Object.keys(state.write).length === 0 &&
    Object.keys(state.hist).length === 0
  )
}

/**
 * 舊版資料升級。目前只有 v1，之後改形狀時在這裡往下接：
 *   if (version < 2) { ...; version = 2 }
 */
function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  // Artifact 版用 v 當版本欄位，新版用 version。兩個都認。
  const version = typeof raw.version === 'number' ? raw.version : typeof raw.v === 'number' ? raw.v : 0
  if (version > SCHEMA_VERSION) {
    // 另一台裝置跑著更新的版本。不猜它的形狀，交給 validate 盡量撈能用的欄位。
    return raw
  }
  return raw
}

export function loadState(): AppState {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return emptyState()
  }
  if (!raw) return emptyState()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 壞掉的資料先留一份再重來，至少還有機會救
    try {
      localStorage.setItem(CORRUPT_KEY, raw)
    } catch {
      // 連備份都存不下就算了
    }
    return emptyState()
  }

  if (typeof parsed !== 'object' || parsed === null) return emptyState()
  const result = validateAppState(migrate(parsed as Record<string, unknown>), ymd())
  return result.ok ? result.state : emptyState()
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 空間滿了或無痕模式。存不了就算了，不能因此讓 App 掛掉
  }
}

export function exportJSON(state: AppState): string {
  return JSON.stringify(state, null, 2)
}

export function importJSON(text: string, today = ymd()) {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false as const, error: '不是合法的 JSON' }
  }
  return validateAppState(parsed, today)
}
