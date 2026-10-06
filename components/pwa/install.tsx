"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

/**
 * Installing SonoCBT as an app. Chrome, Edge and Samsung Internet hand us an
 * install prompt (beforeinstallprompt) that we keep for the button; iPhone and
 * iPad have no prompt, so the button explains Share → Add to Home Screen.
 */
type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: PromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function standalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
function isIos() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

/** In the root layout: registers the app service worker and keeps the install prompt for later. */
export function PwaSetup() {
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferred = e as PromptEvent;
      emit();
    };
    const onInstalled = () => {
      installed = true;
      deferred = null;
      emit();
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}

type Mode = "none" | "prompt" | "ios";

function useInstallMode(): Mode {
  // False during server render and hydration, true after: browser checks only run on the client.
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const hasPrompt = useSyncExternalStore(subscribe, () => !!deferred && !installed, () => false);
  if (!mounted || installed || standalone()) return "none";
  if (hasPrompt) return "prompt";
  return isIos() ? "ios" : "none";
}

/**
 * "Install the app" — renders nothing when the app is already installed or the
 * browser can't install it. `tone="ink"` sits on the dark staff sidebar.
 */
export function InstallAppButton({ className, tone = "light", label = "Install the app" }: { className?: string; tone?: "light" | "ink" | "plain"; label?: string }) {
  const mode = useInstallMode();
  const [help, setHelp] = useState(false);
  if (mode === "none") return null;

  const install = async () => {
    if (mode === "ios") return setHelp(true);
    const e = deferred;
    if (!e) return;
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome === "accepted") installed = true;
    deferred = null;
    emit();
  };

  return (
    <>
      <button
        type="button"
        onClick={install}
        className={cn(
          "inline-flex h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-bold",
          tone === "ink" && "w-full bg-ink-raised text-white hover:bg-ink-active",
          tone === "light" && "border-[1.5px] border-input bg-card text-foreground hover:border-ink",
          tone === "plain" && "px-0 font-semibold text-foreground underline underline-offset-2",
          className,
        )}
      >
        {tone !== "plain" && (
          <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="6" y="2" width="12" height="20" rx="2.5" />
            <path d="M12 7v7m-3-3 3 3 3-3" />
          </svg>
        )}
        {label}
      </button>
      {help && <IosHelp onClose={() => setHelp(false)} />}
    </>
  );
}

function IosHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-3 sm:items-center" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="ios-install" className="w-full max-w-[420px] rounded-2xl bg-card p-5 text-left text-foreground shadow-[0_24px_60px_rgba(20,33,61,.25)] [animation:fade-in_.15s_ease-out]">
        <h2 id="ios-install" className="text-lg font-extrabold">
          Add SonoCBT to your Home Screen
        </h2>
        <ol className="mt-3 flex flex-col gap-3 text-[15px] text-ink-2">
          <li className="flex items-center gap-3">
            <span className="flex size-7 flex-none items-center justify-center rounded-full bg-ink text-xs font-bold text-white">1</span>
            <span>
              Tap the <b className="text-foreground">Share</b> button
              <svg aria-label="Share" className="mx-1 inline align-[-3px]" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v12m-4-8 4-4 4 4" />
                <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
              </svg>
              in Safari.
            </span>
          </li>
          <li className="flex items-center gap-3">
            <span className="flex size-7 flex-none items-center justify-center rounded-full bg-ink text-xs font-bold text-white">2</span>
            <span>
              Choose <b className="text-foreground">Add to Home Screen</b>, then <b className="text-foreground">Add</b>.
            </span>
          </li>
        </ol>
        <p className="mt-3 text-[13px] text-muted-foreground">SonoCBT then opens from its own icon, full screen, like any other app.</p>
        <button type="button" onClick={onClose} className="mt-4 h-11 w-full rounded-md bg-ink text-[15px] font-bold text-white">
          Got it
        </button>
      </div>
    </div>
  );
}
