import { ITEMS, UNIT_BY_ID } from '../data/units'
import type { RoundState } from '../useRound'
import type { AppState, WordItem } from '../types'
import type { Verdict } from '../lib/score'
import { Cells } from './Cells'
import { WritingPad } from './WritingPad'

interface Props {
  round: RoundState
  state: AppState
  onLearn: () => void
  onAnswer: (choice: string) => void
  onWrite: (verdict: Verdict) => void
  onNext: () => void
  onQuit: () => void
  onSay: () => void
}

const ASK: Record<string, string> = {
  kana2ro: '這個怎麼唸？',
  ro2kana: '哪一個是這個音？',
  jp2zh: '這是什麼意思？',
  zh2jp: '日文怎麼說？',
}

export function Round({ round, state, onLearn, onAnswer, onWrite, onNext, onQuit, onSay }: Props) {
  const entry = round.queue[round.idx]
  const item = ITEMS[entry.id]
  const pct = (round.idx / round.queue.length) * 100

  const top = (
    <div className="rtop">
      <button type="button" className="x" onClick={onQuit} aria-label="結束這回合">
        ×
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
    </div>
  )

  // ---- 新字介紹卡 ----
  if (round.intro) {
    return (
      <>
        {top}
        <div className="intro">
          <div className="newlab" lang="ja">
            新しい字
          </div>
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
          <p>
            <button type="button" className="speak" onClick={onSay}>
              🔊 再聽一次
            </button>
          </p>
        </div>
        <div className="feedback">
          <div className="in">
            <button type="button" className="primary" onClick={onLearn}>
              記住了，出題吧
            </button>
          </div>
        </div>
      </>
    )
  }

  // ---- 默寫題 ----
  if (entry.kind === 'write') {
    const text = item.t === 'kana' ? item.ch : item.kana
    return (
      <>
        {top}
        <p className="ask">
          憑記憶寫出來
          {item.t === 'kana' ? <span className="tag">默寫</span> : null}
        </p>
        <div className="romaji">{item.ro}</div>
        <WritingPad
          key={entry.id}
          text={text}
          mode="blind"
          penOnly={state.settings.penOnly}
          onJudged={onWrite}
        />
        {round.answered ? (
          <>
            <div className="feedback-spacer" />
            <div className="feedback" role="status">
              <div className="in">
                <button type="button" className="primary" onClick={onNext}>
                  繼續
                </button>
              </div>
            </div>
          </>
        ) : null}
      </>
    )
  }

  const q = round.q
  if (!q) return top

  const tag = entry.kind === 'quiz' && entry.retry ? <span className="tag">再一次</span> : null
  const choiceClass = q.mode === 'ro2kana' ? ' kana' : q.mode === 'zh2jp' ? ' word' : ''
  const ok = round.picked === q.answer

  return (
    <>
      {top}
      <p className="ask">
        {ASK[q.mode]}
        {tag}
      </p>

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

      {q.mode === 'kana2ro' || q.mode === 'jp2zh' ? (
        <p className="center">
          <button type="button" className="speak" onClick={onSay}>
            🔊 聽發音
          </button>
        </p>
      ) : null}

      <div className="choices">
        {q.choices.map((c) => {
          let mark = ''
          if (round.answered) {
            if (c === q.answer) mark = ' right'
            else if (c === round.picked) mark = ' wrong'
          }
          // 中文→日文時，漢字底下補上讀音，不然看不出唸法
          const word =
            q.mode === 'zh2jp'
              ? (UNIT_BY_ID[item.u].items as WordItem[]).find((x) => x.jp === c)
              : undefined
          return (
            <button
              type="button"
              key={c}
              className={`choice${choiceClass}${mark}`}
              lang={choiceClass ? 'ja' : undefined}
              disabled={round.answered}
              onClick={() => onAnswer(c)}
            >
              {c}
              {word && word.jp !== word.kana ? <small>{word.kana}</small> : null}
            </button>
          )
        })}
      </div>

      {round.answered ? (
        <>
          <div className="feedback-spacer" />
          <div className={`feedback ${ok ? 'good' : 'bad'}`} role="status">
            <div className="in">
              <div className="verdict">{ok ? '答對了' : `正確答案是：${q.answer}`}</div>
              <div className="detail">
                {item.t === 'kana' ? (
                  <>
                    <span className="jp" lang="ja">
                      {item.ch}
                    </span>
                    <span>{item.ro}</span>
                  </>
                ) : (
                  <>
                    <span className="jp" lang="ja">
                      {item.jp}
                    </span>
                    {item.jp !== item.kana ? (
                      <span className="muted jp" lang="ja">
                        {item.kana}
                      </span>
                    ) : null}
                    <span>{item.zh}</span>
                    {state.settings.romaji ? <span className="muted small">{item.ro}</span> : null}
                  </>
                )}
                <button type="button" className="speak" onClick={onSay} aria-label="聽發音">
                  🔊
                </button>
              </div>
              <button type="button" className="primary" onClick={onNext}>
                繼續
              </button>
            </div>
          </div>
        </>
      ) : null}
    </>
  )
}
