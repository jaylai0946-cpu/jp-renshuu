import type { AppState, Progress, Song } from '../types'
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
    /*
     * 還沒到期的字（隨機複習、單元練習會出）答對不升級。
     *
     * 不然剛學的字當天多複習一次就跳一格：間隔被拉長、還提早被排進默寫題，
     * 「今天的份做完了」又冒出新的題目。答錯照樣降級——額外練習抓到不熟的字，
     * 就該讓它早點回來。
     */
    const notDueYet = before.due > today
    if (!(ok && notDueYet)) {
      next = { ...next, items: { ...next.items, [id]: schedule(before, ok, today) } }
    }
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

// ---- 歌曲 ----

/** 新增一首分析好的歌，放在最前面 */
export function addSong(state: AppState, song: Song): AppState {
  return { ...state, songs: [song, ...state.songs.filter((s) => s.id !== song.id)] }
}

/** 刪掉一首歌。留下墓碑，另一台同步時才知道它被刪了，不會又加回來 */
export function removeSong(state: AppState, id: string, now: string): AppState {
  return {
    ...state,
    songs: state.songs.map((s) =>
      s.id === id
        ? { id, title: '', artist: '', video: '', lines: [], known: [], updated: now, deleted: true as const }
        : s,
    ),
  }
}

/**
 * 把一個詞標成「會了」或取消。
 *
 * 不動 updated：合併時 known 本來就兩邊聯集，updated 只拿來決定歌詞分析留哪一份。
 * 要是在還沒同步到新分析的裝置上點個單字就把時間往後推，舊的（漏句的）分析會蓋回新的。
 */
export function toggleSongWord(state: AppState, id: string, key: string): AppState {
  return {
    ...state,
    songs: state.songs.map((s) => {
      if (s.id !== id || s.deleted) return s
      const known = s.known.includes(key) ? s.known.filter((k) => k !== key) : [...s.known, key]
      return { ...s, known }
    }),
  }
}

/** 歌曲練習答了一題。不排間隔複習，但算進今天的答題數、點數和連續天數 */
export function recordSongAnswer(state: AppState, ok: boolean, today: string): AppState {
  return bumpHist(state, today, { n: 1, c: ok ? 1 : 0, xp: ok ? XP_FIRST_CORRECT : 0 })
}
