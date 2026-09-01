-- 付款告警：把「有人付了錢卻沒拿到東西」真的變成看得見的數字
--
-- 背景：count_payment_alerts() 在 20260817000001 就寫好了，但
--   (a) 從來沒有任何畫面呼叫它（admin/page.tsx:290 的註解自己就寫了這件事），
--   (b) 它只認 amount_mismatch 與 order_not_found 這兩種 outcome。
--
-- 而 APN handler 真正會產出的失敗狀態遠不只那兩種。原本的幾個 bug
-- （去重把 DB 錯誤當成重複通知、回查失敗後重送被吃掉、金額比對是恆真式）
-- 掉單時留下的 outcome 全都是這支函式看不到的那幾種 ——
-- 等於「掉錢的那條路徑」剛好完全避開了「偵測掉錢的那支查詢」。
--
-- 這個 migration 只改查詢與新增一支函式，不動任何資料。

-- ---------------------------------------------------------------------------
-- 1. 真的出事的（客人付了錢，但東西沒給）
-- ---------------------------------------------------------------------------

create or replace function public.count_payment_alerts()
returns int
language sql
security definer
stable
set search_path = ''
as $$
  select count(*)::int
  from public.payment_events
  where created_at > now() - interval '30 days'
    and (
      outcome in (
        'amount_mismatch',   -- 實收與應收不符，沒開通
        'not_authorized',    -- 回查黑貓 PAY 說這筆沒授權，沒開通
        'verify_failed',     -- 回查打不通，沒開通
        'reversal_notice'    -- 授權被取消／請款失敗，但訂單還掛在「已收款」
      )
      -- 收到通知卻找不到訂單。
      --
      -- ⚠️ 但要排掉「這則通知本來就跟錢無關」的狀態碼，否則紅框會被雜訊塞滿：
      --    正式站現在就有 5 筆 status_code='D'（訂單逾期）的 order_not_found ——
      --    那是沒人付款的單過期了、而那張單後來被刪掉，一毛錢都沒動到。
      --    這種每天掛在「需要處理」裡，只會把人訓練成不看那一塊。
      --    D 逾期／F 授權失敗／N 取消交易失敗／R 取消授權失敗都屬於這一類；
      --    其餘（含未知的新狀態碼）一律照舊告警，寧可多吵不要漏。
      or (
        outcome = 'order_not_found'
        and status_code not in ('D', 'F', 'N', 'R')
      )
      -- 卡在 pending 超過一小時 = 上次處理到一半就死了，
      -- 而 APN 同一個狀態碼最多重送 3 次（45 分鐘內）也已經用完了。
      or (outcome = 'pending' and created_at < now() - interval '1 hour')
    )
$$;

revoke all on function public.count_payment_alerts() from public, anon, authenticated;
grant execute on function public.count_payment_alerts() to service_role;

comment on function public.count_payment_alerts() is
  '近 30 天「收到付款通知但沒能把東西給出去」的筆數。每一筆都代表客人可能已經付錢 '
  '卻沒拿到課程／席次，必須有人看到 —— 顯示在 /admin 總覽的「需要處理」。';

-- ---------------------------------------------------------------------------
-- 2. 開通了、但金額沒核對過的
-- ---------------------------------------------------------------------------
--
-- 跟上面那支分開，因為嚴重度完全不同：這些訂單的課已經開了、客人沒有受影響，
-- 只是我們沒有一個獨立來源可以證明「他付的錢等於我們要收的錢」。
--
-- 為什麼會有這種狀態：規格只明寫 pay_amount 一個實收金額欄位，而那是代收代付
-- （繳款單）在用的；線上刷卡的 APN 與訂單查詢回應裡到底叫什麼名字，
-- 規格沒說清楚，我們手上也還沒有一筆真實交易可以看。
--
-- 以前的程式碼遇到這種情況是「回退去比對 order_amount」—— 但那是我們自己送出去
-- 的數字，比對永遠成立，等於沒比。現在改成誠實記成沒驗過並列在這裡。
--
-- ⚠️ 第一筆真實刷卡進來之後，payment_events.raw.__query_response 裡就會有完整
--    回應。把 lib/payment/blackcat.ts 的 PAID_AMOUNT_FIELDS 改對之後，
--    這個數字就會回到 0。它一直不是 0 才是正常的「還沒對到欄位名」，不是災難。

create or replace function public.count_payment_unverified()
returns int
language sql
security definer
stable
set search_path = ''
as $$
  select count(*)::int
  from public.payment_events
  where outcome = 'applied_unverified'
    and created_at > now() - interval '30 days'
$$;

revoke all on function public.count_payment_unverified() from public, anon, authenticated;
grant execute on function public.count_payment_unverified() to service_role;

comment on function public.count_payment_unverified() is
  '近 30 天已開通、但沒有獨立金額來源可核對的付款筆數。課已經開了、客人沒事，'
  '是我們這邊少了一個可以證明金額正確的欄位。對帳時人工比對黑貓 PAY 後台即可。';

-- ---------------------------------------------------------------------------
-- 3. outcome 詞彙表更新
-- ---------------------------------------------------------------------------

comment on column public.payment_events.outcome is
  'applied=已開通且金額核對過／applied_unverified=已開通但沒有獨立金額可核對／'
  'ignored=這個狀態碼不觸發開通／amount_mismatch=實收與應收不符（沒開通）／'
  'not_authorized=回查說沒授權（沒開通）／verify_failed=回查失敗（沒開通，會重送）／'
  'order_not_found=找不到訂單／reversal_notice=授權被取消或請款失敗但訂單仍為已收款／'
  'pending=處理中，停在這個值超過一小時代表跑到一半死掉。'
  '⚠️ 去重是以「有沒有跑到終局」為準：applied / applied_unverified / ignored / '
  'amount_mismatch 是終局，其餘的重送時會重跑一次（見 apn/route.ts 的 TERMINAL_OUTCOMES）。';
