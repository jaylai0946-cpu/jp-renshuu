import { useState } from 'react'
import { BATCH_SIZE_CHOICES, NEW_PER_DAY_CHOICES, WRITE_PER_DAY_CHOICES } from '../constants'
import { ITEMS } from '../data/units'
import { addDays } from '../lib/dates'
import { importLegacy } from '../lib/legacyImport'
import { exportJSON, importJSON } from '../lib/storage'
import { practiced, streak } from '../lib/srs'
import type { AppState } from '../types'
import type { useSync } from '../useSync'
import { Hanko } from './Hanko'
import { SyncPanel } from './SyncPanel'

interface Props {
  state: AppState
  today: string
  sync: ReturnType<typeof useSync>
  onSetting: <K extends keyof AppState['settings']>(k: K, v: AppState['settings'][K]) => void
  onReplaceState: (next: AppState) => void
  onLogout: () => void
  onAbout: () => void
}

export function Stats({ state, today, sync, onSetting, onReplaceState, onLogout, onAbout }: Props) {
  const [paste, setPaste] = useState('')
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  let learned = 0
  let mastered = 0
  for (const id of Object.keys(state.items)) {
    if (!ITEMS[id]) continue
    learned++
    if (state.items[id].b >= 4) mastered++
  }
  let xp = 0
  let days = 0
  for (const h of Object.values(state.hist)) {
    xp += h.xp
    if (practiced(h)) days++
  }

  const start = addDays(today, -27)
  const calendar = Array.from({ length: 28 }, (_, i) => addDays(start, i))

  const CONFIRM = '匯入會蓋掉這台目前的進度（同步開著的話也會推到雲端）。確定要匯入嗎？'

  function accept(next: AppState, note: string) {
    if (!window.confirm(CONFIRM)) return
    onReplaceState(next)
    setPaste('')
    setMessage({ tone: 'ok', text: note })
  }

  function importOld() {
    const result = importLegacy(paste, today)
    if (!result.ok) return setMessage({ tone: 'bad', text: result.error })
    const skipped = result.dropped ? `，有 ${result.dropped} 個對不上題庫被跳過` : ''
    accept(result.state, `匯入了 ${result.matched} 個字${skipped}`)
  }

  function importBackup() {
    const result = importJSON(paste, today)
    if (!result.ok) return setMessage({ tone: 'bad', text: result.error })
    accept(result.state, '匯入完成')
  }

  async function copyExport() {
    const text = exportJSON(state)
    try {
      await navigator.clipboard.writeText(text)
      setMessage({ tone: 'ok', text: '進度已經複製到剪貼簿' })
    } catch {
      setPaste(text)
      setMessage({ tone: 'ok', text: '複製不了，已經填在下面的框裡，自己選起來複製' })
    }
  }

  return (
    <>
      <div className="bigstats">
        <Hanko glyph={String(streak(state, today))} caption="連續天數" />
        <dl>
          <dt>學過的字</dt>
          <dd>{learned}</dd>
          <dt>熟練的字</dt>
          <dd>{mastered}</dd>
          <dt>練習天數</dt>
          <dd>{days}</dd>
          <dt>總點數</dt>
          <dd>{xp}</dd>
        </dl>
      </div>

      <div className="sec">
        <h3>最近四週</h3>
        <div className="cal">
          {calendar.map((d) => {
            const on = practiced(state.hist[d])
            return (
              <div
                key={d}
                className={`${on ? 'on' : ''}${d === today ? ' today' : ''}`}
                title={d}
              >
                {on ? '済' : Number(d.slice(8))}
              </div>
            )
          })}
        </div>
      </div>

      <div className="sec">
        <h3>設定</h3>
        <div className="panel">
          <div className="set">
            <label htmlFor="npd">每天新學幾個</label>
            <select
              id="npd"
              value={state.settings.newPerDay}
              onChange={(e) => onSetting('newPerDay', Number(e.target.value))}
            >
              {NEW_PER_DAY_CHOICES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="set">
            <label htmlFor="batch">
              一次教幾個
              <br />
              <small className="muted">連續介紹這麼多個新字，再集中出這批的題目</small>
            </label>
            <select
              id="batch"
              value={state.settings.batchSize}
              onChange={(e) => onSetting('batchSize', Number(e.target.value))}
            >
              {BATCH_SIZE_CHOICES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="set">
            <span>單字題顯示羅馬拼音</span>
            <button
              type="button"
              className={`toggle${state.settings.romaji ? ' on' : ''}`}
              role="switch"
              aria-checked={state.settings.romaji}
              aria-label="單字題顯示羅馬拼音"
              onClick={() => onSetting('romaji', !state.settings.romaji)}
            />
          </div>
          <div className="set">
            <label htmlFor="wpd">
              每天幾題默寫
              <br />
              <small className="muted">辨識熟了的字才會出。0 是關掉</small>
            </label>
            <select
              id="wpd"
              value={state.settings.writePerDay}
              onChange={(e) => onSetting('writePerDay', Number(e.target.value))}
            >
              {WRITE_PER_DAY_CHOICES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="set">
            <span>
              只用 Apple Pencil 書寫
              <br />
              <small className="muted">開著時手掌碰到畫布不會畫出線。沒有筆就關掉</small>
            </span>
            <button
              type="button"
              className={`toggle${state.settings.penOnly ? ' on' : ''}`}
              role="switch"
              aria-checked={state.settings.penOnly}
              aria-label="只用 Apple Pencil 書寫"
              onClick={() => onSetting('penOnly', !state.settings.penOnly)}
            />
          </div>
          <div className="set">
            <span>答題後自動唸出來</span>
            <button
              type="button"
              className={`toggle${state.settings.sound ? ' on' : ''}`}
              role="switch"
              aria-checked={state.settings.sound}
              aria-label="答題後自動唸出來"
              onClick={() => onSetting('sound', !state.settings.sound)}
            />
          </div>
        </div>
      </div>

      <div className="sec">
        <h3>手機與電腦同步</h3>
        <SyncPanel sync={sync} />
      </div>

      <div className="sec">
        <h3>搬進度</h3>
        <div className="panel">
          <p className="muted small">
            從 claude.ai 的舊版搬過來：請那邊的 Claude 把 <code>&lt;script id="state"&gt;</code>{' '}
            裡的 JSON 給你，貼進下面再按「匯入舊版進度」。
          </p>
          <textarea
            rows={4}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder='貼上 { "v":1, "items": ... }'
            spellCheck={false}
            style={{ fontFamily: 'var(--ui)', fontSize: '0.85rem' }}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="ghost" onClick={importOld}>
              匯入舊版進度
            </button>
            <button type="button" className="ghost" onClick={importBackup}>
              匯入備份
            </button>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="ghost" onClick={() => void copyExport()}>
              匯出進度（複製）
            </button>
          </div>
          {message ? (
            <p className={`small ${message.tone === 'bad' ? 'err' : 'muted'}`}>{message.text}</p>
          ) : null}
        </div>
      </div>

      <div className="sec">
        <div className="row">
          <button type="button" className="ghost" onClick={onAbout}>
            關於這個 App
          </button>
          <button type="button" className="ghost" onClick={onLogout}>
            登出
          </button>
        </div>
      </div>
    </>
  )
}
