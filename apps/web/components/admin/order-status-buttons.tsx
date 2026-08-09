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
    label: "標記為已退款",
    pendingLabel: "處理中…",
    confirmText:
      "確定要標記為已退款？\n\n請先確認退款真的匯出去了。訂單佔用的工作坊席次會釋出給其他人，而且這個狀態無法改回。",
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
      <p className="text-[13px] leading-relaxed text-ink-soft">
        目前狀態：{orderStatusLabel(status)}。
        {status === "pending"
          ? "標記收款後才會佔用工作坊名額。"
          : "退款會把工作坊名額釋出。"}
      </p>
    </div>
  );
}
