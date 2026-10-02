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
import { UNIT_BY_ID } from './data/units'
import { answerWriting, applyProgressPatch, recordGrade, setSetting } from './lib/actions'
import { ymd } from './lib/dates'
import { vibrate } from './lib/haptics'
import { markKnownPatch, nextNew, streak, todayCounts } from './lib/srs'
import { applyTheme } from './lib/theme'
import { Icon, StreakPill, SyncDot, XpPill } from './components/ui'
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

  // 外觀跟著設定走。同步帶進別台的設定也會在這裡生效
  const theme = state.settings.theme
  useEffect(() => applyTheme(theme), [theme])

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

  // 一回合練完就把進度推上去，不用等同步的 20 秒間隔——可能正要換另一台裝置
  const flushSync = sync.flush
  const finished = round.summary !== null
  useEffect(() => {
    if (finished) flushSync()
  }, [finished, flushSync])

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
      <Login
        onLogin={(endpoint, key) => sync.enable(endpoint, key)}
        onSkip={() => {
          saveLocalOnly(true)
          setLocalOnly(true)
        }}
      />
    )
  }

  // ---- 練習回合是專注模式，沒有導覽 ----
  if (round.round) {
    return (
      <Round
        round={round.round}
        state={state}
        onLearn={round.learn}
        onAnswer={round.answer}
        onWrite={round.write}
        onNext={round.next}
        onSkip={round.skip}
        onQuit={round.quit}
        onSay={round.replay}
      />
    )
  }

  if (round.summary) {
    return (
      <div className="focus">
        <Summary
          summary={round.summary}
          syncText={syncStatusText(sync.status)}
          onHome={() => go('home')}
        />
      </div>
    )
  }

  const syncText = syncStatusText(sync.status)
  const syncOk = sync.status.kind === 'idle' || sync.status.kind === 'merged'
  const days = streak(state, today)
  const xp = Object.values(state.hist).reduce((n, h) => n + h.xp, 0)
  const counts = todayCounts(state, today)

  /** 側邊欄的「開始練習」：今天有題就做今天的，做完了就多學幾個或隨機複習 */
  function startAny() {
    if (counts.questions > 0) start({ kind: 'daily' })
    else if (nextNew(state, 1).length > 0) start({ kind: 'extra' })
    else start({ kind: 'random' })
  }

  return (
    <div className="shell">
      <aside className="side">
        <div className="side-brand">
          <b>日文練習本</b>
          <SyncDot text={syncText} ok={syncOk} />
        </div>
        <Nav view={view} onGo={go} />
        <div className="side-foot">
          <div className="pills">
            <StreakPill days={days} suffix=" 天" />
            <XpPill xp={xp} />
          </div>
          <button type="button" className="btn btn-red block" onClick={startAny}>
            <Icon name="plus" />
            開始練習
          </button>
        </div>
      </aside>

      <main className="main">
        {view === 'home' ? (
          <Home
            state={state}
            today={today}
            streak={days}
            xp={xp}
            onStart={() => start({ kind: 'daily' })}
            onExtra={() => start({ kind: 'extra' })}
            onRandom={() => start({ kind: 'random' })}
            onPracticeUnit={(unitId) => start({ kind: 'unit', unitId })}
            onUnits={() => go('units')}
          />
        ) : null}

        {view === 'units' ? (
          <Units
            state={state}
            syncText={syncText}
            syncOk={syncOk}
            onPractice={(unitId) => start({ kind: 'unit', unitId })}
            onMarkKnown={markKnown}
          />
        ) : null}

        {view === 'write' ? (
          <Handwriting
            state={state}
            syncText={syncText}
            syncOk={syncOk}
            onSetting={(k, v) => setState((s) => setSetting(s, k, v))}
            onWrite={(id, verdict) => {
              setState((s) => {
                // 在手寫分頁自由練習也算數，但只有「還沒寫過或今天到期」的才動盒子，
                // 不然反覆寫同一個字會一路把盒子推到 6
                const p = s.write[id]
                const counts = !p || p.due <= ymd()
                return answerWriting(s, id, verdict, counts, ymd())
              })
              // 寫字是在畫布上放開筆，不是點 label，所以只有 Android 會震
              if (verdict === 'ok') vibrate(state.settings.haptics)
            }}
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
            streak={days}
            xp={xp}
            onSetting={(k, v) => setState((s) => setSetting(s, k, v))}
            onReplaceState={(next) => setState(next)}
            onLogout={logout}
            onAbout={() => go('about')}
          />
        ) : null}

        {view === 'about' ? <About onBack={() => go('stats')} /> : null}
      </main>
    </div>
  )
}
