import type { RoundSummary } from '../useRound'

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
      <div className="stamp press" aria-label={`練習完成，連續 ${summary.streak} 天`}>
        <b lang="ja">済</b>
        <span>連續 {summary.streak} 天</span>
      </div>
      <div className="nums">
        <div className="stat t-green">
          <b>
            {summary.c} / {summary.n}
          </b>
          <span>第一次就答對</span>
        </div>
        <div className="stat t-blue">
          <b>{acc}%</b>
          <span>正確率</span>
        </div>
        <div className="stat t-yellow">
          <b>+{summary.xp}</b>
          <span>點數</span>
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {syncText}
      </p>
      <button type="button" className="btn btn-red block" onClick={onHome}>
        回首頁
      </button>
    </div>
  )
}
