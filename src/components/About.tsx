export function About({ onBack }: { onBack: () => void }) {
  return (
    <>
      <div className="sec">
        <h3>這是什麼</h3>
        <div className="panel">
          <p className="small">
            銘傳國企一甲「日文一（上）」的練習本。假名與單字用間隔複習排程，
            之後會加上 Apple Pencil 手寫練習和造句批改。
          </p>
          <p className="muted small">
            版本 {__BUILD_ID__}（{__BUILD_TIME__.slice(0, 10)}）
          </p>
        </div>
      </div>

      <div className="sec">
        <h3>資料來源與授權</h3>
        <div className="panel">
          <p className="small">
            筆順資料來自{' '}
            <a href="https://kanjivg.tagaini.net/" target="_blank" rel="noreferrer">
              KanjiVG
            </a>
            ，作者 Ulrich Apel，授權{' '}
            <a
              href="https://creativecommons.org/licenses/by-sa/3.0/"
              target="_blank"
              rel="noreferrer"
            >
              CC BY-SA 3.0
            </a>
            。本 App 只取用需要的假名筆畫，並依同一授權條款散布這部分資料。
          </p>
          <p className="small">
            字型 Klee One 與 Noto Sans TC 來自 Google Fonts，授權 SIL Open Font License 1.1。
          </p>
        </div>
      </div>

      <div className="sec">
        <h3>資料存在哪</h3>
        <div className="panel">
          <p className="small">
            進度存在這台裝置的瀏覽器裡。開了同步之後，會再存一份到你自己架的 Cloudflare
            Worker，沒有第三方伺服器。密鑰就是憑證，不要外流。
          </p>
        </div>
      </div>

      <div className="sec">
        <button type="button" className="ghost" onClick={onBack} style={{ width: '100%' }}>
          回紀錄
        </button>
      </div>
    </>
  )
}
