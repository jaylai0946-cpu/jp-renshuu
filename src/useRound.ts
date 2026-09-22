import { useCallback, useState } from 'react'
import { ITEMS } from './data/units'
import { XP_FIRST_CORRECT, XP_RETRY_CORRECT, answerQuestion, learnNew } from './lib/actions'
import { ymd } from './lib/dates'
import { speak } from './lib/speech'
import {
  buildRound,
  makeQuestion,
  streak,
  type QueueEntry,
  type Question,
  type RoundOptions,
} from './lib/srs'
import type { AppState } from './types'

export interface RoundState {
  queue: QueueEntry[]
  idx: number
  /** 每個字「第一次作答」的結果。同一回合的補考不覆寫這裡 */
  first: Record<string, boolean>
  xp: number
  answered: boolean
  picked: string | null
  q: Question | null
  /** 這題是新字，先顯示介紹卡再出題 */
  intro: boolean
}

export interface RoundSummary {
  n: number
  c: number
  xp: number
  streak: number
}

function speakItem(id: string, enabled: boolean) {
  const it = ITEMS[id]
  if (!it) return
  speak(it.t === 'kana' ? it.ch : it.kana, enabled)
}

/**
 * 一回合練習的狀態。
 *
 * 每個 handler 都是獨立的使用者操作，中間一定會重新 render，所以直接讀
 * props 裡的 state 就好，不需要 ref。副作用（setState、發音）也都寫在
 * handler 裡而不是 setState 的 updater 裡——StrictMode 會把 updater 跑兩次，
 * 副作用寫在裡面會讓答一題變成記兩題。
 */
export function useRound(state: AppState, setState: (fn: (s: AppState) => AppState) => void) {
  const [round, setRound] = useState<RoundState | null>(null)
  const [summary, setSummary] = useState<RoundSummary | null>(null)

  /** 準備第 idx 題：新字先出介紹卡，其餘直接出題。累計值由呼叫端帶進來。 */
  const prepare = useCallback(
    (
      current: AppState,
      queue: QueueEntry[],
      idx: number,
      first: Record<string, boolean>,
      xp: number,
    ): RoundState => {
      const entry = queue[idx]
      const base = { queue, idx, first, xp, answered: false, picked: null }

      if (entry.isNew === true && !current.items[entry.id]) {
        if (current.settings.sound) setTimeout(() => speakItem(entry.id, true), 250)
        return { ...base, q: null, intro: true }
      }
      return { ...base, q: makeQuestion(entry.id, current), intro: false }
    },
    [],
  )

  const start = useCallback(
    (opt: RoundOptions): boolean => {
      const queue = buildRound(state, opt, ymd())
      if (!queue.length) return false
      setSummary(null)
      setRound(prepare(state, queue, 0, {}, 0))
      return true
    },
    [prepare, state],
  )

  const learn = useCallback(() => {
    if (!round || !round.intro) return
    const id = round.queue[round.idx].id
    setState((s) => learnNew(s, id, ymd()))
    // learnNew 建的是盒子 0，反向題要盒子 2 才出，所以用當下的 state 出題結果一樣
    setRound({ ...round, intro: false, q: makeQuestion(id, state) })
  }, [round, setState, state])

  const answer = useCallback(
    (choice: string) => {
      if (!round || round.answered || !round.q) return
      const q = round.q
      const entry = round.queue[round.idx]
      const ok = choice === q.answer
      const isFirst = !(q.id in round.first)

      setState((s) => answerQuestion(s, q.id, ok, isFirst, ymd()))
      speakItem(q.id, state.settings.sound)

      setRound({
        ...round,
        // 答錯就在回合尾巴再排一次，同一題不重複補考
        queue: !ok && !entry.retry ? [...round.queue, { id: q.id, retry: true }] : round.queue,
        first: isFirst ? { ...round.first, [q.id]: ok } : round.first,
        answered: true,
        picked: choice,
        xp: round.xp + (ok ? (isFirst ? XP_FIRST_CORRECT : XP_RETRY_CORRECT) : 0),
      })
    },
    [round, setState, state.settings.sound],
  )

  const next = useCallback(() => {
    if (!round) return
    const idx = round.idx + 1
    if (idx < round.queue.length) {
      setRound(prepare(state, round.queue, idx, round.first, round.xp))
      return
    }
    const ids = Object.keys(round.first)
    setSummary({
      n: ids.length,
      c: ids.filter((id) => round.first[id]).length,
      xp: round.xp,
      streak: streak(state, ymd()),
    })
    setRound(null)
  }, [prepare, round, state])

  const quit = useCallback(() => {
    if (!round) return
    const answered = Object.keys(round.first).length > 0
    if (answered && !window.confirm('先結束這回合嗎？已經答過的題目會保留。')) return
    setRound(null)
  }, [round])

  const replay = useCallback(() => {
    if (round) speakItem(round.queue[round.idx].id, true)
  }, [round])

  const clearSummary = useCallback(() => setSummary(null), [])

  return { round, summary, start, learn, answer, next, quit, replay, clearSummary }
}
