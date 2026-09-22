import { ITEMS, UNITS, UNIT_BY_ID } from '../data/units'
import type { AppState, DayHist, Item, Progress, Unit } from '../types'
import { addDays, ymd } from './dates'

/**
 * 盒子 0-6 對應的間隔天數。答對就往上一格，答錯直接回盒子 1。
 * 照 Artifact 版，不要調：進度匯進來之後間隔得一致，不然複習節奏會亂。
 */
export const INTERVALS = [0, 1, 2, 4, 8, 16, 32]
export const MAX_BOX = 6

/** 每日練習的複習題上限。新字會補進剩下的額度裡。 */
export const MAX_REVIEW = 15
/** 熟練度到這一格才開始出反向題（羅馬拼音→假名、中文→日文） */
export const REVERSE_FROM_BOX = 2
/** 辨識到這一格才開始出默寫題。SPEC：會認之後才練寫 */
export const WRITE_FROM_BOX = 2
/** 「我已經會了」把整個單元標到這一格 */
export const KNOWN_BOX = 3

export type Rng = () => number

/** Fisher-Yates。傳 rand 進來是為了測試能固定順序。 */
export function shuffle<T>(a: T[], rand: Rng = Math.random): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function emptyHist(): DayHist {
  return { n: 0, c: 0, xp: 0, w: 0, h: 0 }
}

/** 有答題或有批改或有手寫，這天才算練過。 */
export function practiced(h: DayHist | undefined): boolean {
  return !!h && (h.n > 0 || h.w > 0 || h.h > 0)
}

export function newProgress(today: string): Progress {
  return { b: 0, due: today, seen: 0, wrong: 0 }
}

/**
 * 答完一題之後這個字的新進度。純函式，不碰 state。
 * 答錯一律回盒子 1（不是 0）——回 0 的話明天又當新字介紹一次，太囉唆。
 */
export function schedule(p: Progress, ok: boolean, today: string): Progress {
  if (ok) {
    const b = Math.min(p.b + 1, MAX_BOX)
    return { b, due: addDays(today, INTERVALS[b]), seen: p.seen + 1, wrong: p.wrong }
  }
  return { b: 1, due: addDays(today, 1), seen: p.seen + 1, wrong: p.wrong + 1 }
}

/** 到期的字，早到期的排前面。已經從題庫移除的 id 會自動跳過。 */
export function dueIds(state: AppState, today: string): string[] {
  return Object.keys(state.items)
    .filter((id) => ITEMS[id] && state.items[id].due <= today)
    .sort((a, b) => (state.items[a].due < state.items[b].due ? -1 : 1))
}

/** 照單元順序、單元內照字序，挑出還沒學過的前 n 個。 */
export function nextNew(state: AppState, n: number, unitId?: string): string[] {
  const out: string[] = []
  const units = unitId ? [UNIT_BY_ID[unitId]].filter(Boolean) : UNITS
  for (const unit of units) {
    for (const it of unit.items) {
      if (out.length >= n) return out
      if (!state.items[it.id]) out.push(it.id)
    }
  }
  return out
}

/** 第一個還有沒學完的單元，首頁「正在學」用。 */
export function currentUnit(state: AppState): Unit | null {
  return UNITS.find((u) => u.items.some((it) => !state.items[it.id])) ?? null
}

export function newToday(state: AppState, today: string): number {
  return state.newDay.d === today ? state.newDay.n : 0
}

/** 從今天（沒練就從昨天）往回數，連續練過幾天。 */
export function streak(state: AppState, today: string): number {
  let d = practiced(state.hist[today]) ? today : addDays(today, -1)
  let n = 0
  while (practiced(state.hist[d])) {
    n++
    d = addDays(d, -1)
  }
  return n
}

/**
 * 該練手寫的字：辨識已經到 WRITE_FROM_BOX，而且手寫本身到期（或根本還沒寫過）。
 * 只出假名——第一版不練漢字。
 */
export function writeDueIds(state: AppState, today: string): string[] {
  const eligible = Object.keys(state.items).filter((id) => {
    const it = ITEMS[id]
    if (!it || it.t !== 'kana') return false
    if (state.items[id].b < WRITE_FROM_BOX) return false
    const w = state.write[id]
    return !w || w.due <= today
  })
  // 沒寫過的排前面，其餘照到期日
  return eligible.sort((a, b) => {
    const wa = state.write[a]
    const wb = state.write[b]
    if (!wa && !wb) return 0
    if (!wa) return -1
    if (!wb) return 1
    return wa.due < wb.due ? -1 : 1
  })
}

export interface QueueEntry {
  id: string
  /** 這題是第一次見到的新字，要先出介紹卡 */
  isNew?: boolean
  /** 答錯之後補在回合尾巴的那一題 */
  retry?: boolean
  /** 默寫題（手寫），不是選擇題 */
  write?: boolean
}

export type RoundOptions =
  | { kind: 'daily' }
  | { kind: 'unit'; unitId: string }
  | { kind: 'random' }
  | { kind: 'extra' }
  /** 單元的手寫專練 */
  | { kind: 'writeUnit'; unitId: string }

/** 組出一回合的題目。回傳空陣列就代表今天沒得練。 */
export function buildRound(
  state: AppState,
  opt: RoundOptions,
  today: string,
  rand: Rng = Math.random,
): QueueEntry[] {
  let review: string[] = []
  let fresh: string[] = []
  let writes: string[] = []

  if (opt.kind === 'unit') {
    const unit = UNIT_BY_ID[opt.unitId]
    if (!unit) return []
    review = dueIds(state, today)
      .filter((id) => ITEMS[id].u === opt.unitId)
      .slice(0, 8)
    fresh = nextNew(state, Math.min(5, 10 - review.length), opt.unitId)
    if (review.length + fresh.length < 8) {
      // 這個單元沒到期的題目不夠，就拿學過的來湊，不要只出三題就結束
      const seen = shuffle(
        unit.items.map((i) => i.id).filter((id) => state.items[id] && !review.includes(id)),
        rand,
      )
      review = review.concat(seen.slice(0, 10 - review.length - fresh.length))
    }
  } else if (opt.kind === 'writeUnit') {
    const unit = UNIT_BY_ID[opt.unitId]
    if (!unit || unit.kind !== 'kana') return []
    writes = writeDueIds(state, today).filter((id) => ITEMS[id].u === opt.unitId)
    if (!writes.length) {
      // 全部都還沒到期，就隨機複習寫過的
      writes = shuffle(
        unit.items.map((i) => i.id).filter((id) => state.write[id]),
        rand,
      ).slice(0, 10)
    }
    writes = writes.slice(0, 10)
  } else if (opt.kind === 'random') {
    review = shuffle(
      Object.keys(state.items).filter((id) => ITEMS[id]),
      rand,
    ).slice(0, 10)
  } else if (opt.kind === 'extra') {
    fresh = nextNew(state, 5)
  } else {
    review = dueIds(state, today).slice(0, MAX_REVIEW)
    const quota = Math.max(0, state.settings.newPerDay - newToday(state, today))
    fresh = nextNew(state, Math.min(quota, Math.max(0, MAX_REVIEW - review.length)))
    // 默寫題不佔複習額度，自己另外算一份
    writes = writeDueIds(state, today).slice(0, state.settings.writePerDay)
  }

  const queue: QueueEntry[] = [
    ...review.map((id) => ({ id })),
    ...fresh.map((id) => ({ id, isNew: true })),
    ...writes.map((id) => ({ id, write: true })),
  ]
  return shuffle(queue, rand)
}

export type QuestionMode = 'kana2ro' | 'ro2kana' | 'jp2zh' | 'zh2jp'

export interface Question {
  id: string
  mode: QuestionMode
  answer: string
  choices: string[]
}

/**
 * 湊四個選項：正確答案 + 同單元的三個干擾項。
 * key 跟 val 分開是為了 ぢ/じ、づ/ず 這種讀音相同的字——出「ji 是哪個假名」時
 * 不能把兩個都放進選項，不然兩個都對。
 */
function pickChoices(
  it: Item,
  pool: Item[],
  val: (x: Item) => string,
  key: (x: Item) => string = val,
  rand: Rng = Math.random,
): string[] {
  const answer = val(it)
  const out = [answer]
  const others = shuffle(
    pool.filter((x) => x.id !== it.id && key(x) !== key(it) && val(x) !== answer),
    rand,
  )
  for (const other of others) {
    if (out.length >= 4) break
    if (!out.includes(val(other))) out.push(val(other))
  }
  return shuffle(out, rand)
}

export function makeQuestion(id: string, state: AppState, rand: Rng = Math.random): Question {
  const it = ITEMS[id]
  const box = state.items[id]?.b ?? 0
  const pool = UNIT_BY_ID[it.u].items
  const reverse = box >= REVERSE_FROM_BOX && rand() < 0.5

  if (it.t === 'kana') {
    const ch = (x: Item) => (x as { ch: string }).ch
    const ro = (x: Item) => x.ro
    return reverse
      ? { id, mode: 'ro2kana', answer: it.ch, choices: pickChoices(it, pool, ch, ro, rand) }
      : { id, mode: 'kana2ro', answer: it.ro, choices: pickChoices(it, pool, ro, ro, rand) }
  }

  const jp = (x: Item) => (x as { jp: string }).jp
  const zh = (x: Item) => (x as { zh: string }).zh
  return reverse
    ? { id, mode: 'zh2jp', answer: it.jp, choices: pickChoices(it, pool, jp, zh, rand) }
    : { id, mode: 'jp2zh', answer: it.zh, choices: pickChoices(it, pool, zh, zh, rand) }
}

/** 「我已經會了」：整個單元還沒學的字直接放進盒子 KNOWN_BOX。 */
export function markKnownPatch(
  state: AppState,
  unitId: string,
  today: string,
): Record<string, Progress> {
  const unit = UNIT_BY_ID[unitId]
  if (!unit) return {}
  const patch: Record<string, Progress> = {}
  for (const it of unit.items) {
    if (state.items[it.id]) continue
    patch[it.id] = { b: KNOWN_BOX, due: addDays(today, INTERVALS[KNOWN_BOX]), seen: 0, wrong: 0 }
  }
  return patch
}

/** 首頁要顯示的「今天有幾題」。 */
export function todayCounts(state: AppState, today: string = ymd()) {
  const review = Math.min(dueIds(state, today).length, MAX_REVIEW)
  const quota = Math.max(0, state.settings.newPerDay - newToday(state, today))
  const fresh = Math.min(quota, Math.max(0, MAX_REVIEW - review), nextNew(state, 99).length)
  const write = Math.min(writeDueIds(state, today).length, state.settings.writePerDay)
  return { review, fresh, write, total: review + fresh + write }
}
