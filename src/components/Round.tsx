import { useEffect } from 'react'
import { ITEMS, UNIT_BY_ID } from '../data/units'
import type { RoundState } from '../useRound'
import type { AppState, WordItem } from '../types'
import { HAPTIC_SWITCH_ID } from '../lib/haptics'
import type { Verdict } from '../lib/score'
import { Cells } from './Cells'
import { HapticSwitch } from './HapticSwitch'
import { Icon } from './ui'
import { WritingPad } from './WritingPad'

interface Props {
  round: RoundState
  state: AppState
  onLearn: () => void
  onAnswer: (choice: string) => void
  onWrite: (verdict: Verdict) => void
  onNext: () => void
  onSkip: () => void
  onQuit: () => void
  onSay: () => void
}

const ASK: Record<string, string> = {
  kana2ro: '這個怎麼唸？',
  ro2kana: '哪一個是這個音？',
  jp2zh: '這是什麼意思？',
  zh2jp: '日文怎麼說？',
}

/** 焦點在輸入框或按鈕上時，按鍵交給瀏覽器——不然 Enter 會觸發兩次 */
function ownsKey(e: KeyboardEvent): boolean {
  const t = e.target
  if (!(t instanceof Element)) return false
  if (t.closest('input, textarea, select, [contenteditable="true"]')) return true
  return (e.key === 'Enter' || e.key === ' ') && t.closest('button, a') !== null
}

/**
 * 練習回合（專注模式，沒有導覽）。
 *
 * 電腦版鍵盤：1–4 選答案、空白鍵播放發音、S 跳過、Enter 繼續。
 */
export function Round({ round, state, onLearn, onAnswer, onWrite, onNext, onSkip, onQuit, onSay }: Props) {
  const entry = round.queue[round.idx]
  const item = ITEMS[entry.id]
  const pct = (round.idx / round.queue.length) * 100
  const q = round.q

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || ownsKey(e)) return
      const key = e.key.toLowerCase()
      if (key === ' ') {
        e.preventDefault()
        onSay()
        return
      }
      if (round.intro) {
        if (key === 'enter') onLearn()
        return
      }
      if (round.answered) {
        if (key === 'enter') onNext()
        return
      }
      if (key === 's') {
        onSkip()
        return
      }
      if (q && /^[1-4]$/.test(key)) {
        const choice = q.choices[Number(key) - 1]
        if (choice !== undefined) onAnswer(choice)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [round, q, onAnswer, onLearn, onNext, onSay, onSkip])

  const unitName = UNIT_BY_ID[item.u]?.name ?? ''

  const top = (
    <div className="rtop">
      <button type="button" className="x" onClick={onQuit} aria-label="結束這回合">
        <Icon name="close" size={20} />
      </button>
      <div
        className="prog"
        role="progressbar"
        aria-valuenow={round.idx}
        aria-valuemin={0}
        aria-valuemax={round.queue.length}
      >
        <i style={{ width: `${pct}%` }} />
      </div>
      <span className="rcount">
        {round.idx} / {round.queue.length}
      </span>
      {round.combo > 0 ? (
        <span className="pill pill-orange" aria-label={`連對 ${round.combo} 題`}>
          <Icon name="flame" />
          {round.combo}
        </span>
      ) : null}
    </div>
  )

  const badge = (
    <span className="badge badge-blue">
      {unitName}・第 {round.idx + 1} / {round.queue.length} 題
    </span>
  )

  const skip = round.answered ? null : (
    <button type="button" className="link skip" onClick={onSkip} aria-label="跳過這題">
      跳過這題<span className="d-only">（S）</span>
    </button>
  )

  const speakBtn = (label: string) => (
    <button type="button" className="speak" onClick={onSay}>
      <Icon name="speaker" />
      {label}
      <span className="kbd" aria-hidden="true">
        空白鍵
      </span>
    </button>
  )

  // ---- 新字介紹卡 ----
  if (round.intro) {
    return (
      <div className="focus">
        {top}
        <div className="intro">
          <span className="newlab" lang="ja">
            新しい字
          </span>
          {item.t === 'kana' ? (
            <>
              <Cells text={item.ch} />
              <div className="romaji">{item.ro}</div>
            </>
          ) : (
            <>
              <div className="wordbox">
                <div className="w" lang="ja">
                  {item.jp}
                </div>
                {item.jp !== item.kana ? (
                  <div className="r" lang="ja">
                    {item.kana}
                  </div>
                ) : null}
                <div className="ro">{item.ro}</div>
              </div>
              <div className="zh">{item.zh}</div>
            </>
          )}
          {speakBtn('再聽一次')}
          <button type="button" className="btn btn-red block intro-cta" onClick={onLearn}>
            記住了，出題吧
          </button>
        </div>
      </div>
    )
  }

  // ---- 默寫題 ----
  if (entry.kind === 'write') {
    const text = item.t === 'kana' ? item.ch : item.kana
    return (
      <div className="focus">
        {top}
        <div className="qbody">
          {badge}
          <h1 className="ask">
            憑記憶寫出來
            {item.t === 'kana' ? <span className="tag">默寫</span> : null}
          </h1>
          <div className="romaji">{item.ro}</div>
          <div className="padstack">
            <WritingPad key={entry.id} text={text} mode="blind" penOnly={state.settings.penOnly} onJudged={onWrite} />
          </div>
          {skip}
        </div>
        {round.answered ? (
          <>
            <div className="feedback-spacer" />
            <div className="feedback" role="status">
              <div className="in">
                <button type="button" className="btn btn-ink" onClick={onNext} aria-label="繼續">
                  繼續<span className="d-only">　Enter ↵</span>
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    )
  }

  if (!q) return <div className="focus">{top}</div>

  const retry = entry.kind === 'quiz' && entry.retry
  const choiceClass =
    q.mode === 'ro2kana' ? ' kana' : q.mode === 'zh2jp' ? ' word' : q.mode === 'jp2zh' ? ' zhc' : ''
  const ok = round.picked === q.answer

  return (
    <div className="focus">
      {state.settings.haptics ? <HapticSwitch /> : null}
      {top}

      <div className="qbody">
        {badge}
        <h1 className="ask">
          {ASK[q.mode]}
          {retry ? <span className="tag">再一次</span> : null}
        </h1>

        {q.mode === 'kana2ro' && item.t === 'kana' ? <Cells text={item.ch} /> : null}
        {q.mode === 'ro2kana' && item.t === 'kana' ? <div className="romaji">{item.ro}</div> : null}
        {q.mode === 'jp2zh' && item.t === 'word' ? (
          <div className="wordbox">
            <div className="w" lang="ja">
              {item.jp}
            </div>
            {item.jp !== item.kana ? (
              <div className="r" lang="ja">
                {item.kana}
              </div>
            ) : null}
            {state.settings.romaji ? <div className="ro">{item.ro}</div> : null}
          </div>
        ) : null}
        {q.mode === 'zh2jp' && item.t === 'word' ? (
          <div className="wordbox zh">
            <div className="w">{item.zh}</div>
          </div>
        ) : null}

        {q.mode === 'kana2ro' || q.mode === 'jp2zh' ? speakBtn('聽發音') : null}
      </div>

      <div className="choices">
        {q.choices.map((c, i) => {
          let mark = ''
          if (round.answered) {
            if (c === q.answer) mark = ' right'
            else if (c === round.picked) mark = ' wrong'
            else mark = ' dim'
          }
          // 中文→日文時，漢字底下補上讀音，不然看不出唸法
          const word =
            q.mode === 'zh2jp'
              ? (UNIT_BY_ID[item.u].items as WordItem[]).find((x) => x.jp === c)
              : undefined
          // iPhone 的震動只能由使用者真的點到開關的 label 觸發，所以只在正確答案上蓋一層。
          // 點錯的選項沒有這層，自然不會震。
          // 答完之後不拆掉，只讓它點不到：label 的「切換開關」發生在 click 事件跑完之後，
          // 如果 onAnswer 觸發的重繪先把 label 拆了，開關就不會切、也就不會震
          const haptic = state.settings.haptics && c === q.answer
          return (
            <div className="choicewrap" key={c}>
              <button
                type="button"
                className={`choice${choiceClass}${mark}`}
                lang={choiceClass === ' kana' || choiceClass === ' word' ? 'ja' : undefined}
                disabled={round.answered}
                onClick={() => onAnswer(c)}
              >
                <span className="key" aria-hidden="true">
                  {i + 1}
                </span>
                {c}
                {word && word.jp !== word.kana ? <small>{word.kana}</small> : null}
              </button>
              {haptic ? (
                <label
                  className={`haptic-hit${round.answered ? ' off' : ''}`}
                  htmlFor={HAPTIC_SWITCH_ID}
                  aria-hidden="true"
                  data-testid="haptic-hit"
                  onClick={() => onAnswer(c)}
                />
              ) : null}
            </div>
          )
        })}
      </div>
      {skip}

      {round.answered ? (
        <>
          <div className="feedback-spacer" />
          <div className={`feedback ${ok ? 'good' : 'bad'}`} role="status">
            <div className="in">
              <div className="fb-head">
                {ok ? (
                  <span className="fb-mark" aria-hidden="true">
                    <Icon name="check" size={24} />
                  </span>
                ) : null}
                <div className="fb-text">
                  <span className="verdict">{ok ? '答對了！' : '差一點！'}</span>
                  <span className="detail">
                    {ok ? null : (
                      <span>
                        正確答案是 {q.answer}
                        {retry ? '' : '，這題稍後會再出'}
                      </span>
                    )}
                    {item.t === 'kana' ? (
                      <span>
                        <span className="jp" lang="ja">
                          {item.ch}
                        </span>{' '}
                        = {item.ro}
                      </span>
                    ) : (
                      <span>
                        <span className="jp" lang="ja">
                          {item.jp}
                        </span>
                        {item.jp !== item.kana ? (
                          <span lang="ja">（{item.kana}）</span>
                        ) : null}{' '}
                        = {item.zh}
                        {state.settings.romaji ? `・${item.ro}` : ''}
                      </span>
                    )}
                    {ok && round.gained > 0 ? <span>・+{round.gained} 點</span> : null}
                    <button type="button" className="speak plain" onClick={onSay} aria-label="聽發音">
                      <Icon name="speaker" />
                    </button>
                  </span>
                </div>
              </div>
              <button
                type="button"
                className={`btn ${ok ? 'btn-green' : 'btn-red'}`}
                onClick={onNext}
                aria-label={ok ? '繼續' : '知道了'}
              >
                {ok ? '繼續' : '知道了'}
                <span className="d-only">　Enter ↵</span>
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
