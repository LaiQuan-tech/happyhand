import { requireCapability, adminErrorMessage, AdminAuthError } from "@/lib/admin/guard";
import { createServiceClient } from "@/lib/supabase/server";
import { STAFF_ROLES, ROLE_LABELS } from "@/lib/admin/roles";
import { DataList } from "@/components/admin/data-list";
import { AdminField, AdminSelect } from "@/components/admin/admin-field";
import { formatTaipei } from "@/components/admin/datetime-field";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { RoleSelect } from "@/components/admin/role-select";
import { loadStaffPage, type StaffMember, type StaffPageData } from "./queries";
import { INVITE_FEEDBACK, type InviteCode } from "./rules";
import { inviteStaff, revokeInvite, setStaffRole, removeStaff } from "./actions";
import { Callout, Chip, PermissionDenied, RoleChip, RoleLegend, Section } from "./ui";

/**
 * 員工管理。
 *
 * 只有負責人（owner）進得來 —— 這一頁能把任何帳號升成負責人，
 * 等於是整個後台權限系統的根。
 *
 * 三個區塊，順序刻意是「現況 → 進行中 → 新增」：
 *   1. 現有員工：誰有後台權限、是什麼角色、什麼時候加入的
 *   2. 待接受的邀請：發出去還沒被領走的
 *   3. 邀請新員工：表單
 * 最後補一塊四種角色的對照表。負責人要決定給誰什麼角色時，
 * 需要的是四個角色互相比較，不是只看到目前這一個。
 *
 * ⚠️ 這頁的 disabled 只是體貼，不是保護。真正的三道防線在 ./actions.ts，
 *    而且每一支都自己呼叫 requireCapability("staff:manage")。
 */

export const dynamic = "force-dynamic";

export default async function AdminStaffPage({
  searchParams,
}: {
  // Next 15：searchParams 是 Promise
  searchParams: Promise<{ invite?: string; account?: string }>;
}) {
  // 頁面層的授權。layout 只擋「不是員工」，擋不了「是員工但不是負責人」。
  let staff;
  try {
    staff = await requireCapability("staff:manage");
  } catch (err) {
    if (err instanceof AdminAuthError) {
      // 不 redirect：把人丟回總覽而不說原因，他只會再點一次。
      return <PermissionDenied message={adminErrorMessage(err)} />;
    }
    throw err;
  }

  const params = await searchParams;
  // 代碼是使用者可以自己在網址列亂打的，用 in 檢查而不是直接索引，
  // 否則 ?invite=__proto__ 之類的輸入會拿到一個不是 InviteFeedback 的東西。
  const feedback =
    params.invite && Object.prototype.hasOwnProperty.call(INVITE_FEEDBACK, params.invite)
      ? INVITE_FEEDBACK[params.invite as InviteCode]
      : undefined;

  let data: StaffPageData | null = null;
  let fatal: string | null = null;
  try {
    const db = createServiceClient();
    data = await loadStaffPage(db, { accountId: params.account ?? null });
  } catch (err) {
    console.error("[admin/staff] 讀取失敗", err);
    fatal = "無法連線到資料庫，請重新整理。詳細錯誤已記在伺服器 log。";
  }

  return (
    <div className="flex flex-col gap-7">
      <header>
        <h1 className="font-serif text-[24px] leading-tight font-medium text-ink">員工</h1>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">
          誰進得了後台、以及各自看得到什麼。移除員工只會把角色降回一般會員，
          不會刪除帳號 —— 他經手過的訂單與紀錄都會保留。
        </p>
      </header>

      {fatal && <Callout tone="danger" title={fatal} />}

      {data?.warnings.map((warning) => (
        <Callout key={warning} tone="warn" title={warning} />
      ))}

      {data && (
        <>
          <Section
            id="members"
            title="現有員工"
            description={
              data.members.length === 0
                ? undefined
                : `共 ${data.members.length} 人，其中 ${data.ownerCount} 位負責人。` +
                  "系統至少要保留一位負責人，所以唯一的那一位不能被移除。"
            }
          >
            <DataList
              items={data.members}
              keyOf={(member) => member.id}
              caption="有後台權限的帳號、角色與加入時間"
              empty="目前沒有任何員工。這不太可能發生（你自己就是），請重新整理看看。"
              columns={[
                {
                  header: "Email",
                  primary: true,
                  cell: (member) => <MemberIdentity member={member} selfId={staff.id} />,
                },
                {
                  header: "角色",
                  className: "min-w-[13rem]",
                  cell: (member) => (
                    <MemberRoleCell
                      member={member}
                      selfId={staff.id}
                      ownerCount={data.ownerCount}
                    />
                  ),
                },
                {
                  header: "加入時間",
                  cell: (member) => formatTaipei(member.createdAt),
                },
              ]}
              actions={(member) => (
                <MemberActions member={member} selfId={staff.id} ownerCount={data.ownerCount} />
              )}
            />
          </Section>

          <Section
            id="invites"
            title="待接受的邀請"
            description="已經發出、但對方還沒註冊的信箱。對方一註冊就會自動套用角色，這筆紀錄也會消失。"
          >
            <DataList
              items={data.invites}
              keyOf={(invite) => invite.id}
              caption="尚未被接受的員工邀請"
              empty="目前沒有待接受的邀請。"
              columns={[
                {
                  header: "Email",
                  primary: true,
                  cell: (invite) => <span className="break-all">{invite.email}</span>,
                },
                {
                  header: "狀態",
                  trailing: true,
                  cell: (invite) =>
                    invite.dead ? <Chip label="不會生效" tone="danger" /> : null,
                },
                { header: "角色", cell: (invite) => <RoleChip role={invite.role} /> },
                { header: "邀請時間", cell: (invite) => formatTaipei(invite.createdAt) },
                {
                  header: "邀請人",
                  cell: (invite) => (
                    <span className="break-all">
                      {invite.invitedByEmail ??
                        (invite.invitedBy ? "（帳號已刪除）" : "（由 SQL 直接建立）")}
                    </span>
                  ),
                },
              ]}
              actions={(invite) => (
                <ConfirmButton
                  action={revokeInvite.bind(null, invite.id)}
                  variant="danger"
                  pendingLabel="撤銷中…"
                  confirmText={`確定撤銷對 ${invite.email} 的邀請嗎？\n\n撤銷後他到登入頁註冊只會變成一般會員，進不了後台。之後可以再邀請一次。`}
                >
                  撤銷邀請
                </ConfirmButton>
              )}
            />

            {data.invites.some((invite) => invite.dead) && (
              <Callout tone="warn" title="有邀請標示為「不會生效」">
                這些信箱已經有帳號了。員工邀請只在「註冊當下」生效一次，
                已註冊的人不會再觸發，所以這些邀請會一直躺在這裡不動作。
                請撤銷它們，改成直接調整那個帳號的角色。
              </Callout>
            )}
          </Section>

          <Section
            id="invite"
            title="邀請新員工"
            description="填信箱、選角色。對方用這個信箱到登入頁註冊後就會自動拿到權限，你不需要幫他建帳號。"
          >
            {feedback && (
              <Callout live tone={feedback.tone} title={feedback.title}>
                {feedback.body}
              </Callout>
            )}

            {data.lookedUpAccount && (
              <LookedUpAccount account={data.lookedUpAccount} selfId={staff.id} />
            )}

            {/*
              純 server component 的 <form action={serverAction}>。
              沒有 useActionState —— 結果由 actions.ts 用 redirect 帶一個短代碼回來，
              上面的 Callout 負責翻成中文。代價是送出失敗時信箱要重打一次；
              換來的是 AdminField / AdminSelect 不用整組被拉進 client bundle，
              而且網址列永遠不會出現任何人的 Email。
            */}
            <form
              action={inviteStaff}
              className="flex flex-col gap-4 rounded-card border border-line bg-panel px-4 py-4 admin:flex-row admin:items-start admin:gap-4"
            >
              <AdminField
                label="Email"
                name="email"
                type="email"
                required
                autoComplete="off"
                spellCheck={false}
                inputMode="email"
                placeholder="someone@example.com"
                maxLength={254}
                hint="大小寫與前後空白會自動整理，填錯格式會擋下來。"
                wrapperClassName="min-w-0 flex-1"
              />

              <AdminSelect
                label="角色"
                name="role"
                required
                defaultValue="support"
                options={STAFF_ROLES.map((role) => ({
                  value: role,
                  label: ROLE_LABELS[role],
                }))}
                // 這裡刻意不寫某個角色的說明：<select> 是非受控的，
                // 使用者改選之後這行不會跟著變，會變成一句錯的話。
                // 四個角色的差別完整列在下方的「四種角色能做什麼」。
                hint="預設是權限最小的客服。各角色的差別見下方對照表。"
                wrapperClassName="min-w-0 admin:w-[13rem] admin:shrink-0"
              />

              <button
                type="submit"
                className="inline-flex min-h-11 items-center justify-center rounded-input border border-accent-ink bg-accent-ink px-5 text-[15px] font-medium text-paper transition-colors hover:bg-accent admin:mt-[26px] admin:min-h-10 admin:shrink-0"
              >
                送出邀請
              </button>
            </form>
          </Section>

          <Section
            title="四種角色能做什麼"
            description="要決定給一個人什麼角色時，重點是四個角色互相比較，不是只看其中一個。"
          >
            <RoleLegend />
          </Section>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ 零件 */

function MemberIdentity({ member, selfId }: { member: StaffMember; selfId: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="break-all">{member.email ?? "（讀不到 Email）"}</span>
      {member.id === selfId && <Chip label="你自己" tone="warn" />}
      {member.fullName && (
        <span className="text-[13px] font-normal text-ink-soft">{member.fullName}</span>
      )}
    </span>
  );
}

/**
 * 這一列能不能改／能不能移除，以及為什麼不能。
 *
 * 只回「不能」不說原因的話，負責人會以為是壞掉了然後一直按。
 */
function lockReasonFor(
  member: StaffMember,
  selfId: string,
  ownerCount: number,
): string | null {
  if (member.id === selfId) {
    return "這是你自己的帳號。負責人不能改自己的角色，避免一鍵把自己鎖在後台外面 —— 需要調整請找另一位負責人。";
  }
  if (member.role === "owner" && ownerCount <= 1) {
    return "這是目前唯一的負責人，不能移除。請先把另一個帳號設成負責人。";
  }
  return null;
}

function MemberRoleCell({
  member,
  selfId,
  ownerCount,
}: {
  member: StaffMember;
  selfId: string;
  ownerCount: number;
}) {
  const lock = lockReasonFor(member, selfId, ownerCount);
  return (
    <RoleSelect
      // key 讓伺服器端的值變動時強制重新掛載，元件內的 useState 才不會停在舊角色
      key={`${member.id}:${member.role}`}
      id={`role-${member.id}`}
      role={member.role}
      subject={member.email ?? member.id}
      action={setStaffRole.bind(null, member.id)}
      disabled={lock !== null}
      disabledReason={lock ?? undefined}
    />
  );
}

function MemberActions({
  member,
  selfId,
  ownerCount,
}: {
  member: StaffMember;
  selfId: string;
  ownerCount: number;
}) {
  if (lockReasonFor(member, selfId, ownerCount)) {
    // 原因已經寫在角色欄位下面了，這裡再寫一次只是重複。
    return <span className="text-[13px] text-ink-soft">—</span>;
  }

  return (
    <ConfirmButton
      action={removeStaff.bind(null, member.id)}
      variant="danger"
      pendingLabel="移除中…"
      confirmText={`確定移除 ${member.email ?? member.id} 的員工權限嗎？\n\n他的角色會降回「一般會員」，馬上就進不了後台。帳號不會被刪除，他經手過的訂單與紀錄都保留。`}
    >
      移除員工權限
    </ConfirmButton>
  );
}

/**
 * 「這個信箱已經有帳號了」時，把那個帳號直接擺出來。
 *
 * 沒有這一塊的話，那句「請直接改他的角色」是做不到的建議：
 * 上面的員工清單只列 role <> customer，一般會員根本不在裡面。
 */
function LookedUpAccount({ account, selfId }: { account: StaffMember; selfId: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-accent bg-panel px-4 py-4">
      <div className="min-w-0">
        <p className="text-[14px] font-medium break-all text-ink">
          {account.email ?? "（讀不到 Email）"}
        </p>
        <p className="mt-0.5 text-[13px] text-ink-soft">
          目前是「{ROLE_LABELS[account.role]}」，{formatTaipei(account.createdAt)} 註冊。
        </p>
      </div>

      {account.id === selfId ? (
        <p className="text-[13px] text-ink-soft">這是你自己的帳號，不能改自己的角色。</p>
      ) : (
        <RoleSelect
          key={`lookup:${account.id}:${account.role}`}
          id={`role-lookup-${account.id}`}
          role={account.role}
          subject={account.email ?? account.id}
          action={setStaffRole.bind(null, account.id)}
        />
      )}
    </div>
  );
}
