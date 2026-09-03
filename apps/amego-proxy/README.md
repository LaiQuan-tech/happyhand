# amego-proxy

Amego 發票 API 的固定出口 IP 代理。跑在 Railway，掛 Static Outbound IP。

## 為什麼需要

Amego 用**來源 IP 白名單**，快樂手跑在 Vercel，而 Vercel 沒有固定出口 IP
（Hobby／Pro 都沒有，那是 Enterprise 的 Secure Compute）。直連的結果是
100% 開票失敗：`{"code":14,"msg":"IP 錯誤：… 未被允許"}`。

## 它不做什麼

- **不持有 Amego 金鑰。** 簽章在 Vercel 端算完才送進來，這裡沒有 `AMEGO_APP_KEY`。
  這台機器被完整取走也開不出一張發票。
- **不解讀回應。** Amego 成功失敗全是 HTTP 200，判斷在 body 的 `code`；
  呼叫端 `lib/invoice/amego.ts` 已有完整三態處理，代理照抄狀態碼與 body。
- **不記錄 body。** 裡面有買受人姓名、統編、載具、金額。

## 環境變數

| 變數 | 必要 | 說明 |
|---|---|---|
| `PROXY_TOKEN` | ✅ | 通行證。沒設會**拒絕啟動**（沒有 token 等於開放中繼）。要與 Vercel 的 `AMEGO_PROXY_TOKEN` 一致 |
| `AMEGO_UPSTREAM` | | 預設 `https://invoice-api.amego.tw` |
| `PORT` | | Railway 會自動注入 |

## 對應的 Vercel 設定

```
AMEGO_API_URL     = https://<this-service>.up.railway.app
AMEGO_PROXY_TOKEN = <同 PROXY_TOKEN>
```

⚠️ `AMEGO_API_URL` 沒改的話，`lib/invoice/amego.ts` 判定為直連，**不會**送
token 標頭（避免把我們的 token 送給第三方），也就等於這支代理沒有生效。

## 部署設定放在哪（不在這個 repo）

⚠️ **這個目錄裡沒有 railway.json，是刻意的。** Railway 已經棄用 config-as-code
（`railway.json` / `railway.toml`），API 直接回絕：

```
Config as Code (railway.json / railway.toml) is deprecated.
Use Infrastructure as Code (.railway/railway.ts) instead.
```

所以設定是直接寫在 service 上（`serviceInstanceUpdate`），目前值：

| 項目 | 值 |
|---|---|
| Railway 專案 | `happyhands-amego-proxy` |
| service | `amego-proxy` |
| region | `us-west2`（回報名稱 `sfo`） |
| start command | `node apps/amego-proxy/src/server.js` |
| healthcheck | `/healthz` |
| watch patterns | `apps/amego-proxy/**`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` |
| 對外網址 | `https://amego-proxy-production.up.railway.app` |

（repo 根目錄那份 `railway.json` 是給 `apps/worker` 的，同樣已失效——worker
從未部署過。）

## ⚠️ 換 region 或重建 service，出口 IP 會變

固定 IP 是綁在 service 的 egress gateway 上。重建、換區、或 Railway 調整
IP 池之後，要重新把新 IP 送去 Amego 白名單，否則會**靜默全部開票失敗**。
啟用 gateway 之後也**必須 redeploy** 才生效——啟用當下線上的舊部署仍走浮動 IP。
