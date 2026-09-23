import { useCallback, useState } from 'react'
import { ITEMS } from './data/units'
import {
  XP_FIRST_CORRECT,
  XP_RETRY_CORRECT,
  answerQuestion,
  answerWriting,
  learnNew,
} from './lib/actions'
import { ymd } from './lib/dates'
import type { Verdict } from './lib/score'
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
  /** 這一項是介紹卡不是題目 */
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

  /** 準備第 idx 項。累計值由呼叫端帶進來 */
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

      if (entry.kind === 'intro') {
        if (current.settings.sound) setTimeout(() => speakItem(entry.id, true), 250)
        return { ...base, q: null, intro: true }
      }
      // kind === 'write'（默寫）要到階段 3 才有畫布。在那之前 App 把
      // writePerDay 鎖在 0，排不出這種題目
      return { ...base, q: makeQuestion(entry.id, current), intro: false }
    },
    [],
  )

  /** 往下一項；沒有下一項就結算。介紹卡和作答完都走這裡 */
  const advance = useCallback(
    (r: RoundState, current: AppState) => {
      const idx = r.idx + 1
      if (idx < r.queue.length) {
        setRound(prepare(current, r.queue, idx, r.first, r.xp))
        return
      }
      const ids = Object.keys(r.first)
      setSummary({
        n: ids.length,
        c: ids.filter((id) => r.first[id]).length,
        xp: r.xp,
        streak: streak(current, ymd()),
      })
      setRound(null)
    },
    [prepare],
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

  /**
   * 介紹卡按「記住了」：建立進度，然後進下一項。
   *
   * 舊版是在同一個項目裡把介紹卡換成題目。分批之後兩者是獨立項目——
   * 先連續看完這一批的介紹卡，題目排在後面一起考。
   */
  const learn = useCallback(() => {
    if (!round?.intro) return
    const { id } = round.queue[round.idx]
    setState((s) => learnNew(s, id, ymd()))
    // makeQuestion 讀不到進度就當盒子 0，所以這裡用舊的 state 出題結果一樣
    advance(round, state)
  }, [advance, round, setState, state])

  const answer = useCallback(
    (choice: string) => {
      if (!round || round.answered || !round.q) return
      const q = round.q
      const entry = round.queue[round.idx]
      const ok = choice === q.answer
      const isFirst = !(q.id in round.first)
      const isRetry = entry.kind === 'quiz' && entry.retry === true

      setState((s) => answerQuestion(s, q.id, ok, isFirst, ymd()))
      speakItem(q.id, state.settings.sound)

      setRound({
        ...round,
        // 答錯就在回合尾巴再排一次，同一題不重複補考
        queue: !ok && !isRetry ? [...round.queue, { kind: 'quiz', id: q.id, retry: true }] : round.queue,
        first: isFirst ? { ...round.first, [q.id]: ok } : round.first,
        answered: true,
        picked: choice,
        xp: round.xp + (ok ? (isFirst ? XP_FIRST_CORRECT : XP_RETRY_CORRECT) : 0),
      })
    },
    [round, setState, state.settings.sound],
  )

  /**
   * 默寫題評完。
   *
   * 手寫沒有「補考」——重寫一次的成本比按一個選項高太多，硬塞會讓人不想寫。
   * 答錯就交給間隔複習明天再來。
   */
  const write = useCallback(
    (verdict: Verdict) => {
      if (!round || round.answered) return
      const { id } = round.queue[round.idx]
      const isFirst = !(id in round.first)

      setState((s) => answerWriting(s, id, verdict, isFirst, ymd()))

      setRound({
        ...round,
        first: isFirst ? { ...round.first, [id]: verdict !== 'bad' } : round.first,
        answered: true,
        xp: round.xp + (verdict === 'ok' ? XP_FIRST_CORRECT : 0),
      })
    },
    [round, setState],
  )

  const next = useCallback(() => {
    if (round) advance(round, state)
  }, [advance, round, state])

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

  return { round, summary, start, learn, answer, write, next, quit, replay, clearSummary }
}
