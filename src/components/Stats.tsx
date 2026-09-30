import { useState } from 'react'
import { BATCH_SIZE_CHOICES, NEW_PER_DAY_CHOICES, THEME_CHOICES, WRITE_PER_DAY_CHOICES } from '../constants'
import { ITEMS } from '../data/units'
import { addDays } from '../lib/dates'
import { importLegacy } from '../lib/legacyImport'
import { exportJSON, importJSON } from '../lib/storage'
import { practiced } from '../lib/srs'
import type { AppState } from '../types'
import type { useSync } from '../useSync'
import { SyncPanel } from './SyncPanel'
import { PageHead, StreakPill, XpPill } from './ui'

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']

interface Props {
  state: AppState
  today: string
  sync: ReturnType<typeof useSync>
  streak: number
  xp: number
  onSetting: <K extends keyof AppState['settings']>(k: K, v: AppState['settings'][K]) => void
  onReplaceState: (next: AppState) => void
  onLogout: () => void
  onAbout: () => void
}

export function Stats({ state, today, sync, streak, xp, onSetting, onReplaceState, onLogout, onAbout }: Props) {
  const [paste, setPaste] = useState('')
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  let learned = 0
  let mastered = 0
  for (const id of Object.keys(state.items)) {
    if (!ITEMS[id]) continue
    learned++
    if (state.items[id].b >= 4) mastered++
  }
  let days = 0
  for (const h of Object.values(state.hist)) {
    if (practiced(h)) days++
  }

  const start = addDays(today, -27)
  const calendar = Array.from({ length: 28 }, (_, i) => addDays(start, i))
  const startDow = new Date(`${start}T12:00:00`).getDay()
  const md = (day: string) => {
    const [, m, d] = day.split('-').map(Number)
    return { m, d }
  }
  const from = md(start)
  const to = md(today)
  const range = from.m === to.m ? `${from.m} 月 ${from.d} 日 – ${to.d} 日` : `${from.m}/${from.d} – ${to.m}/${to.d}`

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
      <PageHead
        title="紀錄"
        right={
          <div className="pills m-only">
            <StreakPill days={streak} />
            <XpPill xp={xp} />
          </div>
        }
      />

      <div className="record-grid">
        <div className="record-l stack">
          <div className="tiles4">
            <div className="stat t-red">
              <b>{learned}</b>
              <span>學過的字</span>
            </div>
            <div className="stat t-green">
              <b>{mastered}</b>
              <span>熟練的字</span>
            </div>
            <div className="stat t-blue">
              <b>{days}</b>
              <span>練習天數</span>
            </div>
            <div className="stat t-yellow">
              <b>{xp}</b>
              <span>總點數</span>
            </div>
          </div>

          <section className="card cal-card">
            <div className="cal-head">
              <h2>最近四週</h2>
              <span>{range}</span>
            </div>
            <div className="cal">
              {Array.from({ length: 7 }, (_, i) => (
                <span className="dow" key={i}>
                  {WEEKDAY[(startDow + i) % 7]}
                </span>
              ))}
              {calendar.map((d) => {
                const on = practiced(state.hist[d])
                return (
                  <div
                    key={d}
                    className={`day${on ? ' on' : ''}${d === today ? ' today' : ''}`}
                    title={d}
                  >
                    {on ? '済' : Number(d.slice(8))}
                  </div>
                )
              })}
            </div>
          </section>
        </div>

        <div className="record-r stack">
      <div>
        <h2 className="sec-title">設定</h2>
        <div className="card">
          <div className="set">
            <span>
              外觀
              <small>自動 = 跟著裝置的深色模式</small>
            </span>
            <div className="seg sm" role="group" aria-label="外觀">
              {THEME_CHOICES.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  aria-pressed={state.settings.theme === t.id}
                  onClick={() => onSetting('theme', t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
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
              <small>連續介紹這麼多個新字，再集中出這批的題目</small>
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
              <small>辨識熟了的字才會出。0 是關掉</small>
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
              <small>開著時手指和手掌碰到畫布不會畫出線，滑鼠照樣能寫。平板沒有筆就關掉</small>
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
            <span>
              答對時震動一下
              <small>iPhone 要 iOS 18 以上。iPad 沒有震動馬達</small>
            </span>
            <button
              type="button"
              className={`toggle${state.settings.haptics ? ' on' : ''}`}
              role="switch"
              aria-checked={state.settings.haptics}
              aria-label="答對時震動一下"
              onClick={() => onSetting('haptics', !state.settings.haptics)}
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

      <div>
        <h2 className="sec-title">手機與電腦同步</h2>
        <SyncPanel sync={sync} />
      </div>

      <div>
        <h2 className="sec-title">搬進度</h2>
        <div className="card">
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
          />
          <div className="row">
            <button type="button" className="btn" onClick={importOld}>
              匯入舊版進度
            </button>
            <button type="button" className="btn" onClick={importBackup}>
              匯入備份
            </button>
          </div>
          <div className="row">
            <button type="button" className="btn" onClick={() => void copyExport()}>
              匯出進度（複製）
            </button>
          </div>
          {message ? (
            <p className={`small ${message.tone === 'bad' ? 'err' : 'muted'}`}>{message.text}</p>
          ) : null}
        </div>
      </div>

      <div className="foot-links">
        <button type="button" className="link" onClick={onAbout}>
          關於這個 App
        </button>
        <button type="button" className="link danger" onClick={onLogout}>
          登出
        </button>
      </div>
        </div>
      </div>
    </>
  )
}
