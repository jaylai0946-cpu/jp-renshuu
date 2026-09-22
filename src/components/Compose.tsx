import { PROMPTS } from '../data/units'

/**
 * 造句批改。真正呼叫 Claude API 的部分在階段 4（Worker 的 /grade 端點），
 * 這一版先把畫面和題目留著，按鈕會說明還沒開通。
 */
export function Compose({ hasGrader }: { hasGrader: boolean }) {
  return (
    <>
      <div className="chips">
        {PROMPTS.map((p) => (
          <span className="chip" key={p}>
            {p}
          </span>
        ))}
      </div>
      <div className="panel">
        <b>造句批改</b>
        <p className="muted small">
          {hasGrader
            ? '批改功能還在接線中。'
            : '這裡會由 Claude 幫你批改寫的日文句子。要先架好同步伺服器並部署 /grade 端點（階段 4），詳細步驟在 README。'}
        </p>
      </div>
    </>
  )
}
