import { DEFAULT_SETTINGS, SCHEMA_VERSION } from '../constants'
import { ITEMS } from '../data/units'
import type { AppState, DayHist, Progress, Settings } from '../types'
import { isDayString } from './dates'

export type ValidationResult = { ok: true; state: AppState } | { ok: false; error: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function int(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, Math.round(v)))
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/** 認不得的 id 直接丟掉——題庫換過之後留著也出不了題。 */
function progressMap(raw: unknown, today: string): Record<string, Progress> {
  if (!isRecord(raw)) return {}
  const out: Record<string, Progress> = {}
  for (const [id, value] of Object.entries(raw)) {
    if (!ITEMS[id] || !isRecord(value)) continue
    out[id] = {
      b: int(value.b, 0, 0, 6),
      due: isDayString(value.due) ? value.due : today,
      seen: int(value.seen, 0, 0, Number.MAX_SAFE_INTEGER),
      wrong: int(value.wrong, 0, 0, Number.MAX_SAFE_INTEGER),
    }
  }
  return out
}

function histMap(raw: unknown): Record<string, DayHist> {
  if (!isRecord(raw)) return {}
  const out: Record<string, DayHist> = {}
  for (const [day, value] of Object.entries(raw)) {
    if (!isDayString(day) || !isRecord(value)) continue
    const big = Number.MAX_SAFE_INTEGER
    out[day] = {
      n: int(value.n, 0, 0, big),
      c: int(value.c, 0, 0, big),
      xp: int(value.xp, 0, 0, big),
      w: int(value.w, 0, 0, big),
      h: int(value.h, 0, 0, big),
    }
  }
  return out
}

function settings(raw: unknown): Settings {
  const r = isRecord(raw) ? raw : {}
  return {
    // 允許 0：代表今天只複習、不學新字。夾成 1 的話使用者關不掉
    newPerDay: int(r.newPerDay, DEFAULT_SETTINGS.newPerDay, 0, 50),
    romaji: bool(r.romaji, DEFAULT_SETTINGS.romaji),
    sound: bool(r.sound, DEFAULT_SETTINGS.sound),
    penOnly: bool(r.penOnly, DEFAULT_SETTINGS.penOnly),
    writePerDay: int(r.writePerDay, DEFAULT_SETTINGS.writePerDay, 0, 30),
  }
}

/**
 * 什麼都不信：雲端拉回來的、使用者貼進來的、localStorage 讀出來的都走這裡。
 * 壞掉的欄位補預設值而不是整包丟掉——丟掉的話一個 typo 就讓人的進度全沒了。
 */
export function validateAppState(raw: unknown, today: string): ValidationResult {
  if (!isRecord(raw)) return { ok: false, error: '不是一個物件' }

  const newDayRaw = isRecord(raw.newDay) ? raw.newDay : {}
  return {
    ok: true,
    state: {
      version: SCHEMA_VERSION,
      items: progressMap(raw.items, today),
      write: progressMap(raw.write, today),
      hist: histMap(raw.hist),
      settings: settings(raw.settings),
      newDay: {
        d: isDayString(newDayRaw.d) ? newDayRaw.d : '',
        n: int(newDayRaw.n, 0, 0, 999),
      },
    },
  }
}
