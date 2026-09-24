import { useCallback, useEffect, useState } from 'react'
import { About } from './components/About'
import { Compose } from './components/Compose'
import { Handwriting } from './components/Handwriting'
import { Home } from './components/Home'
import { Login } from './components/Login'
import { Nav, type TabId } from './components/Nav'
import { Round } from './components/Round'
import { Stats } from './components/Stats'
import { Summary } from './components/Summary'
import { Units } from './components/Units'
import { SyncPanel } from './components/SyncPanel'
import { UNIT_BY_ID } from './data/units'
import { answerWriting, applyProgressPatch, recordGrade, setSetting } from './lib/actions'
import { ymd } from './lib/dates'
import { markKnownPatch } from './lib/srs'
import { generateKey, loadLocalOnly, parseSetupLink, saveLocalOnly } from './lib/sync'
import { syncStatusText } from './lib/syncStatus'
import { emptyState, loadState, saveState } from './lib/storage'
import { warmUpSpeech } from './lib/speech'
import type { AppState } from './types'
import { useRound } from './useRound'
import { useSync } from './useSync'

type View = TabId | 'about'

export default function App() {
  const [state, setState] = useState<AppState>(loadState)
  const [view, setView] = useState<View>('home')
  const [today, setToday] = useState(ymd)
  const [localOnly, setLocalOnly] = useState(loadLocalOnly)
  // 從連結進來的人不該先看到登入頁閃一下。effect 跑之前就先判斷好
  const [fromLink] = useState(() => parseSetupLink(window.location.hash) !== null)

  useEffect(() => saveState(state), [state])

  // 跨午夜還開著時，日期要跟著跳，不然「今天」會停在昨天
  useEffect(() => {
    const id = window.setInterval(() => setToday(ymd()), 60_000)
    function onVisible() {
      if (document.visibilityState === 'visible') setToday(ymd())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const applyRemote = useCallback((next: AppState) => setState(next), [])
  const sync = useSync(state, applyRemote)

  /*
   * 從 hash 讀設定連結。兩種：
   *   #sync=<網址>|<密鑰>  自己的另一台裝置，連上同一份進度
   *   #invite=<網址>       別人分享的，用同一台伺服器但產生自己的密鑰
   *
   * 讀完就把 hash 清掉，免得一重新整理又問一次，也不要留在歷史紀錄裡。
   */
  const enableSync = sync.enable
  const hasSync = sync.config !== null
  useEffect(() => {
    const setup = parseSetupLink(window.location.hash)
    if (!setup) return
    window.history.replaceState(null, '', window.location.pathname + window.location.search)

    if (setup.kind === 'sync') {
      if (
        window.confirm(
          `要把這台裝置連上同步嗎？\n\n伺服器：${setup.endpoint}\n\n` +
            '這台目前的進度會跟雲端對一次；兩邊都改過的話會問你要留哪一份。',
        )
      ) {
        enableSync(setup.endpoint, setup.key)
      }
      return
    }

    // 已經有自己的進度了就不要動它——重複點邀請連結不該把人重設
    if (hasSync) {
      window.alert('這台裝置已經在同步了，不用再設定一次。')
      return
    }
    if (
      window.confirm(
        `要開始使用嗎？\n\n伺服器：${setup.endpoint}\n\n` +
          '會幫你產生一組自己的密鑰，進度跟分享給你的人完全分開。',
      )
    ) {
      enableSync(setup.endpoint, generateKey())
    }
  }, [enableSync, hasSync])

  const round = useRound(state, setState)

  /**
   * 登出：同步設定和本機進度一起清掉。
   *
   * 只清設定不清進度的話，下一個人在同一台裝置登入會先看到上一個人的資料，
   * 而且那份資料會被當成「本機改動」推到他的帳號去。
   */
  const logout = useCallback(() => {
    if (
      !window.confirm(
        '登出會把這台裝置上的進度清掉（雲端那份留著，下次登入會拉回來）。\n\n確定要登出嗎？',
      )
    ) {
      return
    }
    void sync.disable(false)
    saveLocalOnly(false)
    setLocalOnly(false)
    setState(emptyState())
    setView('home')
  }, [sync])

  const go = useCallback(
    (tab: View) => {
      warmUpSpeech()
      round.clearSummary()
      setView(tab)
      window.scrollTo(0, 0)
    },
    [round],
  )

  function start(opt: Parameters<typeof round.start>[0]) {
    warmUpSpeech()
    round.start(opt)
  }

  function markKnown(unitId: string) {
    const unit = UNIT_BY_ID[unitId]
    if (!unit) return
    if (!window.confirm(`把「${unit.name}」還沒學的都標成已會？之後會以複習題出現。`)) return
    setState((s) => applyProgressPatch(s, markKnownPatch(s, unitId, ymd())))
  }

  // ---- 還沒登入也還沒選「只存這台」：先出登入頁 ----
  if (!sync.config && !localOnly && !fromLink) {
    return (
      <div className="wrap">
        <Login
          onLogin={(endpoint, key) => sync.enable(endpoint, key)}
          onSkip={() => {
            saveLocalOnly(true)
            setLocalOnly(true)
          }}
        />
      </div>
    )
  }

  // ---- 練習回合是全螢幕，沒有底部導覽 ----
  if (round.round) {
    return (
      <div className="wrap">
        <Round
          round={round.round}
          state={state}
          onLearn={round.learn}
          onAnswer={round.answer}
          onWrite={round.write}
          onNext={round.next}
          onQuit={round.quit}
          onSay={round.replay}
        />
      </div>
    )
  }

  if (round.summary) {
    return (
      <div className="wrap">
        <Summary
          summary={round.summary}
          syncText={syncStatusText(sync.status)}
          onHome={() => go('home')}
        />
      </div>
    )
  }

  return (
    <div className="wrap">
      <div className="top">
        <h1 className="title">日文練習本</h1>
        <span className="sync">{syncStatusText(sync.status)}</span>
      </div>

      {sync.status.kind === 'conflict' ? (
        <div className="sec">
          <SyncPanel sync={sync} state={state} />
        </div>
      ) : null}

      {view === 'home' ? (
        <Home
          state={state}
          today={today}
          onStart={() => start({ kind: 'daily' })}
          onExtra={() => start({ kind: 'extra' })}
          onRandom={() => start({ kind: 'random' })}
        />
      ) : null}

      {view === 'units' ? (
        <Units
          state={state}
          onPractice={(unitId) => start({ kind: 'unit', unitId })}
          onMarkKnown={markKnown}
        />
      ) : null}

      {view === 'write' ? (
        <Handwriting
          state={state}
          onSetting={(k, v) => setState((s) => setSetting(s, k, v))}
          onWrite={(id, verdict) =>
            setState((s) => {
              // 在手寫分頁自由練習也算數，但只有「還沒寫過或今天到期」的才動盒子，
              // 不然反覆寫同一個字會一路把盒子推到 6
              const p = s.write[id]
              const counts = !p || p.due <= ymd()
              return answerWriting(s, id, verdict, counts, ymd())
            })
          }
        />
      ) : null}

      {view === 'compose' ? (
        <Compose
          config={sync.config}
          onGraded={() => setState((s) => recordGrade(s, ymd()))}
        />
      ) : null}

      {view === 'stats' ? (
        <Stats
          state={state}
          today={today}
          sync={sync}
          onSetting={(k, v) => setState((s) => setSetting(s, k, v))}
          onReplaceState={(next) => setState(next)}
          onLogout={logout}
          onAbout={() => go('about')}
        />
      ) : null}

      {view === 'about' ? <About onBack={() => go('stats')} /> : null}

      <Nav view={view} onGo={go} />
    </div>
  )
}
