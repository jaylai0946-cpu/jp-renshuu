import { useState } from 'react'
import { PROMPTS } from '../data/units'
import { GRADE_LABEL, grade, type GradeResult } from '../lib/grade'
import { speak } from '../lib/speech'
import type { SyncConfig } from '../lib/sync'
import { Hanko } from './Hanko'

interface Props {
  /** 沒開同步就沒有端點可以呼叫，批改用不了 */
  config: SyncConfig | null
  /** 批改成功時記一筆，紀錄頁的點數和連續天數才算得到 */
  onGraded: () => void
}

/** -1 代表「自己出題」 */
const CUSTOM = -1

export function Compose({ config, onGraded }: Props) {
  const [index, setIndex] = useState(0)
  const [custom, setCustom] = useState('')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<GradeResult | null>(null)
  const [error, setError] = useState('')
  const [quota, setQuota] = useState<{ used: number; limit: number } | null>(null)

  const question = index === CUSTOM ? custom.trim() : PROMPTS[index]

  if (!config) {
    return (
      <div className="panel">
        <b>造句批改</b>
        <p className="muted small">
          這裡會由 Claude 幫你批改寫的日文句子。要先到<strong>紀錄 → 手機與電腦同步</strong>
          啟用同步，並在 Worker 上設定 API key（README 有步驟）。
        </p>
      </div>
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
      <div className="chips">
        {PROMPTS.map((p, i) => (
          <button
            type="button"
            key={p}
            className={`chip${index === i ? ' on' : ''}`}
            onClick={() => pickPrompt(i)}
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          className={`chip${index === CUSTOM ? ' on' : ''}`}
          onClick={() => pickPrompt(CUSTOM)}
        >
          自己出題
        </button>
      </div>

      {index === CUSTOM ? (
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="打一句想翻成日文的中文"
          maxLength={200}
        />
      ) : (
        <div className="prompt">{PROMPTS[index]}</div>
      )}

      <textarea
        rows={3}
        lang="ja"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="用日文寫寫看（假名或羅馬拼音都可以）"
        maxLength={500}
      />

      <p>
        <button
          type="button"
          className="primary"
          onClick={() => void check()}
          disabled={loading || !question || !draft.trim()}
        >
          {loading ? '老師批改中…' : '批改'}
        </button>
      </p>

      {error ? <p className="err">{error}</p> : null}

      {result ? (
        <div className="panel result">
          <div className="rhead">
            <Hanko glyph={GRADE_LABEL[result.verdict].mark} />
            <b>{GRADE_LABEL[result.verdict].text}</b>
          </div>
          <div className="corr" lang="ja">
            {result.corrected}
          </div>
          <p>
            <button
              type="button"
              className="speak"
              // 明確按下的 🔊 一律發聲，不看「答題後自動唸出來」那個設定
              onClick={() => speak(result.reading || result.corrected, true)}
            >
              🔊 聽正確唸法
            </button>
          </p>
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
        </div>
      ) : null}

      {quota ? (
        <p className="muted small sec">
          今天用了 {quota.used} / {quota.limit} 次批改
        </p>
      ) : null}
    </>
  )
}
