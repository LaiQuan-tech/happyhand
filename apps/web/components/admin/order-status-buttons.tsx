import { ConfirmButton } from "@/components/admin/confirm-button";
import {
  ORDER_STATUS_LABELS,
  ORDER_TRANSITIONS,
  isOrderStatus,
  orderStatusLabel,
  type OrderStatus,
} from "@/app/admin/orders/shared";
import {
  cancelOrder,
  markOrderPaid,
  markRefundedManually,
  refundOrder,
  type OrderActionResult,
} from "@/app/admin/orders/actions";

/**
 * 訂單明細頁下方的狀態操作。
 *
 * 這是 server component（沒有 "use client"）：它只負責「依目前狀態決定顯示哪些按鈕」，
 * 再把 bind 好的 server action 交給 ConfirmButton（那支才是 client）。
 * 這樣訂單資料與 action 參照都留在 server，client bundle 只多了按鈕本身。
 *
 * ⚠️ 這裡的「不顯示」只是體貼，不是保護。
 *    真正擋非法轉移的是 actions.ts 裡的 checkTransition()，
 *    以及 update 上那道 .eq("status", from) 的條件。
 *    使用者手上這個頁面可能是三分鐘前 render 的，狀態早就被別人改掉了。
 */

type ActionSpec = {
  label: string;
  pendingLabel: string;
  confirmText: string;
  variant: "default" | "danger";
  action: (orderId: string) => Promise<OrderActionResult>;
};

/**
 * 目標狀態 -> 這顆按鈕長怎樣。
 * 與 ORDER_TRANSITIONS 一樣用查表：新增一個轉移時，
 * 忘記在這裡補一筆會被 TypeScript 的 Record<OrderStatus, …> 抓出來。
 *
 * confirmText 刻意寫「會發生什麼」而不是「確定嗎」——
 * 尤其要講出名額的連動與不可逆，那是按下去之後最容易後悔的兩件事。
 */
const ACTIONS: Record<OrderStatus, ActionSpec | null> = {
  pending: null,
  paid: {
    label: "標記為已收款",
    pendingLabel: "標記中…",
    confirmText:
      "確認已經收到這筆款項？\n\n訂單裡的工作坊席次會同時佔用掉，之後只能改成「已退款」，不能改回待收款。",
    variant: "default",
    action: markOrderPaid,
  },
  cancelled: {
    label: "取消訂單",
    pendingLabel: "取消中…",
    confirmText:
      "確定要取消這筆訂單？\n\n取消後就不再處理，而且無法改回。這筆訂單還沒收款，所以不會動到工作坊名額。",
    variant: "danger",
    action: cancelOrder,
  },
  refunded: {
    label: "退款",
    pendingLabel: "退款中…",
    confirmText:
      "確定要退款？\n\n" +
      "線上刷卡的訂單：系統會先向黑貓 PAY 送出退款（還沒請款的會是取消授權），" +
      "成功了才把訂單改成「已退款」。錢沒退成功的話狀態不會變。\n" +
      "ATM 或 LINE 代訂的訂單：系統沒有金流可以呼叫，請自己先把錢匯回去。\n\n" +
      "訂單佔用的工作坊席次會釋出給其他人，而且這個狀態無法改回。",
    variant: "danger",
    action: refundOrder,
  },
};

export function OrderStatusButtons({
  orderId,
  status,
  canWrite,
}: {
  orderId: string;
  status: string;
  /** 呼叫端要傳 can(role, "orders:write")。support 與 owner 有，editor 沒有。 */
  canWrite: boolean;
}) {
  if (!canWrite) {
    return (
      <p className="text-[14px] leading-relaxed text-ink-soft">
        你的帳號可以查看訂單，但沒有變更訂單狀態的權限。需要標記收款請找負責人。
      </p>
    );
  }

  if (!isOrderStatus(status)) {
    return (
      <p className="text-[14px] leading-relaxed text-danger">
        這筆訂單的狀態是「{status || "空值"}」，不在系統認得的四種狀態內，
        因此沒有可執行的操作。請聯絡工程師處理。
      </p>
    );
  }

  const targets = ORDER_TRANSITIONS[status];

  if (targets.length === 0) {
    return (
      <p className="text-[14px] leading-relaxed text-ink-soft">
        「{ORDER_STATUS_LABELS[status]}」是最終狀態，沒有可執行的操作。
        需要重新處理請建立一筆新訂單。
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-2.5">
        {targets.map((target) => {
          const spec = ACTIONS[target];
          if (!spec) return null;
          return (
            <ConfirmButton
              key={target}
              // bind 產生的仍然是 server action 參照，orderId 不會經過 client。
              action={spec.action.bind(null, orderId)}
              confirmText={spec.confirmText}
              variant={spec.variant}
              pendingLabel={spec.pendingLabel}
            >
              {spec.label}
            </ConfirmButton>
          );
        })}
      </div>
      {/*
        逃生門。只在「已付款」時出現。

        為什麼一定要有：跨月不能退（要改開折讓）、部分退款、金流 API 掛掉、
        或客服當下就直接用黑貓 PAY 後台退了 —— 這些情況上面那顆會一直失敗，
        沒有這一顆的話訂單就永遠卡在「已付款」，工作坊席次也放不出來。

        刻意做成 <details> 收起來、而且不是 danger 樣式：它比較不危險
        （不會動到錢），但**很容易被誤用**成「退款按鈕壞了就按這個」。
        收起來讓人多想一秒。
      */}
      {status === "paid" && (
        <details className="rounded-card border border-line bg-panel px-3.5 py-2.5">
          <summary className="flex min-h-11 cursor-pointer list-none items-center text-[13px] text-ink-soft admin:min-h-10 [&::-webkit-details-marker]:hidden">
            ＋ 已經在黑貓 PAY 後台退過款了？
          </summary>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
            這一顆<span className="font-medium text-ink">不會碰錢</span>，只把訂單標成已退款、
            釋出工作坊席次。只有在錢
            <span className="font-medium text-ink">確實</span>
            已經退出去的情況下才按 —— 系統這邊會在稽核紀錄裡註明「人工退款」，
            之後對帳分得出來。
          </p>
          <div className="mt-2">
            <ConfirmButton
              action={markRefundedManually.bind(null, orderId)}
              confirmText={
                "確定錢已經退給客人了嗎？\n\n" +
                "這一顆不會向黑貓 PAY 送出任何指令，只改訂單狀態。\n" +
                "如果錢其實還沒退，這筆訂單就會變成「系統說退了、實際沒退」，" +
                "而且無法改回。"
              }
              pendingLabel="標記中…"
            >
              只標記為已退款（不呼叫金流）
            </ConfirmButton>
          </div>
        </details>
      )}

      <p className="text-[13px] leading-relaxed text-ink-soft">
        目前狀態：{orderStatusLabel(status)}。
        {status === "pending"
          ? "標記收款後才會佔用工作坊名額。"
          : "退款會把工作坊名額釋出。"}
      </p>
    </div>
  );
}
