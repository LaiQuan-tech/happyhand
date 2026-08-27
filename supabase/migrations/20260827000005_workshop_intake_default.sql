-- 有實體場次的商品，結帳時要問報名問題並勾健康聲明。
--
-- asks_intake 在 20260827000003 加進來時預設 false，但前台原本的行為是
-- 「購物車裡有工作坊就問」。把後台旗標接上去之後，如果不補這一筆，
-- 已經在賣的場次會突然不再要求勾健康聲明 —— 而 orders.health_ack_at
-- 是法律證據，不能靜默消失。
--
-- 🔴 條件不能只寫 type = 'workshop'：pulse-reading（讀脈入門課）是
--    type = 'course' 卻有實體場次，會出現在 /workshops 上讓人報名。
--    判準是「有沒有場次」，不是商品型別。
--
-- 純線上課維持 false：買了就能看，老師不需要事先知道學員狀況。
update public.products p
   set asks_intake = true
 where p.asks_intake is distinct from true
   and (
     p.type = 'workshop'
     or exists (
       select 1 from public.workshop_sessions ws where ws.product_id = p.id
     )
   );
