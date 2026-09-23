import { currentUnit, nextNew, streak, todayCounts } from '../lib/srs'
import { emptyHist } from '../lib/srs'
import type { AppState } from '../types'
import { Hanko } from './Hanko'

interface Props {
  state: AppState
  today: string
  onStart: () => void
  onExtra: () => void
  onRandom: () => void
}

export function Home({ state, today, onStart, onExtra, onRandom }: Props) {
  const counts = todayCounts(state, today)
  const days = streak(state, today)
  const h = state.hist[today] ?? emptyHist()
  const unit = currentUnit(state)
  const learnedAny = Object.keys(state.items).length > 0
  const hasNew = nextNew(state, 1).length > 0

  return (
    <>
      <div className="today">
        <Hanko glyph={String(days)} caption="連續天數" label={`連續 ${days} 天`} />
        <div>
          {counts.questions > 0 ? (
            <>
              <h2>今天有 {counts.questions} 題</h2>
              <p className="muted small">
                {counts.fresh > 0 ? `先教 ${counts.fresh} 個新字，` : ''}
                複習 {counts.review} 題
                {counts.write > 0 ? `，默寫 ${counts.write} 題` : ''}
              </p>
            </>
          ) : (
            <>
              <h2>今天的份做完了</h2>
              <p className="muted small">
                今天答了 {h.n} 題，拿到 {h.xp} 點
              </p>
            </>
          )}
        </div>
      </div>

      {counts.questions > 0 ? (
        <button type="button" className="primary" onClick={onStart}>
          開始今日練習
        </button>
      ) : (
        <div className="row">
          {hasNew ? (
            <button type="button" className="ghost" onClick={onExtra}>
              再學 5 個新的
            </button>
          ) : null}
          {learnedAny ? (
            <button type="button" className="ghost" onClick={onRandom}>
              隨機複習 10 題
            </button>
          ) : null}
        </div>
      )}

      {unit ? (
        <div className="sec">
          <h3>正在學</h3>
          <div className="panel next">
            <span className="jp" lang="ja">
              {(() => {
                const nx = unit.items.find((it) => !state.items[it.id])
                if (!nx) return ''
                return nx.t === 'kana' ? nx.ch : nx.kana.slice(0, 2)
              })()}
            </span>
            <div>
              <b>{unit.name}</b>
              <div className="muted small">
                已學 {unit.items.filter((it) => state.items[it.id]).length} / {unit.items.length}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {!learnedAny ? (
        <p className="muted small sec">
          第一次用：從平假名開始。已經會五十音的話，到「單元」按「我已經會了」跳過。
        </p>
      ) : null}
    </>
  )
}
