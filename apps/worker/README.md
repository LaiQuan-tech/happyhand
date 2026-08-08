# apps/worker — 快樂手背景服務

部署在 **Railway**，跑 Vercel 不適合處理的定時工作（serverless 沒辦法長駐、也沒有 cron 以外的排程能力）。

用 `SUPABASE_SERVICE_ROLE_KEY` 直連 Supabase，與 `apps/web` 共用同一個專案。

---

## 這個 worker 做什麼

| Job | 排程（Asia/Taipei） | 做什麼 | 會不會改資料 |
|---|---|---|---|
| `reclaim-seat-holds` | 每分鐘 `* * * * *` | 呼叫 `release_expired_seat_holds()`，清掉過期的名額暫扣並還原 `seats_taken` | ✅ 會（由 DB function 在單一交易內完成） |
| `workshop-reminders` | 每天 09:00 `0 9 * * *` | 找出 3 天後與 1 天後開課的場次，對已付款報名者寄提醒信 | ✅ 只寫 `notification_log`（去重記錄），不碰訂單與場次 |
| `atm-reconciliation` | 每小時 `0 * * * *` | 列出超過 3 天仍未付款的 ATM 訂單，輸出人工對帳清單 | ❌ **完全唯讀，是 stub** |
| `health` | 每 15 分鐘 `*/15 * * * *` | 輸出心跳 log | ❌ 不碰 DB |

### 1. `reclaim-seat-holds`

實際邏輯在 Postgres function `release_expired_seat_holds()`（由 `supabase/migrations/` 的 init migration 提供，worker 只負責呼叫）。

> worker 唯一擁有的 migration 是 `..._notification_log.sql`（提醒信去重用的表），其餘 schema 都不歸這裡管。

放在 DB 端是刻意的：刪 `seat_holds` 與回補 `workshop_sessions.seats_taken` 必須在同一個交易裡，否則會出現「暫扣刪掉了但名額沒還回去」的狀態，直接造成少賣或超賣。worker 只負責定時觸發與記錄結果。

function 若回傳 integer，log 會出現 `{"msg":"seat_holds_released","released":3}`；若回傳 void 或其他形狀，worker 不會硬猜，會記一筆 `seat_holds_release_count_unknown` 說明它拿到什麼。

### 2. `workshop-reminders`

- 兩個階段：開課前 3 天（`d3`）與前 1 天（`d1`）。
- 「幾天後」以**台北當地日曆日**計算。台灣自 1980 年起無日光節約時間，所以用固定 UTC+8 位移計算，不需要額外的時區套件。
- **去重寫在 DB，不是記憶體。** 寄信前先往 `notification_log` insert 一列 `(session_id, stage, channel)`，那三欄有 unique constraint：insert 成功就由這一輪負責寄，撞到 unique violation（SQLSTATE `23505`）就代表別人已經寄過 → 跳過。互斥只靠一個 statement，不需要交易或 Redis，**所以 Railway 重啟、重新部署、開多個副本都不會重複寄信**。
- **一天的補寄寬限。** 掃描區間刻意各多含一天：`d3` 掃「第 2～3 天」開課的場次、`d1` 掃「今天～明天」。若某天 09:00 那一輪整個失敗（例如 Supabase 剛好在維護），昨天該收 `d3` 的場次今天變成「2 天後」，仍然落在區間內，隔天自動補寄得掉。已經寄過的場次由 `notification_log` 擋住，不會因為區間變寬就重寄。
- 兩個階段的區間**不重疊**（`d3` = 第 2～3 天、`d1` = 今天～明天），否則「明天開課但還沒收過 `d3`」的場次會在同一個早上一次收到兩封信。
- **信件稱呼依實際剩餘天數決定，不是依階段代號。** 因為有補寄寬限，`d3` 有可能是開課前 2 天才寄出去，這時主旨會是「後天見」而不是「三天後見」——補寄還寫「三天後」等於告訴客人錯的日期。稱呼對照：0 天=今天、1=明天、2=後天、3=三天後。
- 收件對象：該場次的 `order_items`，對應 `orders.status = 'paid'` 的訂單。未付款、已取消、已退款一律不寄。
- `status = 'cancelled'` 的場次不寄。
- **收件信箱優先用 `orders.contact_email`**（結帳時本人填的），沒有值且訂單有綁會員時才退回去查 `auth.users`（走 auth admin API，一次只能查一人）。
- **以「訂單」為單位處理，不要求 `user_id` 有值。** `orders.user_id` 可以是 null（電話／LINE 代訂由客服建單，或會員已刪帳號）——打電話請客服代訂的往往正是最需要提醒的長輩客人，這類訂單必須照樣收到提醒。
- 同一場次、同一信箱只寄一封（同一人可能有兩張已付款訂單）。
- 寄信走 Resend HTTP API。**沒有設定 `RESEND_API_KEY` 就只記 log 不寄**（dry run），`WORKER_DRY_RUN=1` 也會強制 dry run。
- 完全找不到 email 的訂單會記一筆 `reminder_recipient_without_email` warn，附 `order_no`，需要人工打電話通知。

### 3. `atm-reconciliation` — 這是 stub，不是自動對帳

STACK.md §4 第 3 點的目標是「比對銀行匯入明細，自動把訂單改成 paid 並發放 entitlements」。**目前沒有任何銀行 API 或對帳檔來源，所以這個 job 不會自動化任何事情。**

它只做一件事：查出 `payment_method='atm'` 且 `status='pending'` 且建立超過 3 天的訂單，把清單輸出到 log，讓同事拿去銀行後台核對。**它不會修改任何一筆資料。**

log 裡每筆訂單一行，含 `order_no`、金額、等待天數與品項名稱，但**不含姓名／電話／email**（見下方「Log 格式」）。要聯絡客人時用 `order_no` 到後台查 `contact_name` / `contact_phone` / `contact_email`。

未來要接銀行 API 時，要改的位置與注意事項（冪等性、必須用 DB function 包交易等）寫在 `src/jobs/atm-reconciliation.ts` 檔案底部的 TODO 區塊。

### 4. `health`

Railway 的 log 若長時間空白，無法分辨「活著但沒事做」與「已經卡死」。這支每 15 分鐘留一筆 `worker_heartbeat`，方便設「30 分鐘沒看到心跳就告警」的監控規則。

---

## 本機怎麼跑

```bash
# 在 repo 根目錄
pnpm install

cp apps/worker/.env.example apps/worker/.env
# 編輯 apps/worker/.env 填入 SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY
# 本機建議保持 WORKER_DRY_RUN=1，避免測試時真的寄信給客人

pnpm --filter worker dev          # tsx watch，改檔自動重啟
pnpm --filter worker typecheck    # tsc --noEmit
pnpm --filter worker build        # 編譯到 dist/
pnpm --filter worker start        # 跑編譯後的產物
```

> Node 20 以上才有內建 `fetch` 與 `AbortSignal.timeout()`，`node-cron` v4 也要求 `>=20`。

### 手動跑單一 job（不等排程）

```bash
pnpm --filter worker job -- --once reclaim-seat-holds
pnpm --filter worker job -- --once workshop-reminders
pnpm --filter worker job -- --once atm-reconciliation
pnpm --filter worker job -- --once health
```

跑完就結束，不會起 HTTP server 也不會註冊排程。job 失敗時 exit code 為 1，方便接進腳本。

> 用 `job` 而不是 `dev`：`dev` 是 `tsx watch`，跑完會繼續監看檔案不會退出。
> 編譯後的版本則是 `node dist/index.js --once <name>`。

### Health check

```bash
curl http://localhost:3001/healthz
```

回傳服務狀態、uptime、每個 job 的執行次數／失敗次數／上次耗時。關閉流程開始後會改回 **503**，讓 Railway 停止把這個 instance 當成健康的。

---

## 環境變數

| 變數 | 必要 | 預設 | 說明 |
|---|---|---|---|
| `SUPABASE_URL` | ✅ | — | Supabase 專案 URL。也接受 `NEXT_PUBLIC_SUPABASE_URL`，方便本機沿用 `apps/web` 的設定 |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | — | service role key，繞過 RLS。**只能放後端** |
| `RESEND_API_KEY` | ❌ | 無 | 沒設定 → 提醒信只記 log 不寄（dry run） |
| `MAIL_FROM` | ❌ | `快樂手 <no-reply@happyhands.tw>` | 寄件人，網域需先在 Resend 驗證 |
| `MAIL_REPLY_TO` | ❌ | 無 | 回覆信箱 |
| `PORT` | ❌ | `3001` | health check port，Railway 會自動注入 |
| `WORKER_DRY_RUN` | ❌ | `false` | `1` = 即使有 API key 也不寄信 |
| `LOG_LEVEL` | ❌ | `info` | `debug` / `info` / `warn` / `error` |

**缺少 `SUPABASE_URL` 或 `SUPABASE_SERVICE_ROLE_KEY` 時，服務會印出明確錯誤並 `exit(1)`**，不會帶著壞掉的設定繼續跑。

> STACK.md §5 還列了 `REDIS_URL` 與 `LINE_CHANNEL_ACCESS_TOKEN`。這一版**都用不到**：沒有 Redis（見下方「刻意不做的事」），LINE 推播也尚未實作，目前只有 Email。

---

## Railway 設定

部署設定寫在 **repo 根目錄的 `railway.json`**（不是這個資料夾），內容已經涵蓋 build／start／health check／watch path，Railway 會自動讀取。

在 Railway 專案介面要確認的事：

1. **Root Directory 設成 repo 根目錄**（留空即可），**不要**指到 `apps/worker`。
   這是 pnpm workspace，`pnpm install` 必須在根目錄跑才找得到 `pnpm-workspace.yaml` 與 lockfile。
   （STACK.md §6 寫的是「root directory 指到 `apps/worker`」，那套裝法在 workspace 下會因為找不到 lockfile 而失敗，這裡刻意改成根目錄 + `--filter worker`。）
2. **Watch Paths** 已寫在 `railway.json` 的 `build.watchPatterns`：`apps/worker/**`、`railway.json`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`。
   這樣只改 `apps/web/` 不會觸發 worker 重新部署。若要在 UI 覆寫，填一樣的值。
3. **Variables**：至少要有 `SUPABASE_URL` 與 `SUPABASE_SERVICE_ROLE_KEY`，要寄信再加 `RESEND_API_KEY` 與 `MAIL_FROM`。
4. **Health check**：`/healthz`（已在 `railway.json` 設定）。
5. **Replicas 維持 1**（`numReplicas: 1`）——但這**已經不是正確性的要求**了。
   提醒信的去重改成 DB 級（`notification_log` 的 unique constraint）之後，多個副本同時跑也不會重複寄信，這個設定純粹是「沒必要多開」：
   排程沒有跨副本協調（每個副本都有自己的 node-cron），多開只會讓同一批查詢跑兩遍、log 也變兩份 —— 尤其 `atm-reconciliation` 的人工對帳清單每小時印兩份會直接誤導看的人。
   哪天真的需要（例如電子報要分批寄）再往上調是安全的，不必先改程式。

指令對照：

```
build:  corepack enable && pnpm install --frozen-lockfile && pnpm --filter worker build
start:  pnpm --filter worker start
```

### 關閉行為

收到 `SIGTERM` / `SIGINT` 時：health check 先轉 503 → 停掉所有排程 → 等進行中的 job 結束（最多 25 秒）→ 關閉 HTTP server → 退出。
若 25 秒內沒等到，會記一筆 `shutdown_timeout` 並以 exit code 1 強制退出（Railway 約 30 秒後才 SIGKILL，留了緩衝）。

---

## Log 格式

一行一筆 JSON，直接寫 stdout／stderr。慣例欄位：`ts`、`level`、`msg`、`job`、`duration_ms`。

```json
{"ts":"2026-08-08T09:42:35.997Z","level":"info","msg":"job_completed","service":"happyhands-worker","job":"reclaim-seat-holds","trigger":"schedule","duration_ms":81,"released":3}
```

**log 裡不會出現完整的 email／電話／姓名。** Railway 的 log 保留期長、團隊多人可見，也可能轉送第三方服務，所以收件者一律遮罩成 `g***@gmail.com`，要查人請用 log 裡的 `order_no` 或 `user_id` 到後台查。

---

## 已知限制（上線前請逐條確認）

> 舊版的第 1、2 點（「去重是記憶體級的，重啟後會重寄」與「沒有補寄機制」）已經解決 ——
> 去重搬到 `notification_log`，掃描區間也多帶一天寬限。詳見上面的 `workshop-reminders` 段落。
> 下面第 1 點是換完之後**剩下**的那一小塊。

### 1. 提醒信「宣告之後、寄完之前」被砍掉會漏寄

去重是**先宣告再寄**：先往 `notification_log` insert 佔位，成功才開始寄。反過來（寄完才記錄）會讓兩個副本同時通過檢查、同一封信寄兩次，而重複寄信是更該優先避免的問題。

代價是這個窄窗：**insert 成功之後、`sendAll()` 還沒跑完之前，process 被強制砍掉（SIGKILL、OOM）的話，那個場次剩下的收件人就漏掉了，而且不會重試**——記錄已經在，隔天的補寄掃描會把它當成寄過了。

實際影響有限，但要知道它存在：

- 正常的 Railway 部署是 SIGTERM，worker 會等進行中的 job 跑完（最多 25 秒）才退出，不會踩到這個窗。
- 若整輪失敗在 insert 之前（Supabase 掛掉、網路不通），根本不會留下記錄，隔天照樣補寄得到。
- 個別收件人寄失敗（Resend 回錯）不會拋例外，會計進 `emails_failed` 並各留一筆 `email_send_failed`，**需要人工補寄**——這一點跟改版前一樣。
- 補寄寬限只有一天。若連續兩天 09:00 都失敗，`d3` 就永久錯過了（場次已經變成「1 天後」，只會收到 `d1`）。要更保險就把 `reminderWindow()` 的寬限拉長，代價是同一場次每輪要多掃幾次。

要徹底解決得做「寄送狀態機」（claimed → sent，失敗回補），但那需要逐收件人記錄而不是逐場次，對單場十幾人的工作坊規模不划算。

### 2. `atm-reconciliation` 不會自動對帳

如上所述，它只產清單、不改資料。ATM 訂單目前仍需人工確認並手動開通。

### 3. 資料列型別是手寫的

`src/lib/types.ts` 依 STACK.md §3 手寫，不是 `supabase gen types` 產出的。**schema 改了但這裡沒改，編譯期不會報錯，會在執行期才發現。**

migration 定案後建議改成產生型別：

```bash
supabase gen types typescript --project-id <ref> > apps/worker/src/lib/database.types.ts
```

然後把 `createServiceClient` 改成 `createClient<Database>(...)`，並移除 `src/lib/db.ts` 裡的型別斷言。

### 4. 沒有 `contact_email` 的訂單要逐一查 auth admin API

多數訂單在結帳時就填了 `orders.contact_email`，直接用即可。只有「沒填 contact_email 且有綁會員」的訂單需要退回去查 `auth.admin.getUserById()`，而它一次只能查一個人 —— N 個這種訂單就是 N 次呼叫。

工作坊規模（單場十幾人）完全沒問題。**但若要做 24 節氣電子報那種大量寄送，這個 fallback 會太慢** —— 屆時應在 `profiles` 存一份 email 副本（註冊或付款時同步），改成一次查詢。

另外，`contact_email` 目前沒有任何格式驗證（DB 端是純 `text`）。若結帳表單讓客人打錯字，這裡會照樣送給 Resend，失敗時記在 `email_send_failed`。要更嚴謹應該在結帳 API 或 DB constraint 擋。

### 5. 沒有實作的項目

STACK.md §4 還列了兩項，這一版**沒有做**：
- **影片轉檔／字幕**（第 4 點）
- **24 節氣電子報排程寄送**（第 5 點）

另外 LINE 推播也還沒接，提醒目前只有 Email。

### 6. 沒有自動化測試

這個 package 目前沒有 test runner。最值得補測試的是決定「誰會收到信、會不會重複收到、信裡寫幾天後」的那幾塊：

- `src/lib/time.ts` 的 `taipeiDayRange()` 與 `taipeiDaysUntil()`（台北日曆日計算）
- `src/jobs/workshop-reminders.ts` 的 `reminderWindow()`：兩個階段的區間要相接且不重疊，下界不得早於 `now`
- `copyForDaysUntil()`：補寄時的稱呼

`claimNotification()` 的去重行為則需要真的連上一個 Postgres 才測得到（要驗的正是 unique constraint 的行為），適合放進日後的整合測試而不是單元測試。

---

## 刻意不做的事

**不用 BullMQ + Redis。** STACK.md §4 原本寫的是「Node + BullMQ + Railway Redis」，但現階段沒有 Redis 實例，而目前四個工作都是單純的定時觸發，沒有「任務排隊、重試、分散給多個 worker」的需求。多開一個 Redis 服務只是多一份成本與一個要顧的元件。

出現以下任一情況時，再把 Redis 加回來、改用佇列：

- 需要**跨副本**的排程協調（多個 worker 不能重複跑同一個 job）
  ——注意這指的是「不要白跑」，不是「不要重複寄信」：提醒信的去重已經由 `notification_log` 的 unique constraint 保證，不需要 Redis
- 需要**任務重試與死信佇列**（例如寄信失敗要自動重試三次）
- 出現由使用者操作觸發的**非同步長工作**（影片轉檔、批次匯出）
- 電子報要寄給幾千人，需要分批與速率控制

改造方式：把 `src/lib/runner.ts` 換成 BullMQ 的 worker/queue，`src/jobs/*.ts` 的 handler 幾乎可以原封不動搬過去——job 的邏輯與排程機制是分開的。

---

## 檔案結構

```
apps/worker/
├── src/
│   ├── index.ts                    進入點：env 檢查 → HTTP server → 註冊排程 → 優雅關閉
│   ├── jobs/
│   │   ├── index.ts                job 清單（新增排程在這裡登記）
│   │   ├── reclaim-seat-holds.ts
│   │   ├── workshop-reminders.ts
│   │   ├── atm-reconciliation.ts
│   │   └── health.ts
│   └── lib/
│       ├── env.ts                  環境變數驗證，缺就 exit(1)
│       ├── logger.ts               結構化 JSON log
│       ├── supabase.ts             service role client
│       ├── db.ts                   所有查詢集中在這裡（含 notification_log 去重）
│       ├── types.ts                手寫資料列型別（見限制 3）
│       ├── time.ts                 台北時區計算與顯示格式
│       ├── email.ts                Resend 寄信 / dry run
│       ├── privacy.ts              log 遮罩
│       ├── runner.ts               job 包裝：try/catch、計時、統計
│       └── http.ts                 /healthz
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```
