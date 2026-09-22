import type { RoundSummary } from '../useRound'
import { Hanko } from './Hanko'

export function Summary({
  summary,
  syncText,
  onHome,
}: {
  summary: RoundSummary
  syncText: string
  onHome: () => void
}) {
  const acc = summary.n ? Math.round((summary.c / summary.n) * 100) : 0
  return (
    <div className="sum">
      <Hanko glyph="済" caption={`連續 ${summary.streak} 天`} big press />
      <div className="nums">
        <div>
          <b>
            {summary.c} / {summary.n}
          </b>
          <span className="muted small">第一次就答對</span>
        </div>
        <div>
          <b>{acc}%</b>
          <span className="muted small">正確率</span>
        </div>
        <div>
          <b>+{summary.xp}</b>
          <span className="muted small">點數</span>
        </div>
      </div>
      <p className="muted small">{syncText}</p>
      <button type="button" className="primary" onClick={onHome}>
        回首頁
      </button>
    </div>
  )
}
