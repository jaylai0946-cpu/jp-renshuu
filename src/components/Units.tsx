import { UNITS } from '../data/units'
import type { AppState } from '../types'

interface Props {
  state: AppState
  onPractice: (unitId: string) => void
  onMarkKnown: (unitId: string) => void
}

export function Units({ state, onPractice, onMarkKnown }: Props) {
  return (
    <>
      {UNITS.map((u) => {
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

        return (
          <div className="unit" key={u.id}>
            <div className="head">
              <h4>{u.name}</h4>
              <span className="muted small">
                {seen} / {total}
              </span>
            </div>
            <div className="sample" lang="ja">
              {sample}
            </div>
            <div
              className="bar"
              role="img"
              aria-label={`熟練 ${mastered}，學過 ${seen}，共 ${total}`}
            >
              <i className="m" style={{ width: `${(mastered / total) * 100}%` }} />
              <i className="s" style={{ width: `${((seen - mastered) / total) * 100}%` }} />
            </div>
            <div className="row">
              <button type="button" className="ghost" onClick={() => onPractice(u.id)}>
                練習這個單元
              </button>
              {seen < total ? (
                <button type="button" className="ghost" onClick={() => onMarkKnown(u.id)}>
                  我已經會了
                </button>
              ) : null}
            </div>
          </div>
        )
      })}
      <p className="muted small">綠色是已經熟練（連續答對好幾天）的字。</p>
    </>
  )
}
