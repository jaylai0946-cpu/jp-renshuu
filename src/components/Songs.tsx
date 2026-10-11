import { useState } from 'react'
import { vibrate } from '../lib/haptics'
import {
  MIN_QUIZ_WORDS,
  SONG_MAX_CHARS,
  SONG_MAX_LINES,
  analyzeSong,
  buildSongQuiz,
  newSongId,
  parseYouTubeId,
  songWords,
  uniqueLineCount,
  wordKey,
  type SongQuestion,
} from '../lib/songs'
import { speak } from '../lib/speech'
import type { SyncConfig } from '../lib/sync'
import { SONG_LIMITS, validSong } from '../lib/validate'
import type { AppState, Song } from '../types'
import { Icon, PageHead } from './ui'

interface Props {
  state: AppState
  /** 沒開同步就沒有 Worker 可以分析歌詞 */
  config: SyncConfig | null
  onAdd: (song: Song) => void
  onRemove: (id: string) => void
  onToggleWord: (id: string, key: string) => void
  /** 練習答了一題 */
  onAnswer: (ok: boolean) => void
}

type Mode = { kind: 'list' } | { kind: 'add' } | { kind: 'song'; id: string } | { kind: 'quiz'; id: string }

export function Songs({ state, config, onAdd, onRemove, onToggleWord, onAnswer }: Props) {
  const [mode, setMode] = useState<Mode>({ kind: 'list' })
  const songs = state.songs.filter((s) => !s.deleted)
  const current = mode.kind === 'song' || mode.kind === 'quiz' ? songs.find((s) => s.id === mode.id) : undefined

  function go(next: Mode) {
    setMode(next)
    window.scrollTo(0, 0)
  }

  if (mode.kind === 'add') {
    return (
      <AddSong
        config={config}
        full={songs.length >= SONG_LIMITS.songs}
        onCancel={() => go({ kind: 'list' })}
        onDone={(song) => {
          onAdd(song)
          go({ kind: 'song', id: song.id })
        }}
      />
    )
  }

  if (mode.kind === 'quiz' && current) {
    return (
      <SongQuiz
        song={current}
        haptics={state.settings.haptics}
        onAnswer={onAnswer}
        onExit={() => go({ kind: 'song', id: current.id })}
      />
    )
  }

  if (mode.kind === 'song' && current) {
    return (
      <SongView
        song={current}
        romaji={state.settings.romaji}
        onBack={() => go({ kind: 'list' })}
        onQuiz={() => go({ kind: 'quiz', id: current.id })}
        onToggleWord={(key) => onToggleWord(current.id, key)}
        onRemove={() => {
          if (!window.confirm(`刪掉「${current.title}」？分析結果和標成會了的詞都會一起刪掉。`)) return
          onRemove(current.id)
          go({ kind: 'list' })
        }}
      />
    )
  }

  return (
    <>
      <PageHead
        title="歌曲"
        right={
          <button type="button" className="btn btn-sm btn-red" onClick={() => go({ kind: 'add' })}>
            <Icon name="plus" size={16} />
            新增
          </button>
        }
      />
      <p className="phead-sub">貼上喜歡的日文歌詞，拆成讀音、翻譯和單字，再用歌詞練習。</p>

      {songs.length === 0 ? (
        <div className="card">
          <h2>還沒有歌</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            按「新增」貼一首日文歌的歌詞，App 會逐句標讀音、翻成中文、挑出值得學的單字。
          </p>
          <button type="button" className="btn btn-red block" onClick={() => go({ kind: 'add' })}>
            <Icon name="plus" />
            新增第一首歌
          </button>
        </div>
      ) : (
        <div className="songlist">
          {songs.map((s) => {
            const words = songWords(s)
            const known = words.filter((w) => s.known.includes(wordKey(w.word))).length
            return (
              <button type="button" key={s.id} className="songcard" onClick={() => go({ kind: 'song', id: s.id })}>
                <span className="tile tile-md" style={{ background: 'var(--purple)' }} aria-hidden="true">
                  歌
                </span>
                <span className="songcard-body">
                  <b>{s.title}</b>
                  <span className="muted small">
                    {s.artist ? `${s.artist}・` : ''}
                    {s.lines.length} 句・會了 {known} / {words.length} 個詞
                  </span>
                </span>
                <Icon name="right" size={20} />
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}

// ---- 新增 ----

function AddSong({
  config,
  full,
  onCancel,
  onDone,
}: {
  config: SyncConfig | null
  full: boolean
  onCancel: () => void
  onDone: (song: Song) => void
}) {
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [video, setVideo] = useState('')
  const [lyrics, setLyrics] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const lines = uniqueLineCount(lyrics)
  const videoId = parseYouTubeId(video)
  const tooLong = lines > SONG_MAX_LINES || lyrics.length > SONG_MAX_CHARS

  async function submit() {
    if (!config || busy) return
    if (!title.trim() || !lines) return setError('歌名和歌詞都要填')
    if (tooLong) return setError(`太長了：不同的句子最多 ${SONG_MAX_LINES} 句、全部最多 ${SONG_MAX_CHARS} 字`)
    if (video.trim() && !videoId) return setError('看不懂這個 YouTube 連結，可以留空')
    setError('')
    setBusy(true)
    const res = await analyzeSong(config, { title: title.trim(), artist: artist.trim(), lyrics })
    setBusy(false)
    if (res.status === 'error') return setError(res.message)
    const song = validSong({
      id: newSongId(),
      title: res.title,
      artist: res.artist,
      video: videoId,
      lines: res.lines,
      known: [],
      updated: new Date().toISOString(),
    })
    if (!song) return setError('分析結果讀不懂，再試一次')
    onDone(song)
  }

  return (
    <>
      <PageHead title="新增一首歌" />
      {!config ? (
        <div className="card">
          <h2>要先開同步</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            歌詞分析由 Claude 處理，要先到<strong>紀錄 → 手機與電腦同步</strong>啟用同步。
          </p>
          <button type="button" className="btn block" onClick={onCancel}>
            回歌曲列表
          </button>
        </div>
      ) : full ? (
        <div className="card">
          <h2>歌已經滿了</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            最多 {SONG_LIMITS.songs} 首。先刪掉一首不再練的歌，再新增。
          </p>
          <button type="button" className="btn block" onClick={onCancel}>
            回歌曲列表
          </button>
        </div>
      ) : (
        <form
          className="card songform"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label htmlFor="song-title">歌名</label>
          <input id="song-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} />

          <label htmlFor="song-artist">歌手（選填）</label>
          <input id="song-artist" type="text" value={artist} onChange={(e) => setArtist(e.target.value)} maxLength={100} />

          <label htmlFor="song-video">YouTube 連結（選填，貼了可以邊聽邊看）</label>
          <input
            id="song-video"
            type="url"
            value={video}
            onChange={(e) => setVideo(e.target.value)}
            placeholder="https://youtu.be/…"
            autoComplete="off"
          />

          <label htmlFor="song-lyrics">日文歌詞（一句一行）</label>
          <textarea
            id="song-lyrics"
            lang="ja"
            rows={10}
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            placeholder="從歌詞網站複製整首貼上"
          />
          <p className={`small ${tooLong ? 'err' : 'muted'}`} style={{ margin: 0 }}>
            {lines} / {SONG_MAX_LINES} 句（重複的副歌只算一次）
          </p>

          <p className="muted small" style={{ margin: 0 }}>
            歌詞只存在你自己的帳號裡，不會分享給別人。分析一首大約 30–60 秒，每天最多 3 首。
          </p>

          {error ? <p className="err">{error}</p> : null}

          <div className="row">
            <button type="button" className="btn" onClick={onCancel} disabled={busy}>
              取消
            </button>
            <button type="submit" className="btn btn-red" disabled={busy || !title.trim() || !lines || tooLong}>
              {busy ? '分析中…' : '分析歌詞'}
            </button>
          </div>
          {busy ? <p className="muted small center">正在逐句分析，大約要 30–60 秒，先不要關掉這頁。</p> : null}
        </form>
      )}
    </>
  )
}

// ---- 逐句看 ----

function SongView({
  song,
  romaji,
  onBack,
  onQuiz,
  onToggleWord,
  onRemove,
}: {
  song: Song
  romaji: boolean
  onBack: () => void
  onQuiz: () => void
  onToggleWord: (key: string) => void
  onRemove: () => void
}) {
  const [showKana, setShowKana] = useState(true)
  const [showZh, setShowZh] = useState(true)
  const [showRo, setShowRo] = useState(romaji)
  const [open, setOpen] = useState<Set<number>>(() => new Set())
  const known = new Set(song.known)
  const canQuiz = songWords(song).length >= MIN_QUIZ_WORDS

  function toggleLine(i: number) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  return (
    <div className="songview">
      <button type="button" className="link" onClick={onBack} style={{ alignSelf: 'flex-start', paddingLeft: 0 }}>
        ‹ 全部歌曲
      </button>
      <PageHead title={song.title} kicker={song.artist || undefined} />
      {song.artist ? <p className="phead-sub m-only">{song.artist}</p> : null}

      {song.video ? (
        <div className="video">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${song.video}`}
            title={`${song.title} 的影片`}
            allow="encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : null}

      <div className="row">
        <button type="button" className="btn btn-red" onClick={onQuiz} disabled={!canQuiz}>
          練習這首歌
        </button>
      </div>
      {!canQuiz ? <p className="muted small">這首歌的單字太少，出不了題。</p> : null}

      <div className="chips" role="group" aria-label="顯示">
        <button type="button" className={`chip${showKana ? ' on ink' : ''}`} aria-pressed={showKana} onClick={() => setShowKana((v) => !v)}>
          讀音
        </button>
        <button type="button" className={`chip${showZh ? ' on ink' : ''}`} aria-pressed={showZh} onClick={() => setShowZh((v) => !v)}>
          中文
        </button>
        <button type="button" className={`chip${showRo ? ' on ink' : ''}`} aria-pressed={showRo} onClick={() => setShowRo((v) => !v)}>
          羅馬拼音
        </button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        點一句看單字；點單字標成「會了」，練習時會少出。把中文關掉可以先自己猜意思。
      </p>

      <ol className="lyrics">
        {song.lines.map((line, i) => {
          const expanded = open.has(i)
          return (
            <li key={i} className={`lyric${expanded ? ' open' : ''}`}>
              <div className="lyric-main">
                <button
                  type="button"
                  className="lyric-text"
                  aria-expanded={expanded}
                  onClick={() => toggleLine(i)}
                >
                  <span className="jp" lang="ja">
                    {line.jp}
                  </span>
                  {showKana && line.kana && line.kana !== line.jp ? (
                    <span className="kana" lang="ja">
                      {line.kana}
                    </span>
                  ) : null}
                  {showRo && line.ro ? <span className="ro">{line.ro}</span> : null}
                  {showZh && line.zh ? <span className="zh">{line.zh}</span> : null}
                </button>
                <button
                  type="button"
                  className="speak plain"
                  aria-label={`唸「${line.jp}」`}
                  onClick={() => speak(line.jp, true)}
                >
                  <Icon name="speaker" />
                </button>
              </div>
              {expanded ? (
                <div className="lyric-more">
                  {line.words.length ? (
                    <div className="wordchips">
                      {line.words.map((w, j) => {
                        const key = wordKey(w)
                        const isKnown = known.has(key)
                        return (
                          <button
                            type="button"
                            key={j}
                            className={`wordchip${isKnown ? ' known' : ''}`}
                            aria-pressed={isKnown}
                            onClick={() => onToggleWord(key)}
                          >
                            <span className="w" lang="ja">
                              {w.s}
                            </span>
                            {w.k && w.k !== w.s ? (
                              <span className="k" lang="ja">
                                {w.k}
                              </span>
                            ) : null}
                            {w.b ? (
                              <span className="k" lang="ja">
                                原形 {w.b}
                              </span>
                            ) : null}
                            <span className="m">{w.zh}</span>
                            {isKnown ? <span className="ok">✓ 會了</span> : null}
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="muted small">這句沒有挑出要學的詞。</p>
                  )}
                  {line.note ? <p className="note">{line.note}</p> : null}
                </div>
              ) : null}
            </li>
          )
        })}
      </ol>

      <div className="foot-links">
        <button type="button" className="link danger" onClick={onRemove}>
          刪掉這首歌
        </button>
      </div>
    </div>
  )
}

// ---- 練習 ----

function SongQuiz({
  song,
  haptics,
  onAnswer,
  onExit,
}: {
  song: Song
  haptics: boolean
  onAnswer: (ok: boolean) => void
  onExit: () => void
}) {
  const [questions, setQuestions] = useState<SongQuestion[]>(() => buildSongQuiz(song))
  const [idx, setIdx] = useState(0)
  const [picked, setPicked] = useState<string | null>(null)
  const [right, setRight] = useState(0)

  const q = questions[idx]
  const done = idx >= questions.length

  function answer(choice: string) {
    if (picked !== null || !q) return
    const ok = choice === q.answer
    setPicked(choice)
    if (ok) {
      setRight((n) => n + 1)
      vibrate(haptics)
    }
    onAnswer(ok)
  }

  function next() {
    setPicked(null)
    setIdx((i) => i + 1)
  }

  function again() {
    setQuestions(buildSongQuiz(song))
    setIdx(0)
    setPicked(null)
    setRight(0)
  }

  const pct = questions.length ? (idx / questions.length) * 100 : 0

  return (
    <div className="songquiz">
      <div className="rtop">
        <button type="button" className="x" onClick={onExit} aria-label="結束練習">
          <Icon name="close" size={20} />
        </button>
        <div className="prog" role="progressbar" aria-valuenow={idx} aria-valuemin={0} aria-valuemax={questions.length}>
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>

      {done ? (
        <div className="sum">
          <div className="stat t-green" style={{ width: '100%' }}>
            <b>
              {right} / {questions.length}
            </b>
            <span>「{song.title}」答對</span>
          </div>
          <div className="row" style={{ width: '100%' }}>
            <button type="button" className="btn" onClick={onExit}>
              回到歌詞
            </button>
            <button type="button" className="btn btn-red" onClick={again}>
              再練一次
            </button>
          </div>
        </div>
      ) : q ? (
        <>
          <div className="qbody">
            <span className="badge badge-blue">
              {song.title}・第 {idx + 1} / {questions.length} 題
            </span>
            {q.kind === 'meaning' ? (
              <>
                <h1 className="ask">這個詞是什麼意思？</h1>
                <div className="wordbox">
                  <div className="w" lang="ja">
                    {q.word.s}
                  </div>
                  {q.word.k && q.word.k !== q.word.s ? (
                    <div className="r" lang="ja">
                      {q.word.k}
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <h1 className="ask">空格裡是哪個詞？</h1>
                <div className="wordbox blankline" lang="ja">
                  <div className="w">
                    {q.before}
                    <span className="blank" aria-label="空格">
                      {picked !== null ? q.answer : '＿＿'}
                    </span>
                    {q.after}
                  </div>
                </div>
              </>
            )}
            <button type="button" className="speak" onClick={() => speak(q.kind === 'blank' ? q.line : q.word.s, true)}>
              <Icon name="speaker" />
              聽發音
            </button>
          </div>

          <div className="choices">
            {q.choices.map((c) => {
              let mark = ''
              if (picked !== null) {
                if (c === q.answer) mark = ' right'
                else if (c === picked) mark = ' wrong'
                else mark = ' dim'
              }
              return (
                <button
                  type="button"
                  key={c}
                  className={`choice ${q.kind === 'blank' ? 'word' : 'zhc'}${mark}`}
                  lang={q.kind === 'blank' ? 'ja' : undefined}
                  disabled={picked !== null}
                  onClick={() => answer(c)}
                >
                  {c}
                </button>
              )
            })}
          </div>

          {picked !== null ? (
            <>
              <div className="feedback-spacer" />
              <div className={`feedback ${picked === q.answer ? 'good' : 'bad'}`} role="status">
                <div className="in">
                  <div className="fb-head">
                    <div className="fb-text">
                      <span className="verdict">{picked === q.answer ? '答對了！' : '差一點！'}</span>
                      <span className="detail">
                        <span>
                          <span className="jp" lang="ja">
                            {q.word.s}
                          </span>
                          {q.word.k && q.word.k !== q.word.s ? `（${q.word.k}）` : ''} = {q.word.zh}
                        </span>
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`btn ${picked === q.answer ? 'btn-green' : 'btn-red'}`}
                    onClick={next}
                  >
                    繼續
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </>
      ) : (
        <p className="muted">這首歌的單字太少，出不了題。</p>
      )}
    </div>
  )
}
