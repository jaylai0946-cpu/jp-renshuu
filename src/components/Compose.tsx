import { useState } from 'react'
import { PROMPTS } from '../data/units'
import { GRADE_LABEL, grade, type GradeResult } from '../lib/grade'
import { speak } from '../lib/speech'
import type { SyncConfig } from '../lib/sync'
import { Icon, PageHead } from './ui'

interface Props {
  /** 沒開同步就沒有端點可以呼叫，批改用不了 */
  config: SyncConfig | null
  /** 批改成功時記一筆，紀錄頁的點數和連續天數才算得到 */
  onGraded: () => void
}

/** -1 代表「自己出題」 */
const CUSTOM = -1

const RESULT_CLASS = { correct: 'ok', minor: 'minor', wrong: 'wrong' } as const

export function Compose({ config, onGraded }: Props) {
  const [index, setIndex] = useState(0)
  const [custom, setCustom] = useState('')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<GradeResult | null>(null)
  const [error, setError] = useState('')
  const [quota, setQuota] = useState<{ used: number; limit: number } | null>(null)

  const question = index === CUSTOM ? custom.trim() : PROMPTS[index]

  const head = (
    <PageHead
      title="造句"
      right={
        quota ? (
          <span className="pill pill-plain">
            今天還能批改 <b>{Math.max(0, quota.limit - quota.used)}</b> 次
          </span>
        ) : null
      }
    />
  )

  if (!config) {
    return (
      <>
        {head}
        <div className="card">
          <h2>造句批改</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            這裡會由 Claude 幫你批改寫的日文句子。要先到<strong>紀錄 → 手機與電腦同步</strong>
            啟用同步，並在 Worker 上設定 API key（README 有步驟）。
          </p>
        </div>
      </>
    )
  }

  async function check() {
    if (!config || !question || !draft.trim() || loading) return
    setLoading(true)
    setResult(null)
    setError('')

    const response = await grade(config, question, draft.trim())
    setLoading(false)

    if (response.status === 'error') {
      setError(response.message)
      return
    }
    setResult(response.result)
    setQuota({ used: response.used, limit: response.limit })
    onGraded()
  }

  function pickPrompt(next: number) {
    setIndex(next)
    setResult(null)
    setError('')
  }

  return (
    <>
      {head}

      <div className="compose-grid">
        {/* 手機：橫向膠囊列 */}
        <div className="chips" role="group" aria-label="題目">
          {PROMPTS.map((p, i) => (
            <button
              type="button"
              key={p}
              className={`chip${index === i ? ' on blue' : ''}`}
              aria-pressed={index === i}
              onClick={() => pickPrompt(i)}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            className={`chip${index === CUSTOM ? ' on blue' : ''}`}
            aria-pressed={index === CUSTOM}
            onClick={() => pickPrompt(CUSTOM)}
          >
            ＋ 自己出題
          </button>
        </div>

        {/* 電腦：左邊的題目清單 */}
        <nav className="card flat plist" aria-label="題目清單">
          <span className="lab">題目</span>
          {PROMPTS.map((p, i) => (
            <button type="button" key={p} aria-pressed={index === i} onClick={() => pickPrompt(i)}>
              {p}
            </button>
          ))}
          <button
            type="button"
            className="add"
            aria-pressed={index === CUSTOM}
            onClick={() => pickPrompt(CUSTOM)}
          >
            ＋ 自己出題
          </button>
        </nav>

        <div className="compose-main">
          <section className="qcard">
            <span className="badge">翻成日文</span>
            {index === CUSTOM ? (
              <input
                type="text"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="打一句想翻成日文的中文"
                aria-label="自己出的題目"
                maxLength={200}
              />
            ) : (
              <div className="prompt">{PROMPTS[index]}</div>
            )}

            <label htmlFor="compose-answer">你的答案（假名或羅馬拼音都可以）</label>
            <textarea
              id="compose-answer"
              rows={3}
              lang="ja"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  void check()
                }
              }}
              placeholder="用日文寫寫看"
              maxLength={500}
            />

            <div className="qcard-foot">
              <span className="shortcut">⌘ / Ctrl + Enter 送出</span>
              <button
                type="button"
                className="btn btn-red"
                onClick={() => void check()}
                disabled={loading || !question || !draft.trim()}
              >
                {loading ? '老師批改中…' : '批改'}
              </button>
            </div>
          </section>

          {error ? <p className="err">{error}</p> : null}

          {result ? (
            <section className={`result ${RESULT_CLASS[result.verdict]}`} aria-label="批改結果">
              <div className="rhead">
                <span className="lab">
                  批改結果・{GRADE_LABEL[result.verdict].mark}
                </span>
                <span className="badge">{GRADE_LABEL[result.verdict].text}</span>
              </div>
              <div className="corr" lang="ja">
                {result.corrected}
              </div>
              <button
                type="button"
                className="speak"
                // 明確按下的「聽正確唸法」一律發聲，不看「答題後自動唸出來」那個設定
                onClick={() => speak(result.reading || result.corrected, true)}
              >
                <Icon name="speaker" />
                聽正確唸法
              </button>
              <dl>
                {result.reading ? (
                  <>
                    <dt>讀音</dt>
                    <dd className="jp" lang="ja">
                      {result.reading}
                    </dd>
                  </>
                ) : null}
                {result.romaji ? (
                  <>
                    <dt>羅馬拼音</dt>
                    <dd>{result.romaji}</dd>
                  </>
                ) : null}
                {result.explain ? (
                  <>
                    <dt>說明</dt>
                    <dd>{result.explain}</dd>
                  </>
                ) : null}
                {result.tip ? (
                  <>
                    <dt>小提醒</dt>
                    <dd>{result.tip}</dd>
                  </>
                ) : null}
              </dl>
            </section>
          ) : null}
        </div>
      </div>
    </>
  )
}
