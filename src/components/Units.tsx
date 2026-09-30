import { useState } from 'react'
import { UNITS } from '../data/units'
import { currentUnit } from '../lib/srs'
import type { AppState, Unit } from '../types'
import { unitColor, unitGlyph } from '../lib/unitStyle'
import { Bar, PageHead, SyncDot, Tile } from './ui'

interface Props {
  state: AppState
  syncText: string
  syncOk: boolean
  onPractice: (unitId: string) => void
  onMarkKnown: (unitId: string) => void
}

type Filter = 'all' | 'hira' | 'kata' | 'word'

const FILTERS: { id: Filter; label: string; match: (u: Unit) => boolean }[] = [
  { id: 'all', label: '全部', match: () => true },
  { id: 'hira', label: '平假名', match: (u) => u.id.startsWith('h') },
  { id: 'kata', label: '片假名', match: (u) => u.id.startsWith('k') },
  { id: 'word', label: '生活單字', match: (u) => u.kind === 'word' },
]

export function Units({ state, syncText, syncOk, onPractice, onMarkKnown }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const current = currentUnit(state)
  const learned = Object.keys(state.items).length
  const shown = UNITS.filter(FILTERS.find((f) => f.id === filter)!.match)

  return (
    <>
      <PageHead
        kicker={`${UNITS.length} 個單元・已學 ${learned} 字`}
        title="單元"
        right={
          <>
            <span className="m-only">
              <SyncDot text={syncText} ok={syncOk} />
            </span>
            <span className="legend small d-only">綠色 = 熟練（連續答對好幾天）</span>
          </>
        }
      />
      <p className="phead-sub m-only">
        {UNITS.length} 個單元・已學 {learned} 字・<span className="legend">綠色 = 熟練</span>
      </p>

      <div className="chips" role="group" aria-label="篩選單元">
        {FILTERS.map((f) => (
          <button
            type="button"
            key={f.id}
            className={`chip${filter === f.id ? ' on ink' : ''}`}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            {f.id === 'all' ? ` ${UNITS.length}` : ''}
          </button>
        ))}
      </div>

      <div className="units">
        {shown.map((u) => {
          const total = u.items.length
          let seen = 0
          let mastered = 0
          for (const it of u.items) {
            const p = state.items[it.id]
            if (!p) continue
            seen++
            if (p.b >= 4) mastered++
          }
          const sample = u.items
            .slice(0, 8)
            .map((it) => (it.t === 'kana' ? it.ch : it.jp))
            .join(u.kind === 'kana' ? ' ' : '、')
          const color = unitColor(u)
          const isCurrent = current?.id === u.id

          return (
            <article className={`unit${isCurrent ? ' current' : ''}`} key={u.id}>
              <div className="unit-head">
                <Tile glyph={unitGlyph(u)} color={color} size="md" />
                <div className="unit-title">
                  <h2>
                    <span className="no">{UNITS.indexOf(u) + 1}</span>
                    {u.name}
                    {isCurrent ? <span className="badge badge-yellow">進行中</span> : null}
                  </h2>
                  <div className="sample" lang="ja">
                    {sample}
                  </div>
                </div>
              </div>
              <div className="unit-bar">
                <Bar
                  label={`熟練 ${mastered}，學過 ${seen}，共 ${total}`}
                  parts={[
                    { pct: (mastered / total) * 100, color: 'var(--green)' },
                    { pct: ((seen - mastered) / total) * 100, color },
                  ]}
                />
                <span>
                  {seen} / {total}
                </span>
              </div>
              <div className="row">
                <button type="button" className="btn btn-ink" onClick={() => onPractice(u.id)}>
                  練習這個單元
                </button>
                {seen < total ? (
                  <button type="button" className="btn btn-soft" onClick={() => onMarkKnown(u.id)}>
                    我已經會了
                  </button>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>
    </>
  )
}
