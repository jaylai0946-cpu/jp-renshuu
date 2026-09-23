import { useCallback, useEffect, useState } from 'react'
import { About } from './components/About'
import { Compose } from './components/Compose'
import { Handwriting } from './components/Handwriting'
import { Home } from './components/Home'
import { Nav, type TabId } from './components/Nav'
import { Round } from './components/Round'
import { Stats } from './components/Stats'
import { Summary } from './components/Summary'
import { Units } from './components/Units'
import { SyncPanel } from './components/SyncPanel'
import { UNIT_BY_ID } from './data/units'
import { applyProgressPatch, setSetting } from './lib/actions'
import { ymd } from './lib/dates'
import { markKnownPatch } from './lib/srs'
import { parseSetupLink } from './lib/sync'
import { syncStatusText } from './lib/syncStatus'
import { loadState, saveState } from './lib/storage'
import { warmUpSpeech } from './lib/speech'
import type { AppState } from './types'
import { useRound } from './useRound'
import { useSync } from './useSync'

/** 手寫畫布要到階段 2 才有；在那之前不要排默寫題，不然會出一題沒有畫面的題目。 */
const HANDWRITING_ENABLED = false

type View = TabId | 'about'

export default function App() {
  const [state, setState] = useState<AppState>(loadState)
  const [view, setView] = useState<View>('home')
  const [today, setToday] = useState(ymd)

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

  // 從另一台傳過來的設定連結（#sync=<網址>|<密鑰>）。
  // 讀完就把 hash 清掉，免得一重新整理又問一次，也不要留在歷史紀錄裡。
  const enableSync = sync.enable
  useEffect(() => {
    const setup = parseSetupLink(window.location.hash)
    if (!setup) return
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    if (
      window.confirm(
        `要把這台裝置連上同步嗎？\n\n伺服器：${setup.endpoint}\n\n` +
          '這台目前的進度會跟雲端對一次；兩邊都改過的話會問你要留哪一份。',
      )
    ) {
      // 不切分頁：啟用之後標題右邊的同步狀態馬上就會動，看得到
      enableSync(setup.endpoint, setup.key)
    }
  }, [enableSync])

  // 階段 2 之前把默寫題關掉，其他邏輯照常
  const roundState: AppState = HANDWRITING_ENABLED
    ? state
    : { ...state, settings: { ...state.settings, writePerDay: 0 } }

  const round = useRound(roundState, setState)

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

  // ---- 練習回合是全螢幕，沒有底部導覽 ----
  if (round.round) {
    return (
      <div className="wrap">
        <Round
          round={round.round}
          state={state}
          onLearn={round.learn}
          onAnswer={round.answer}
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
          state={roundState}
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
        <Handwriting state={state} onSetting={(k, v) => setState((s) => setSetting(s, k, v))} />
      ) : null}

      {view === 'compose' ? <Compose hasGrader={false} /> : null}

      {view === 'stats' ? (
        <Stats
          state={state}
          today={today}
          sync={sync}
          onSetting={(k, v) => setState((s) => setSetting(s, k, v))}
          onReplaceState={(next) => setState(next)}
          onAbout={() => go('about')}
        />
      ) : null}

      {view === 'about' ? <About onBack={() => go('stats')} /> : null}

      <Nav view={view} onGo={go} />
    </div>
  )
}
