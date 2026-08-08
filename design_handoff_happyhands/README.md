# Handoff：快樂手 Happy Healing Hands 課程網站（B 案「靜心留白」）

> 給接手的 Claude Code：請先完整讀完本檔與 `STACK.md`、`CONTENT.md`，再開始動工。
> **目標：100% 還原 `design/happyhands-B-all-pages.dc.html` 的視覺，並把它實作成可上線的課程電商網站。**
>
> 該檔為一張設計畫布，由上而下依序是 7 個頁面，**每個頁面都有「桌機 1240px」與「手機 390px」兩份設計稿並排**。
> 畫布內的連結是可點的（錨點跳到對應頁面樣板），方便你確認流程走向。

---

## 1. Overview

「快樂手」是好日子股份有限公司（GOOD DAY LOVE INC.，統編 53912857，代表人 劉柳樺）的品牌，
教授 **仁神術（Jin Shin Jyutsu, JSJ）** 能量療癒練習。現有站點為模板電商 <https://happyhands.qdm.tw/>，
本專案要重做成自有網站，需具備兩種商品型態：

1. **預錄線上課程** — 一次購買、永久／終生回放，需要會員登入後的影片觀看權限。
2. **線下實體工作坊** — 有日期、地點、名額上限，需要報名與名額扣減。

主要客群是 **退休樂齡族（60–75 歲）**，其次是想學自我照顧的中高齡家庭照顧者。
因此可及性（字級、對比、點擊區、電話報名）是硬性需求，不是加分項。

## 2. About the Design Files

`design/` 內的檔案是 **設計稿（HTML 原型）**，不是要直接上線的產品程式碼。
它們用來精確表達「長什麼樣、怎麼排、什麼顏色、什麼字級」。

- `happyhands-B-all-pages.dc.html` — **本次要實作的方案**，含全部 7 頁（首頁／課程總覽／單一課程頁／工作坊列表／報名結帳／完成頁／品牌＋師資＋FAQ），每頁桌機＋手機。
- `all-directions-canvas.dc.html` — 完整探索紀錄（A 溫潤直述 / B 靜心留白 / C 人情味，含三案手機版），僅供參考語氣與元件變體。
- `support.js` — 設計稿的執行環境；把它和 `.dc.html` 放同一層，用瀏覽器直接開 `.dc.html` 就能看到設計稿。
- `brand-reference-endcard.png` — 客戶提供的品牌影片片尾圖，**識別色與 logo 筆觸的來源**。

**任務不是把這些 HTML 貼上去，而是在 `STACK.md` 指定的技術環境（Next.js App Router）中重建這些畫面，做到像素級一致。**

## 3. Fidelity

**High-fidelity（hifi）。** 顏色、字級、間距、圓角、行高皆為最終值，請照抄 §6 的 token 表，
不要改用其他 UI library 的預設值（不要直接套 shadcn 預設灰階／藍色、不要用 Inter）。

唯一的例外：所有 `repeating-linear-gradient` 斜紋色塊都是 **圖片佔位**，
上線時換成真實照片（見 §8 Assets）。

**背景為純白 `#FFFFFF`**，僅次級區塊使用極淡暖米 `#FBF5EC` 做段落節奏，品牌焦糖棕作為動作色。

## 4. Screens / Views

以下 7 頁 **設計稿皆已完成**（桌機＋手機），請逐頁對照實作。`P0` 為第一階段必做。

### 4.1 首頁 `/`（P0）— 設計稿有完整視覺，請 100% 還原

**Purpose**：讓第一次來的長輩在 10 秒內知道「這是什麼、要不要試」，並分流到線上課或工作坊。

**Layout**：單欄置中，內容最大寬 1240px，左右 padding 40px（手機 20–22px）。由上而下：

| # | 區塊 | 桌機規格 | 手機規格 |
|---|---|---|---|
| 1 | Nav | 置中對稱：`線上課程 / 工作坊 /（LOGO 快樂手）/ 關於老師 / 聯絡我們`，padding 26px 40px，gap 40px，18px，`#6B543C`；LOGO 26px Noto Serif TC 700，letter-spacing .14em，`#A96C3C` | 三欄：`☰` / LOGO 21px / `♡`，padding 18px 20px |
| 2 | Hero | 置中。背景光暈：`radial-gradient(circle,#F6E7CC 0%,rgba(251,243,226,0) 70%)`，660×660，top 30px，`translateX(-50%)`，`overflow:hidden`。圓形 logo 圖 210×210。H1 54px / line-height 1.5 / weight 500 / letter-spacing .05em。副文 20px / 2.1 / `#7A6248` / max-width 640px。兩顆 CTA 置中，gap 16px。padding 86px 40px 92px | 光暈 420×420 top 10px；logo 圖 140×140；H1 32px / 1.55；副文 17px / 2；CTA 改為 **上下堆疊、滿版**，間距 10px；padding 40px 22px 52px |
| 3 | 三項理由 | `grid-template-columns: repeat(3,1fr)`，格線 `1px solid #EFE0C6`（上緣＋欄間），每格 padding 52px 40px 置中。序號「一二三」36px Noto Serif TC `#A96C3C`；標題 24px；內文 17.5px / 1.95 / `#7A6248` | 改為 **垂直三段**，每段 padding 30px 24px，下方 1px 分隔線；序號 28px、標題 20px、內文 16.5px |
| 4 | 課程卡 | 底色 `#F6EAD5`，padding 76px 40px。標題區置中：小標 `COURSES` 16px letter-spacing .18em `#A96C3C`＋H2 36px weight 500。卡片 `repeat(3,1fr)` gap 24px，max-width 1080px 置中；卡片 `#FBF3E2`、radius 22px、padding 34px 30px、置中；圓形縮圖 96×96；標題 22px；描述 17px；價格 26px `#A96C3C`。**主推卡**加 `2px solid #C08B5C` 且 CTA 改實心 `#A96C3C` | 單欄堆疊，卡片間距 14px；縮圖 76×76；標題 19px；價格 23px；CTA 滿版；區塊 padding 40px 20px 96px（底部留白給固定行動列） |
| 5 | 老師 | `grid-template-columns: .85fr 1.15fr`，gap 56px，max-width 1100px，padding 80px 40px。左圖 aspect 4/5，`border-radius: 999px 999px 28px 28px`。右側 H2 34px weight 500；內文 18.5px / 2.05 | 上下堆疊，圖在上；H2 26px；內文 17px / 2 |
| 6 | Footer CTA | `#C08B5C` 底、`#FBF3E2` 字，padding 64px 40px，置中。H2 32px weight 500；公司資訊 18px | padding 40px 20px；H2 24px |
| 7 | 手機固定行動列 | 桌機無 | `position: fixed; bottom 0`，底色 `rgba(251,243,226,.96)`，上緣 `1px solid #EFE0C6`，padding 12px 16px，兩顆按鈕 `flex:1` / `flex:1.4`：「打電話問」（外框）＋「開始線上練習」（實心）。頁面底部需 padding 96px 避免遮擋 |

**Copy（照抄，不要改寫）**

- H1：`身體會記得` / 換行 / `被好好對待的感覺`
- 副文：`快樂手是柳樺老師的仁神術（JSJ）練習。不需要體力、不需要器材，把手放在自己身上，慢慢把緊繃的地方鬆開。`
- CTA：`開始線上練習` / `預約工作坊`
- 三項理由：`每天十分鐘` — `一次一個能量流，早晚各做一回就夠了。`／`坐著也能做` — `膝蓋、腰不舒服也不用擔心，全程都有替代姿勢。`／`有人陪著練` — `線上同學群＋每月實體班，不會練到一半就放掉。`
- 課程區 H2：`從哪一堂開始都可以`
- 老師段落見 `CONTENT.md`
- Footer：`想問什麼都可以，我們有真人接電話` / `好日子股份有限公司・02-2833-5820・臺北市中山區新生北路三段 1 號 9 樓之 15`

### 4.2 課程總覽 `/courses`（P0）
沿用首頁「課程卡」樣式（§4.1 #4）。頂部 `#F6EAD5` 標題帶；篩選用膠囊 chip（未選：`#FBF3E2` 底 + `1px solid #E7D5B4` + `#7A6248`；已選：`#A96C3C` 底 + `#FBF3E2` 字）。桌機三欄、平板兩欄、手機單欄。

### 4.3 單一課程頁 `/courses/[slug]`（P0）
桌機 `grid-template-columns: 1.15fr .85fr`，gap 48px。左：課程封面 16/9 radius 22px、H1 40px、簡介 18.5px/2.05、單元列表（accordion，每列 padding 20px 24px，1px `#EFE0C6` 分隔，標題 18px，時長 16px `#A08560`）、老師簡介、FAQ。右：**sticky 購買卡**（`position: sticky; top: 24px`）— `#FBF3E2` 底、radius 22px、padding 30px、`1px solid #E7D5B4`：價格 32px `#A96C3C`（原價 17px `#A08560` 刪除線）、權益條列（永久回放／含紙本課本／可問老師）、滿版 CTA `加入購物車`（`#A96C3C`，高 56px）＋次要 `先看試看片段`（外框）。手機：購買卡改為底部固定列。

### 4.4 工作坊列表 `/workshops`（P0）
垂直卡片列（非網格）。每列 `grid-template-columns: 96px 1fr auto auto`，gap 28px，`#F6E9D2` 底，radius 18px，padding 24px 30px：日期方塊（月份 15px `#A08560` letter-spacing .1em／日 34px Noto Serif TC 600／星期 15px）、標題 23px＋地點時間 17px `#7A6248`、價格 24px `#A96C3C`＋名額（剩 ≤5 時 `#A96C3C`，否則 `#7A6248`）、CTA `我要報名`（`#4A3524` 實心膠囊，hover `#A96C3C`）。手機改為上下堆疊、CTA 滿版。額滿時 CTA 變 `#DCC29E` 灰底 disabled，文案 `已額滿・我要候補`。

### 4.5 報名／結帳 `/cart` → `/checkout` → `/checkout/success`（P0）
三步驟橫向進度指示（已完成 `#A96C3C`、未完成 `#DCC29E`）。表單欄位高 56px、radius 12px、`1px solid #DCC29E`、字 18px、label 17px 置於欄位上方（不用 placeholder 當 label）。錯誤訊息 16px `#B04A2F` 置於欄位下方。付款方式：信用卡（金流）／ATM 匯款（顯示帳號＋後台對帳）／LINE 或電話代訂（顯示 02-2833-5820）。成功頁：大字 `報名完成`、訂單編號、下一步指引、寄出通知信。

### 4.6 師資介紹 `/teachers`、品牌介紹 `/about`、常見問題 `/faq`（P1）
沿用首頁老師區與三項理由區的排版語彙。FAQ 用 accordion：問題 18.5px、答案 17.5px/2 `#7A6248`，`＋` 展開時 `rotate(45deg)`、transition .2s。

### 4.7 會員中心 `/account`（P1）
`我的課程`（有觀看進度）／`我的訂單`／`我報名的工作坊`／`資料設定`。影片播放頁需擋非購買者。

## 5. Interactions & Behavior

- **Hover**：主按鈕 `#A96C3C → #8A5227`；深色按鈕 `#4A3524 → #A96C3C`；外框按鈕加底色 `#F5E7CE`；卡片 `translateY(-4px)` + `0 22px 44px rgba(74,53,36,.10)`；一律 `transition: .2s ease`。
- **Focus**：所有可點元素 `outline: 3px solid #C08B5C; outline-offset: 2px`（樂齡族常用鍵盤／放大鏡，不可移除 focus ring）。
- **點擊區**：最小 56×56px（設計稿按鈕高度即為 56px）。
- **動畫**：只做淡入與位移，時長 ≤ 300ms，並遵守 `prefers-reduced-motion: reduce`。禁止視差與自動輪播。
- **響應式斷點**：`< 768px` 手機（單欄＋底部固定行動列）、`768–1279px` 平板（兩欄）、`≥ 1280px` 桌機（設計稿）。
- **Loading**：卡片用同色系 skeleton（`#F0E1C4`），不要旋轉 spinner。
- **表單驗證**：即時驗證 email／手機（09 開頭 10 碼）；送出失敗時錯誤訊息置頂並 focus 第一個錯誤欄位。
- **名額**：工作坊報名採「下單即暫扣 15 分鐘」，逾時釋放。

## 6. Design Tokens

```
/* 顏色 — 取自 brand-reference-endcard.png */
--white:     #FFFFFF   /* 主背景、卡片底（B 案白底版，本次採用） */
--cream-100: #FBF5EC   /* 次級區塊、列表底、統計塊 */
--cream-legacy: #FDF6E6 / #FBF3E2 / #F6EAD5  /* A、C 案奶油底，本次不使用 */
--sand-300:  #EFE0C6   /* 分隔線、disabled 按鈕底 */
--sand-400:  #DCC29E   /* 外框線、disabled */
--sand-500:  #E7D5B4   /* 卡片外框 */
--caramel:   #C08B5C   /* 品牌主色（大面積色塊、logo 圓） */
--caramel-ink:#A96C3C  /* 主要動作色、強調文字 */
--caramel-dk:#8A5227   /* hover */
--brown-900: #4A3524   /* 主文字、深色按鈕 */
--brown-700: #6B543C   /* 次要文字、nav */
--brown-500: #7A6248   /* 內文灰棕 */
--brown-300: #A08560   /* 說明文字、刪除線價格 */
--error:     #B04A2F

/* 光暈 */
--halo: radial-gradient(circle, #F6E7CC 0%, rgba(255,255,255,0) 70%);
/* 圖片佔位（開發期用） */
--placeholder: repeating-linear-gradient(135deg,#F0E1C4 0 12px,#E7D5B4 12px 24px);

/* 字體 */
--font-serif: 'Noto Serif TC', serif;   /* 標題、數字、價格 400/500/600/700 */
--font-sans:  'Noto Sans TC', sans-serif; /* 內文、UI 300/400/500/700 */

/* 字級（桌機 → 手機） */
H1 54/1.5/500 ls.05em → 32/1.55
H2 36/1.3/500        → 26
H3 24/1.4/600        → 20
body-lg 20/2.1       → 17/2
body    18.5/2.05    → 17/2
body-sm 17.5/1.95    → 16.5/1.9
caption 16 / eyebrow 16 ls.18em / micro 15
/* 最小內文字級 16px，主要內文一律 ≥17px */

/* 間距（8 基準） */
8 / 12 / 14 / 16 / 20 / 24 / 26 / 28 / 34 / 38 / 40 / 52 / 56 / 76 / 80 / 86 / 92

/* 圓角 */
--r-pill: 999px  /* 所有按鈕 */
--r-card: 22px   /* 卡片 */
--r-sm:   18px   /* 列表列 */
--r-input:12px
--r-hero-img: 999px 999px 28px 28px  /* 老師照 */

/* 陰影 */
--shadow-card: 0 22px 44px rgba(74,53,36,.10);
--shadow-float:0 24px 60px rgba(74,53,36,.16);

/* 版面 */
--max-w: 1240px;  --content-w: 1080–1100px（課程卡／老師區）
桌機左右 padding 40px；手機 20px
```

## 7. State Management

- `cart`：`{ items: [{ productId, type: 'course'|'workshop', qty, priceSnapshot }] }`，未登入存 localStorage，登入後合併至 DB。
- `session`：Supabase Auth（見 `STACK.md`），`user` / `profile`。
- `entitlements`：使用者已購課程 id 陣列，決定影片能否播放（伺服器端驗證，不可只在前端擋）。
- `workshopSeats`：即時剩餘名額，報名頁需在送出前重新查詢。
- `videoProgress`：每支影片的秒數，離開時 debounce 5 秒寫回。

## 8. Assets

目前設計稿中所有斜紋色塊都是佔位，需要客戶提供：

| 位置 | 需求 | 建議尺寸 |
|---|---|---|
| Hero 圓形 | 「快樂手」雙手線稿 logo（見 `brand-reference-endcard.png` 右下） | SVG，或 420×420 透明 PNG |
| 導覽列 LOGO | 品牌書法字「快樂手」 | SVG |
| 老師區 | 劉柳樺老師教學照（直式 4:5） | ≥1200×1500 |
| 課程卡 | 每堂課封面（圓形裁切用正方形） | ≥600×600 |
| 課程頁 | 課程封面橫式 16:9 | ≥1600×900 |
| 工作坊 | 教室現場照 | ≥1600×900 |

現有素材可從 <https://happyhands.qdm.tw/> 取得（Logo：`image-cdn-flare.qdm.cloud/.../14dcc3c9be427750df74cc5bb8a37da8.png`）。
字體用 Google Fonts 的 Noto Serif TC / Noto Sans TC，**請自架 subset 以免載入過慢**（繁中字檔大）。

## 9. Files

```
design_handoff_happyhands/
├── README.md                          ← 本檔：設計規格
├── STACK.md                           ← 技術架構、Vercel/GitHub/Supabase/Railway 部署與資料表
├── CONTENT.md                         ← 真實課程、價格、公司資訊、文案語氣規範
└── design/
    ├── happyhands-B-all-pages.dc.html ← **要還原的設計稿：7 頁 ×（桌機＋手機）**
    ├── all-directions-canvas.dc.html  ← 三案探索紀錄（參考，為奶白底舊版）
    ├── support.js                     ← 設計稿執行環境（與 .dc.html 同層）
    └── brand-reference-endcard.png    ← 品牌識別色來源
```

**設計稿頁面順序（由上到下）**：首頁 `#home` → 課程總覽 `#courses` → 單一課程頁 `#course` → 工作坊 `#workshops` → 報名結帳 `#checkout` → 完成頁 `#success` → 品牌＋師資＋FAQ `#about`。畫布內的連結可點，會跳到對應頁面樣板。

**怎麼看設計稿**：把 `design/` 整個資料夾丟到任一靜態伺服器（`npx serve design`），開啟 `happyhands-B-all-pages.dc.html`。
直接雙擊開啟也可以，但部分瀏覽器會擋本機模組載入，建議用 `npx serve`。
