import type { AppState, Progress } from '../types'
import { emptyHist, newProgress, schedule } from './srs'

/**
 * 所有會改到進度的動作都寫成純函式，元件只負責呼叫。
 * 這樣回合邏輯不用掛在 React 上也測得動。
 */

/** 點數：第一次就答對給 10，補考答對給 5，答錯 0。造句批改 15。 */
export const XP_FIRST_CORRECT = 10
export const XP_RETRY_CORRECT = 5
export const XP_GRADE = 15

function bumpHist(state: AppState, day: string, patch: Partial<ReturnType<typeof emptyHist>>): AppState {
  const before = state.hist[day] ?? emptyHist()
  const after = { ...before }
  for (const [k, v] of Object.entries(patch)) {
    after[k as keyof typeof after] += v as number
  }
  return { ...state, hist: { ...state.hist, [day]: after } }
}

/** 介紹卡按「記住了」：建立進度，並把今天的新字額度用掉一格。 */
export function learnNew(state: AppState, id: string, today: string): AppState {
  if (state.items[id]) return state
  const newDay = state.newDay.d === today ? state.newDay : { d: today, n: 0 }
  return {
    ...state,
    items: { ...state.items, [id]: newProgress(today) },
    newDay: { d: today, n: newDay.n + 1 },
  }
}

/**
 * 答完一題選擇題。
 * first=false 是同一回合的補考，只給點數不動盒子——
 * 不然答錯之後補考答對就抵銷掉了，等於沒有懲罰。
 */
export function answerQuestion(
  state: AppState,
  id: string,
  ok: boolean,
  first: boolean,
  today: string,
): AppState {
  let next = state
  if (first) {
    const before = state.items[id] ?? newProgress(today)
    next = { ...next, items: { ...next.items, [id]: schedule(before, ok, today) } }
    next = bumpHist(next, today, { n: 1, c: ok ? 1 : 0 })
  }
  const xp = ok ? (first ? XP_FIRST_CORRECT : XP_RETRY_CORRECT) : 0
  return xp ? bumpHist(next, today, { xp }) : next
}

/**
 * 寫完一個字。手寫有自己的盒子，跟辨識分開排複習。
 * △（形狀偏了）當作答對但不加點數——筆順對了就值得往上一格。
 */
export function answerWriting(
  state: AppState,
  id: string,
  verdict: 'ok' | 'shape' | 'bad',
  first: boolean,
  today: string,
): AppState {
  let next = state
  if (first) {
    const before = state.write[id] ?? newProgress(today)
    next = { ...next, write: { ...next.write, [id]: schedule(before, verdict !== 'bad', today) } }
    next = bumpHist(next, today, { h: 1 })
  }
  const xp = verdict === 'ok' ? (first ? XP_FIRST_CORRECT : XP_RETRY_CORRECT) : 0
  return xp ? bumpHist(next, today, { xp }) : next
}

export function recordGrade(state: AppState, today: string): AppState {
  return bumpHist(state, today, { w: 1, xp: XP_GRADE })
}

export function applyProgressPatch(
  state: AppState,
  patch: Record<string, Progress>,
): AppState {
  return Object.keys(patch).length ? { ...state, items: { ...state.items, ...patch } } : state
}

export function setSetting<K extends keyof AppState['settings']>(
  state: AppState,
  key: K,
  value: AppState['settings'][K],
): AppState {
  return { ...state, settings: { ...state.settings, [key]: value } }
}
