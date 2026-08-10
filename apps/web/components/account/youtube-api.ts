"use client";

/**
 * YouTube IFrame Player API 的載入器。
 *
 * ⚠️ 刻意**不用** next/script。
 *
 * YouTube 的 API 靠一個一次性的全域 callback `onYouTubeIframeAPIReady`
 * 通知「可以用了」。把它跟 next/script 的 onReady、再加上 React 19
 * StrictMode 的 double-effect 混在一起，會變成三個生命週期互相踩，
 * 很難推理也很難重現 bug。這裡改成一個 module-level 的 promise：
 * 不管有幾個元件、mount 幾次，script 只會插一次，大家 await 同一個 promise。
 *
 * 另外兩件容易寫錯的事：
 * 1. **不覆蓋別人已掛的 callback**。萬一之後有第二個地方也用 YouTube API，
 *    直接指派會把對方的 handler 蓋掉，而且是靜默失效。
 * 2. script 必須從 www.youtube.com 載入，即使播放器本身用
 *    youtube-nocookie.com 當 host。這是官方的已知限制，不是我們寫錯。
 */

/** YouTube 播放器實例。只宣告我們真的會用到的部分。 */
export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
}

export interface YTNamespace {
  Player: new (
    element: HTMLElement | string,
    options: {
      host?: string;
      videoId?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (event: { target: YTPlayer }) => void;
        onStateChange?: (event: { data: number; target: YTPlayer }) => void;
        onError?: (event: { data: number }) => void;
      };
    },
  ) => YTPlayer;
  PlayerState: {
    UNSTARTED: -1;
    ENDED: 0;
    PLAYING: 1;
    PAUSED: 2;
    BUFFERING: 3;
    CUED: 5;
  };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const SCRIPT_ID = "yt-iframe-api";
let loader: Promise<YTNamespace> | null = null;

export function loadYouTubeApi(): Promise<YTNamespace> {
  if (loader) return loader;

  loader = new Promise<YTNamespace>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("loadYouTubeApi 只能在瀏覽器呼叫"));
      return;
    }

    // 已經載好了（例如上一頁載過、SPA 導覽過來）
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }

    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube API 載入了但 YT.Player 不存在"));
    };

    if (!document.getElementById(SCRIPT_ID)) {
      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      // 一定要 www.youtube.com。用 youtube-nocookie.com 載這支 script 會 404，
      // 隱私加強模式是設在 Player 的 host 選項上，不是 script 來源。
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => {
        // 失敗時把 loader 清掉，下次進教室可以重試（例如網路剛剛斷線）
        loader = null;
        reject(new Error("YouTube API 載入失敗"));
      };
      document.head.appendChild(script);
    }
  });

  return loader;
}

/** 秒 → 「12:34」／「1:02:03」。播放器與進度提示共用。 */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
