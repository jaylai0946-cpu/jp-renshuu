import { DEFAULT_SETTINGS, SCHEMA_VERSION } from '../constants'
import { ITEMS } from '../data/units'
import type { AppState, DayHist, Progress, Settings, Song, SongLine, SongWord } from '../types'
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
    batchSize: int(r.batchSize, DEFAULT_SETTINGS.batchSize, 1, 20),
    haptics: bool(r.haptics, DEFAULT_SETTINGS.haptics),
    theme: r.theme === 'light' || r.theme === 'dark' || r.theme === 'auto' ? r.theme : DEFAULT_SETTINGS.theme,
    motion: r.motion === 'game' || r.motion === 'classic' ? r.motion : DEFAULT_SETTINGS.motion,
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
      songs: songList(raw.songs),
    },
  }
}

// ---- 歌曲 ----
// 歌詞是使用者貼的、分析結果是 AI 給的，兩邊都不信：每個字串都截長度，
// 陣列都限數量，免得一份壞掉的資料把同步的容量塞爆。

export const SONG_LIMITS = { songs: 30, lines: 200, words: 12, text: 300, note: 400, known: 1000 }

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

function songWord(raw: unknown): SongWord | null {
  if (!isRecord(raw)) return null
  const s = str(raw.s, 60).trim()
  if (!s) return null
  return { s, k: str(raw.k, 80), b: str(raw.b, 60), zh: str(raw.zh, 80) }
}

function songLine(raw: unknown): SongLine | null {
  if (!isRecord(raw)) return null
  const jp = str(raw.jp, SONG_LIMITS.text).trim()
  if (!jp) return null
  const words = Array.isArray(raw.words)
    ? raw.words.map(songWord).filter((w): w is SongWord => w !== null).slice(0, SONG_LIMITS.words)
    : []
  return {
    jp,
    kana: str(raw.kana, SONG_LIMITS.text),
    ro: str(raw.ro, SONG_LIMITS.text),
    zh: str(raw.zh, SONG_LIMITS.text),
    words,
    note: str(raw.note, SONG_LIMITS.note),
  }
}

/** 一首歌的檢查，存進 state 前（含 AI 剛回來的分析結果）都要過這關 */
export function validSong(raw: unknown): Song | null {
  return song(raw)
}

function song(raw: unknown): Song | null {
  if (!isRecord(raw)) return null
  const id = str(raw.id, 40)
  if (!/^[a-z0-9-]{4,40}$/.test(id)) return null
  const updated = str(raw.updated, 40)
  if (raw.deleted === true) {
    // 墓碑只留 id 和時間，內容不用再帶著同步
    return { id, title: '', artist: '', video: '', lines: [], known: [], updated, deleted: true }
  }
  const lines = Array.isArray(raw.lines)
    ? raw.lines.map(songLine).filter((l): l is SongLine => l !== null).slice(0, SONG_LIMITS.lines)
    : []
  const title = str(raw.title, 100).trim()
  if (!title || !lines.length) return null
  const video = str(raw.video, 20)
  return {
    id,
    title,
    artist: str(raw.artist, 100).trim(),
    video: /^[\w-]{6,20}$/.test(video) ? video : '',
    lines,
    known: Array.isArray(raw.known)
      ? [...new Set(raw.known.filter((k): k is string => typeof k === 'string' && k.length <= 150))].slice(
          0,
          SONG_LIMITS.known,
        )
      : [],
    updated,
    ...(raw.ownZh === true ? { ownZh: true as const } : {}),
  }
}

function songList(raw: unknown): Song[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Song[] = []
  for (const r of raw) {
    const s = song(r)
    if (!s || seen.has(s.id)) continue
    seen.add(s.id)
    out.push(s)
  }
  // 墓碑不佔「最多 30 首」的名額，但也不無限累積
  const alive = out.filter((s) => !s.deleted).slice(0, SONG_LIMITS.songs)
  const graves = out.filter((s) => s.deleted).slice(0, 100)
  return [...alive, ...graves]
}
