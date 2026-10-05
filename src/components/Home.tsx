import { UNITS } from '../data/units'
import { addDays } from '../lib/dates'
import { currentUnit, emptyHist, nextNew, practiced, todayCounts } from '../lib/srs'
import type { AppState, Unit } from '../types'
import { unitColor, unitGlyph } from '../lib/unitStyle'
import { Bar, Icon, PageHead, StreakPill, Tile, XpPill } from './ui'

interface Props {
  state: AppState
  today: string
  streak: number
  xp: number
  onStart: () => void
  onExtra: () => void
  onRandom: () => void
  onPracticeUnit: (unitId: string) => void
  onUnits: () => void
}

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']

/** 用中午算星期幾，免得時區把日期推到前一天 */
function weekday(day: string): number {
  return new Date(`${day}T12:00:00`).getDay()
}

function seenIn(state: AppState, unit: Unit): number {
  return unit.items.filter((it) => state.items[it.id]).length
}

/** 完成度的圓環：底圈淡黃，完成的部分綠色 */
function Ring({ done, total }: { done: number; total: number }) {
  const C = 2 * Math.PI * 32
  const frac = total > 0 ? Math.min(1, done / total) : 0
  return (
    <div className="ring" role="img" aria-label={`今天 ${done} / ${total} 題`}>
      <svg viewBox="0 0 96 96" aria-hidden="true">
        <circle cx="48" cy="48" r="38" style={{ fill: 'var(--surface)', stroke: 'var(--edge)' }} strokeWidth="2" />
        <circle cx="48" cy="48" r="32" fill="none" style={{ stroke: 'var(--tint-yellow)' }} strokeWidth="10" />
        {frac > 0 ? (
          <circle
            cx="48"
            cy="48"
            r="32"
            fill="none"
            stroke="#188A48"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${C * frac} ${C}`}
            transform="rotate(-90 48 48)"
          />
        ) : null}
      </svg>
      <div className="ring-num">
        <b>{done}</b>
        <span>/ {total} 題</span>
      </div>
    </div>
  )
}

export function Home({ state, today, streak, xp, onStart, onExtra, onRandom, onPracticeUnit, onUnits }: Props) {
  const counts = todayCounts(state, today)
  const h = state.hist[today] ?? emptyHist()
  const unit = currentUnit(state)
  const learnedAny = Object.keys(state.items).length > 0
  const hasNew = nextNew(state, 1).length > 0
  const pending = counts.questions > 0
  const nextUnit = unit ? UNITS[UNITS.indexOf(unit) + 1] : undefined

  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))
  const [, m, d] = today.split('-').map(Number)

  // 正在學的卡：下一個還沒學的字
  const nextItem = unit?.items.find((it) => !state.items[it.id])
  const nextGlyph = nextItem ? (nextItem.t === 'kana' ? nextItem.ch : [...nextItem.jp][0]) : ''

  return (
    <>
      <PageHead
        kicker={`${m} 月 ${d} 日・星期${WEEKDAY[weekday(today)]}`}
        title={
          <>
            <span className="m-only">日文練習本</span>
            <span className="d-only">今天</span>
          </>
        }
        right={
          <div className="pills m-only">
            <StreakPill days={streak} />
            <XpPill xp={xp} />
          </div>
        }
      />

      <div className="today-grid">
        <section className="hero">
          <div className="hero-top">
            <Ring done={h.n} total={h.n + counts.questions} />
            <div className="hero-text">
              {pending ? (
                <>
                  <span className="badge">今日目標</span>
                  <h2>今天有 {counts.questions} 題</h2>
                  <p>
                    {counts.fresh > 0 ? `先教 ${counts.fresh} 個新字，` : ''}
                    複習 {counts.review} 題
                    {counts.write > 0 ? `，默寫 ${counts.write} 題` : ''}
                  </p>
                </>
              ) : (
                <>
                  <span className="badge">每日目標達成</span>
                  <h2>今天的份做完了</h2>
                  <p>
                    答了 {h.n} 題，拿到 <b>{h.xp} 點</b>
                    <span className="d-only">。想多練可以再學新的或隨機複習。</span>
                  </p>
                </>
              )}
            </div>
          </div>
          <div className="week" aria-label="本週打卡">
            {week.map((day) => {
              const on = practiced(state.hist[day])
              return (
                <div key={day} className={day === today ? 'today' : ''}>
                  {WEEKDAY[weekday(day)]}
                  <i className={on ? 'on' : ''} aria-label={on ? `${day} 有練習` : undefined}>
                    {on ? <Icon name="check" size={16} /> : null}
                  </i>
                </div>
              )
            })}
          </div>
        </section>

        <div className="today-side">
          {pending ? (
            <>
              <button type="button" className="btn btn-red block" onClick={onStart}>
                開始今日練習
              </button>
              {/* 今天還有題目時也留著：想多複習幾次的人不該找不到入口 */}
              {learnedAny ? (
                <button type="button" className="btn block" onClick={onRandom}>
                  <Icon name="shuffle" />
                  隨機複習 10 題
                </button>
              ) : null}
            </>
          ) : (
            <div className="actions">
              {hasNew ? (
                <button type="button" className="btn btn-red" onClick={onExtra}>
                  <Icon name="plus" />
                  再學 5 個新的
                </button>
              ) : null}
              {learnedAny ? (
                <button type="button" className="btn" onClick={onRandom}>
                  <Icon name="shuffle" />
                  隨機複習 10 題
                </button>
              ) : null}
            </div>
          )}

          {unit ? (
            <>
              <h2 className="sec-title" style={{ margin: '6px 0 0' }}>
                正在學
              </h2>
              <button type="button" className="learning" onClick={() => onPracticeUnit(unit.id)}>
                <Tile glyph={nextGlyph || unitGlyph(unit)} color={unitColor(unit)} size="lg" />
                <div className="learning-body">
                  <div className="learning-head">
                    <span>{unit.name}</span>
                    <span className="num">
                      {seenIn(state, unit)} / {unit.items.length}
                    </span>
                  </div>
                  <Bar parts={[{ pct: (seenIn(state, unit) / unit.items.length) * 100, color: unitColor(unit) }]} />
                </div>
                <Icon name="right" size={22} />
              </button>
              {nextUnit ? (
                <div className="nextstop">
                  <span className="g" lang="ja" aria-hidden="true">
                    {unitGlyph(nextUnit)}
                  </span>
                  <div>
                    <span>下一站</span>
                    <b>{nextUnit.name}</b>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {!learnedAny ? (
            <p className="firsttime">
              第一次用：從平假名開始。已經會五十音的話，到「單元」按「我已經會了」跳過。
            </p>
          ) : null}
        </div>
      </div>

      <section className="allunits">
        <div className="sec-head">
          <h2>全部單元</h2>
          <button type="button" className="link danger" onClick={onUnits}>
            看全部 →
          </button>
        </div>
        <div className="minis">
          {UNITS.map((u) => {
            const seen = seenIn(state, u)
            return (
              <button type="button" key={u.id} className="mini" onClick={onUnits}>
                <span className="mini-head">
                  <Tile glyph={unitGlyph(u)} color={unitColor(u)} size="sm" />
                  <span>{u.name}</span>
                </span>
                <span className="mini-foot">
                  <Bar thin parts={[{ pct: (seen / u.items.length) * 100, color: unitColor(u) }]} />
                  {seen} / {u.items.length}
                </span>
              </button>
            )
          })}
        </div>
      </section>
    </>
  )
}
