"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadYouTubeApi,
  formatClock,
  type YTPlayer,
} from "@/components/account/youtube-api";

/**
 * 上課教室的播放器。
 *
 * 兩件事同時做：播影片、記進度。
 *
 * === 進度記錄的節流（兩層）===
 * 取樣：每 10 秒讀一次 getCurrentTime()，只存在 ref 裡，**不打網路**
 * 送出：最多每 20 秒一次，而且位置要比上次多 5 秒以上才送
 * → 最壞情況 3 次/分鐘/人。一堂 20 分鐘的課約 60 次寫入。
 *
 * === 離開頁面的保底寫入（這段一定要對）===
 * 長輩最常見的離開方式是「按 Home 鍵切走」，不是關分頁。
 * ・visibilitychange 與 pagehide **兩個都要掛**（iOS Safari 常跳過前者）
 * ・用 navigator.sendBeacon，**不要**用 beforeunload + fetch（手機幾乎不觸發）
 * ・sendBeacon 不能設 header，但會帶同源 cookie，所以 server 認得出身分
 *
 * === 續播不自動播 ===
 * 有進度時顯示兩顆整寬大按鈕讓使用者選，不自動 seek + play。
 * 行動裝置本來就會擋自動播放（然後長輩以為壞了），而且突然從中間開始很困惑。
 */

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; videoId: string; resumeAt: number };

const SAMPLE_MS = 10_000;
const FLUSH_MS = 20_000;
const MIN_DELTA_SEC = 5;

export function LessonPlayer({
  lessonId,
  lessonTitle,
  /** 遮罩後的 Email + 訂單末四碼。技術上防不了盜錄，但外流時追得到來源。 */
  watermark,
  onCompleted,
}: {
  lessonId: string;
  lessonTitle: string;
  watermark: string | null;
  /** 判定完成時通知父層，讓左邊的單元列表立刻打勾（不用等重新整理） */
  onCompleted?: (lessonId: string) => void;
}) {
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [resumeChoice, setResumeChoice] = useState<"pending" | "done">("done");

  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const lastSentRef = useRef(-1);
  const lastSentAtRef = useRef(0);
  const completedRef = useRef(false);
  const sampleTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ------------------------------------------------------- 進度送出 */

  const send = useCallback(
    (opts: { ended?: boolean; beacon?: boolean } = {}) => {
      const position = Math.floor(positionRef.current);
      const duration = Math.floor(durationRef.current);
      if (position <= 0) return;

      const enoughChange = Math.abs(position - lastSentRef.current) >= MIN_DELTA_SEC;
      const enoughTime = Date.now() - lastSentAtRef.current >= FLUSH_MS;
      // ended 與 beacon 是「最後一次機會」，不受節流限制
      if (!opts.ended && !opts.beacon && !(enoughChange && enoughTime)) return;

      lastSentRef.current = position;
      lastSentAtRef.current = Date.now();

      const payload = JSON.stringify({
        lessonId,
        positionSec: position,
        durationSec: duration || null,
        ended: opts.ended === true,
      });

      if (opts.beacon && typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon(
          "/api/progress",
          new Blob([payload], { type: "application/json" }),
        );
        return;
      }

      void fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {
        // 進度寫入失敗不該打斷觀看。下一次取樣會再送一次。
      });
    },
    [lessonId],
  );

  /* ------------------------------------------- 離開頁面的保底寫入 */

  useEffect(() => {
    const flush = () => send({ beacon: true });
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      // 切換單元時也要 flush 一次，否則剛剛看的那幾秒會掉
      flush();
    };
  }, [send]);

  /* ----------------------------------------------- 取影片 ID 並建立播放器 */

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    completedRef.current = false;
    positionRef.current = 0;
    lastSentRef.current = -1;

    (async () => {
      // 影片 ID 到這一刻才拿。RSC 刻意不帶下來——那會讓整門課的 ID
      // 一次全進 HTML。這一支 endpoint 就是 entitlement 的執行點。
      const res = await fetch(`/api/lessons/${lessonId}/video`, {
        method: "POST",
      });
      if (cancelled) return;

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setState({
          kind: "error",
          message: body.message ?? "影片讀不到，請重新整理後再試一次。",
        });
        return;
      }

      const data = (await res.json()) as { videoId: string; resumeAt: number };
      if (cancelled) return;

      setState({ kind: "ready", videoId: data.videoId, resumeAt: data.resumeAt });
      // 有進度就先問要不要續播，不自動跳
      setResumeChoice(data.resumeAt > 5 ? "pending" : "done");
    })().catch((err) => {
      console.error("[player] 取得影片失敗", err);
      if (!cancelled) {
        setState({ kind: "error", message: "影片讀不到，請重新整理後再試一次。" });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [lessonId]);

  useEffect(() => {
    if (state.kind !== "ready") return;

    let cancelled = false;
    let player: YTPlayer | null = null;

    const stopSampling = () => {
      if (sampleTimer.current) {
        clearInterval(sampleTimer.current);
        sampleTimer.current = null;
      }
    };

    const startSampling = () => {
      stopSampling();
      sampleTimer.current = setInterval(() => {
        // player 已經 destroy 之後呼叫 getCurrentTime 會丟錯，所以要防一手
        if (!playerRef.current) return;
        try {
          positionRef.current = playerRef.current.getCurrentTime();
          durationRef.current = playerRef.current.getDuration();
          send();
        } catch {
          stopSampling();
        }
      }, SAMPLE_MS);
    };

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !mountRef.current) return;

        player = new YT.Player(mountRef.current, {
          // 隱私加強模式。對防盜錄毫無幫助（誠實講），但少一堆追蹤 cookie。
          host: "https://www.youtube-nocookie.com",
          videoId: state.videoId,
          playerVars: {
            rel: 0, // 播完不要跳到別人的影片（2018 起只能限定同頻道，但仍有用）
            playsinline: 1, // iOS 不要強制全螢幕
            cc_lang_pref: "zh-Hant",
            enablejsapi: 1,
            origin: window.location.origin,
            // 刻意不寫 modestbranding：2023-08-15 起已失效，
            // 留著只會讓下一個人以為它有作用。
          },
          events: {
            onReady: (event) => {
              playerRef.current = event.target;
              durationRef.current = event.target.getDuration();
            },
            onStateChange: (event) => {
              const s = event.data;
              try {
                positionRef.current = event.target.getCurrentTime();
                durationRef.current = event.target.getDuration();
              } catch {
                return;
              }

              if (s === YT.PlayerState.PLAYING || s === YT.PlayerState.BUFFERING) {
                startSampling();
                return;
              }

              stopSampling();

              if (s === YT.PlayerState.PAUSED) {
                // 暫停是最常見的「準備離開」動作，立刻送一次
                send({ beacon: false, ended: false });
                lastSentAtRef.current = 0; // 解除節流讓下一次能立刻送
                return;
              }

              if (s === YT.PlayerState.ENDED) {
                send({ ended: true });
                if (!completedRef.current) {
                  completedRef.current = true;
                  onCompleted?.(lessonId);
                }
              }
            },
            onError: () => {
              setState({
                kind: "error",
                message:
                  "這支影片現在播不出來。請用 LINE 跟我們說是哪一堂，我們馬上處理。",
              });
            },
          },
        });
      })
      .catch((err) => {
        console.error("[player] YouTube API", err);
        if (!cancelled) {
          setState({
            kind: "error",
            message: "播放器載入失敗。請檢查網路後重新整理，或用 LINE 跟我們說。",
          });
        }
      });

    return () => {
      cancelled = true;
      stopSampling();
      try {
        player?.destroy();
      } catch {
        // destroy 在 iframe 已經被移除時會丟錯，忽略
      }
      playerRef.current = null;
    };
    // onCompleted 由父層用 useCallback 穩定住；把它放進 deps 會讓
    // 每次父層 re-render 都重建播放器（影片會從頭開始）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind, state.kind === "ready" ? state.videoId : null, send, lessonId]);

  /* ------------------------------------------------------------ 畫面 */

  return (
    <div>
      <div className="relative aspect-video w-full overflow-hidden rounded-card bg-brown-900">
        {state.kind === "ready" ? (
          <>
            <div ref={mountRef} className="h-full w-full" />
            {watermark && (
              // 技術防護 0%，嚇阻與溯源有效。半透明、不吃點擊、
              // 位置在左上角避開 YouTube 的控制列。
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-[10px] left-[12px] rounded bg-black/25 px-[8px] py-[3px] text-[12px] text-white/70 select-none"
              >
                {watermark}
              </span>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center px-[24px] text-center">
            {state.kind === "error" ? (
              <p role="alert" className="text-[17px] leading-relaxed text-white">
                {state.message}
              </p>
            ) : (
              <p className="text-[17px] text-white/80">影片載入中…</p>
            )}
          </div>
        )}
      </div>

      {state.kind === "ready" && resumeChoice === "pending" && (
        <div className="mt-[14px] rounded-card border border-sand-400 bg-cream-100 px-[20px] py-[18px]">
          <p className="t-body text-brown-900">
            你上次看到 {formatClock(state.resumeAt)}。
          </p>
          <div className="mt-[12px] flex flex-col gap-[10px] sm:flex-row">
            <button
              type="button"
              onClick={() => {
                playerRef.current?.seekTo(state.resumeAt, true);
                playerRef.current?.playVideo();
                setResumeChoice("done");
              }}
              className="inline-flex min-h-[56px] flex-1 items-center justify-center rounded-pill bg-caramel-ink px-[28px] text-[18px] text-white hover:bg-caramel-dk"
            >
              從 {formatClock(state.resumeAt)} 繼續看
            </button>
            <button
              type="button"
              onClick={() => {
                playerRef.current?.seekTo(0, true);
                playerRef.current?.playVideo();
                setResumeChoice("done");
              }}
              className="inline-flex min-h-[56px] flex-1 items-center justify-center rounded-pill border-2 border-sand-400 px-[28px] text-[18px] text-brown-900 hover:bg-[#F5E7CE]"
            >
              從頭開始看
            </button>
          </div>
        </div>
      )}

      <h2 className="t-h2 mt-[18px] text-brown-900">{lessonTitle}</h2>
    </div>
  );
}
