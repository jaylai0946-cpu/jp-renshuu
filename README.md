# 日文練習本 📖

銘傳國企一甲「日文一（上）」的練習 App。假名、單字用間隔複習排程，之後會加上
Apple Pencil 手寫練習和造句批改。

前身是 claude.ai 上的一個 Artifact，現在搬成自架 PWA，可以加到 iPad 和 iPhone
主畫面、離線使用，並在裝置之間同步進度。做法跟
[mcu-schedule](https://github.com/jaylai0946-cpu/mcu-schedule)（課表 App）一樣，
兩個專案好一起維護。

## 目前做到哪 🚧

分四個階段做，每個階段做完在 iPad 上實測再繼續。

| 階段 | 內容 | 狀態 |
| --- | --- | --- |
| 1 | 搬成 React PWA：單元、題型、間隔複習、同步、匯入匯出 | ✅ 完成 |
| 2 | 手寫畫布：Apple Pencil、防手掌誤觸、看筆順動畫、描寫模式 | ✅ 完成 |
| 3 | 自動判分（本機運算）、默寫題加進每日練習 | ⬜ 未開始 |
| 4 | 造句批改：Worker 的 `/grade` 端點呼叫 Claude API | ⬜ 未開始 |

手寫畫布可以用了，但**判分還沒做**（階段 3）：寫完只會留在畫面上，不會記進熟練度，
每日練習也還不會出默寫題。

## 開發

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # vitest
pnpm typecheck
pnpm lint
pnpm build
```

圖示是用 `node scripts/make-icons.mjs` 產生的（這台機器沒有 ImageMagick，
所以腳本裡自己寫了一個最小的 PNG 編碼器）。改圖案就改那個腳本再跑一次。

## 部署到 GitHub Pages 🚀

推到 `main` 就會自動建置並上線，設定在 `.github/workflows/deploy.yml`。
第一次要到 repo 的 **Settings → Pages → Source** 選 **GitHub Actions**。

網址是 `https://jaylai0946-cpu.github.io/jp-renshuu/`。
**repo 改名的話要同時改 `vite.config.ts` 裡的 `BASE`**，否則上線會是白畫面。

## 裝到 iPad 和 iPhone 📱

1. 用 Safari 打開上面的網址
2. 分享 → 加入主畫面
3. 之後從主畫面開啟就是全螢幕，離線也能練

## 手機與電腦同步 🔄

### 為什麼要自己架

進度預設只存在當下那台裝置的瀏覽器裡。要讓 iPad 練完、iPhone 打開是同一份，
就得有個地方放共同的那份資料。`worker/` 裡有一個現成的 Cloudflare Worker，
免費額度綽綽有餘。

**跟課表 App 用不同的 Worker 和不同的 KV namespace**，兩邊的資料不會互相蓋到。

### 可以直接用課表那台

課表 App 的 Worker 是通用的：`/s/<密鑰>` 存什麼它就收什麼，密鑰不同就是
不同筆資料。所以日文練習本可以直接填**課表那台的網址**，只要**密鑰另外產一組**，
兩邊的資料在 KV 裡本來就是分開的（`state:<課表密鑰>` 和 `state:<日文密鑰>`）。

這樣就不用再架一台。代價是兩個 App 綁在同一個 Worker 上，階段 4 的造句批改
（要放 Claude API key）會讓課表的 Worker 也扛著那把 key——到時候再拆不遲。

App 會擋住密鑰填錯的情況：拉回來的資料如果是課表的形狀，會直接報錯而不是
當成空白進度推上去把課表洗掉。

### 架設步驟（要獨立的一台時）

```bash
cd worker
npx wrangler login
npx wrangler kv namespace create SYNC   # 把印出來的 id 填進 wrangler.toml
npx wrangler deploy
```

部署完會給你一個 `https://jp-renshuu-sync.<你的帳號>.workers.dev` 的網址。

### 兩台裝置設定

**第一台**：紀錄 → 手機與電腦同步 → 填 Worker 網址 → 按「產生新密鑰」→ 啟用同步。

**第二台**（兩種方法，挑一個）：

- **傳設定連結**（推薦）：第一台按「複製設定連結」，用 AirDrop 或訊息傳到第二台，
  在第二台打開那個連結，它會問要不要連上同步。不用手打 32 個字元。
- **手動填**：第二台填同一個網址和同一組密鑰，啟用。

設定連結長這樣，密鑰放在 `#` 後面，所以不會被送到 GitHub Pages 的伺服器、
也不會留在任何 access log 裡：

```
https://jaylai0946-cpu.github.io/jp-renshuu/#sync=https%3A%2F%2F...workers.dev|<32 字元密鑰>
```

> ⚠️ 連結裡含密鑰，等同於憑證。只傳給自己，不要貼到群組或公開的地方。

> ⚠️ 密鑰就是憑證，沒有帳號密碼。拿到密鑰的人就拿得到你的進度，不要貼到公開的地方。
> Worker 只擋密鑰格式，猜不中是因為 32 個英數字的組合夠多，不是因為有人在驗證身分。

### 衝突怎麼處理

推上去時會帶 `If-Match`，也就是「我上次看到的版本」。如果雲端已經被另一台改過，
Worker 會回 409 並附上雲端現況，App 會問你要留哪一份，不會自己選。

一邊沒改、另一邊改過的情況（最常見）不會跳衝突，直接同步。

## 從 claude.ai 的舊版搬進度

舊版的進度在那個 HTML 檔的 `<script id="state">` 裡。請 claude.ai 上的 Claude
把那段 JSON 給你，然後在 **紀錄 → 搬進度** 貼上，按「匯入舊版進度」。

item 的 id 格式（`h:あ`、`k:ア`、`w:わたし`）新版原封不動沿用，所以熟練度、
連續天數、今天的新字額度都會跟著過來。對不上目前題庫的字會被跳過，並回報跳了幾個。

同一個地方也可以「匯出進度」做備份，和「匯入備份」還原。

## 資料存在哪 💾

| 東西 | 位置 | 會不會同步 |
| --- | --- | --- |
| 練習進度、設定 | `localStorage['jp-renshuu']` | 會 |
| 同步伺服器網址與密鑰 | `localStorage['jp-renshuu.sync']` | **不會**（是這台的設定，匯出備份也不含密鑰） |
| 壞掉的資料備份 | `localStorage['jp-renshuu.corrupt']` | 不會 |

雲端那份存在你自己的 Cloudflare KV，key 是 `state:<密鑰>`。

## 手寫練習

「手寫」分頁有三種模式，都用 KanjiVG 的筆順資料：

| 模式 | 做什麼 |
| --- | --- |
| 看筆順 | 動畫依序畫出每一筆，標出筆順編號和起筆點 |
| 描寫 | 田字格裡有淡淡的範本，照著描 |
| 默寫 | 只給羅馬拼音，從記憶寫出來 |

拗音會拆成兩個字元分別練（きゃ 練 き 和 ゃ），小字獨立佔一格。第一版只練假名，
漢字手寫還沒做。

### iPad 與 Apple Pencil

- 用 Pointer Events，靠 `pointerType === 'pen'` 認 Apple Pencil
- 設定裡的「只用 Apple Pencil 書寫」預設**開啟**：手指和手掌碰到畫布不會留下痕跡。
  沒有筆的裝置第一次用手指碰會跳出提示，一鍵關掉
- `touch-action: none`，寫字時頁面不會跟著捲
- `getCoalescedEvents()` 把兩次 move 之間被合併掉的取樣點補回來，線條才平順
- `pressure` 改筆畫粗細；滑鼠和手指不回報壓力，給固定值
- `devicePixelRatio` 縮放，Retina 上不糊
- `pointercancel`（被系統手勢打斷）會把那一筆丟掉，不會卡住
- 書寫途中不呼叫 `setState`：筆一秒送上百個點，每點 render 一次會掉幀。
  移動時只把新的那一小段畫上去，整張重畫留給復原、清除、換字

### 筆順資料怎麼來的

`scripts/build-kanjivg.mjs` 從 KanjiVG 抓 App 用得到的 148 個假名，取出照筆順排的
SVG path，產生 `src/data/strokes.json`（433 筆，41 KB）。

產出物 commit 進 repo，CI 不連外網——KanjiVG 掛掉不該讓部署跟著失敗。要更新就跑：

```bash
pnpm strokes
```

腳本會檢查筆順編號連續、path 只用到支援的指令；有任何一個字抓不到就整批不寫出檔案。
`src/lib/strokes.test.ts` 另外盯著 JSON 和 `handwritingChars()` 的清單一致。

路徑解析自己寫在 `src/lib/path.ts`，沒有用瀏覽器的 `getPointAtLength()`——那個要有
DOM，判分邏輯就沒辦法在 Node 裡單獨測。KanjiVG 的假名只用到 `M` 和 `c` 兩種指令。

## 間隔複習怎麼算

| 盒子 | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 下次複習（天） | 當天 | 1 | 2 | 4 | 8 | 16 | 32 |

- 答對往上一格，答錯直接回**盒子 1**（不是 0——回 0 的話明天又會被當成新字介紹一次）
- 一回合裡**只有第一次作答計分**，答錯後補的那一題只給點數不動盒子
- 答錯的字會在同一回合的尾巴再出一次
- 盒子 2 以上才會出反向題（羅馬拼音→假名、中文→日文）
- 「我已經會了」把整個單元還沒學的字放進盒子 3

## 專案結構

```
src/
  data/units.ts        12 個單元、283 個字（假名 208 + 單字 75）
  lib/srs.ts           間隔複習、出題、選項、默寫排程
  lib/actions.ts       改進度的純函式（點數、盒子、歷史）
  lib/storage.ts       localStorage 存取與壞資料處理
  lib/validate.ts      所有外來資料的守門員
  lib/legacyImport.ts  吃 Artifact 版的 JSON
  lib/path.ts          SVG path 解析、折線化、等距重新取樣
  lib/strokes.ts       KanjiVG 筆順資料的存取與快取
  lib/sync.ts          同步的 HTTP 層
  useSync.ts           同步的狀態機（樂觀鎖、衝突、debounce）
  useRound.ts          一回合練習的狀態
  components/          畫面
worker/                Cloudflare Worker（同步後端）
scripts/build-kanjivg.mjs KanjiVG -> strokes.json
scripts/make-icons.mjs 產生 PWA 圖示
```

## 資料來源與授權

- 筆順資料：[KanjiVG](https://kanjivg.tagaini.net/)，
  作者 Ulrich Apel，授權 [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)。
  App 的「關於」頁有標示。
- 字型：Klee One、Noto Sans TC，來自 Google Fonts，SIL Open Font License 1.1。

## 沒有做的事

- **沒有帳號系統**。密鑰就是全部的安全性。
- **不支援多人**。這是一個人用的練習本。
- **漢字手寫還沒做**。第一版只練假名；資料結構留了擴充空間。
- **發音靠系統語音**（Web Speech API `ja-JP`）。沒有日文語音的裝置會唸得很怪。
