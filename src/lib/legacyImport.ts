import { ITEMS } from '../data/units'
import type { AppState } from '../types'
import { ymd } from './dates'
import { emptyState } from './storage'
import { validateAppState } from './validate'

/**
 * Artifact 版的進度長這樣（jp-renshuu.html 裡 <script id="state"> 的內容）：
 *   {v:1, items:{'h:あ':{b,due,seen,wrong}}, hist:{'2026-09-22':{n,c,xp,w}},
 *    settings:{newPerDay,romaji,sound}, newDay:{d,n}, updatedAt:123}
 *
 * item id 格式（h:／k:／w: 前綴）新版原封不動沿用，所以只要補上新欄位就好：
 *   - write:{}   舊版沒有手寫
 *   - hist[].h   舊版沒有手寫題數
 *   - settings.penOnly / writePerDay
 */
export type LegacyResult =
  | { ok: true; state: AppState; matched: number; dropped: number }
  | { ok: false; error: string }

export function importLegacy(text: string, today = ymd()): LegacyResult {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, error: '沒有貼上任何東西' }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { ok: false, error: '不是合法的 JSON。要貼的是 { "v":1, "items":{...} } 這種內容' }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: '不是一個物件' }
  }

  const raw = parsed as Record<string, unknown>
  const items = typeof raw.items === 'object' && raw.items !== null ? raw.items : null
  if (!items) return { ok: false, error: '找不到 items，這看起來不是練習本的進度' }

  const ids = Object.keys(items as Record<string, unknown>)
  const matched = ids.filter((id) => ITEMS[id]).length
  if (ids.length > 0 && matched === 0) {
    return { ok: false, error: '裡面沒有一個字對得上目前的題庫，沒有匯入' }
  }

  const result = validateAppState({ ...raw, write: {} }, today)
  if (!result.ok) return { ok: false, error: result.error }

  return {
    ok: true,
    state: { ...emptyState(), ...result.state },
    matched,
    dropped: ids.length - matched,
  }
}
