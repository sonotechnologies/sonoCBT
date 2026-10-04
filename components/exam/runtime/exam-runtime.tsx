"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAnswered, mergeState, pendingAnswers, secondsLeft, withAnswer, withEvent, type LocalState } from "@/lib/exams/local";
import type { AttemptResponse, RuntimePayload, RuntimeQuestion, SubmitSummary, SyncRequest, SyncResponse } from "@/lib/exams/runtime-types";
import { Calculator } from "./calculator";
import { CalcIcon, Check, Chevron, Contrast, Flag, WifiOff } from "./icons";
import { clearLocal, loadLocal, saveLocal } from "./idb";

type Net = "online" | "offline" | "reconnected" | "signedout";
type Theme = "light" | "dark" | "contrast";

const LETTERS = "ABCDEF";
const HEARTBEAT_MS = 15_000;

function fmt(t: number) {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

function clock(ms: number) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
}

function dateTime(ms: number) {
  const d = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "2-digit", month: "2-digit", year: "numeric" }).format(ms);
  return `${d} · ${clock(ms)}`;
}

function deviceId(): string {
  try {
    let id = localStorage.getItem("sonocbt-device");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("sonocbt-device", id);
    }
    return id;
  } catch {
    return "unknown";
  }
}

function pref<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function savePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private window */
  }
}

/** `preview`: staff trying the exam. Nothing is stored on the device or sent to the server. */
export function ExamRuntime({ payload, preview = false }: { payload: RuntimePayload; preview?: boolean }) {
  const qs = payload.questions;
  const total = qs.length;

  // ── State ────────────────────────────────────────────────────────────────
  const [s, setS] = useState<LocalState>(() => mergeState(payload, null, payload.serverNow));
  const ref = useRef(s);
  const [now, setNow] = useState(payload.serverNow - s.offset);
  const [net, setNetState] = useState<Net>("online");
  const netRef = useRef<Net>("online");
  const setNet = useCallback((n: Net) => {
    netRef.current = n;
    setNetState(n);
  }, []);
  const [saving, setSaving] = useState(false);
  const [synced, setSynced] = useState(0);
  const [lateCount, setLateCount] = useState(0);
  const [dialog, setDialog] = useState<null | "submit" | "help">(null);
  const [sheet, setSheet] = useState<null | "nav" | "passage">(null);
  const [theme, setTheme] = useState<Theme>("light");
  const [scale, setScale] = useState(1);
  const [calc, setCalc] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const [storageOk, setStorageOk] = useState(true);
  const [announce, setAnnounce] = useState("");
  const [blocked, setBlocked] = useState<{ kind: "device" | "network"; message: string } | null>(null);
  const [warning, setWarning] = useState(false);
  const [fs, setFs] = useState<"unknown" | "in" | "out">("unknown");
  const [fsDismissed, setFsDismissed] = useState(false);
  const [camera, setCamera] = useState<"ask" | "on" | "off" | null>(null);
  const rules = payload.exam.integrity;

  const inflight = useRef(false);
  const again = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoff = useRef(2000);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const device = useRef("unknown");
  const warned = useRef<Set<number>>(new Set());

  const commit = useCallback((fn: (s: LocalState) => LocalState) => {
    const next = fn(ref.current);
    ref.current = next;
    setS(next);
    if (preview) return Promise.resolve(next);
    return saveLocal(next).then((ok) => {
      setStorageOk(ok);
      return next;
    });
  }, [preview]);

  // ── Sync ─────────────────────────────────────────────────────────────────
  const flush = useCallback(async () => {
    if (inflight.current) {
      again.current = true;
      return;
    }
    if (ref.current.done) return;
    if (preview) {
      if (ref.current.submitting) {
        const answered = Object.values(ref.current.answers).filter((a) => isAnswered(a.response)).length;
        const done = { submittedAt: Date.now(), answered, total: payload.questions.length, score: null, auto: ref.current.submitting === "timeout", reason: null };
        ref.current = { ...ref.current, done, submitting: null };
        setS(ref.current);
      }
      return;
    }
    inflight.current = true;
    if (retry.current) clearTimeout(retry.current);
    const cur = ref.current;
    const answers = pendingAnswers(cur);
    const body: SyncRequest = {
      attemptId: cur.attemptId,
      deviceSessionId: device.current,
      currentIndex: cur.currentIndex,
      answers,
      events: cur.events,
      submit: !!cur.submitting,
    };
    if (answers.length) setSaving(true);
    const sent = Date.now();
    try {
      const res = await fetch(payload.syncUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 401 || res.status === 403) {
        setNet("signedout");
        return;
      }
      if (res.status === 404) {
        // The invigilator started this attempt again: back to the lobby for a fresh start.
        await clearLocal(cur.attemptId);
        window.location.assign(location.pathname.replace(/\/take$/, ""));
        return;
      }
      const json = (await res.json()) as SyncResponse;
      if (!json.ok) {
        // Open on another computer, or outside the school network: answers stay here; keep checking.
        if (json.blocked) {
          setBlocked({ kind: json.blocked, message: json.error });
          return;
        }
        throw new Error(json.error);
      }
      setBlocked(null);
      const rtt = Date.now() - sent;
      const offset = json.serverNow + rtt / 2 - Date.now();
      await commit((x) => ({
        ...x,
        acked: Math.max(x.acked, json.ackSeq),
        offset,
        seenServerNow: json.serverNow,
        savedAt: answers.length ? json.serverNow : x.savedAt,
        deadlineAt: json.status === "in_progress" ? json.deadlineAt : x.deadlineAt,
        events: x.events.filter((ev) => ev.seq > json.eventAck),
        leaves: json.status === "in_progress" ? json.leaves : x.leaves,
        ...(json.status === "submitted" ? { done: json.summary, submitting: null, answers: {} } : {}),
      }));
      if (json.status === "submitted") {
        setLateCount(json.lateCount);
        setDialog(null);
        void clearLocal(cur.attemptId).then(() =>
          saveLocal({ ...ref.current, answers: {} }), // keep only the summary, so an offline reload still shows "submitted"
        );
        navigator.serviceWorker?.controller?.postMessage({ type: "forget", url: location.href });
      }
      backoff.current = 2000;
      if (netRef.current === "offline") {
        setSynced(answers.length);
        setNet("reconnected");
        setTimeout(() => netRef.current === "reconnected" && setNet("online"), 6000);
      } else if (netRef.current === "signedout") setNet("online");
    } catch {
      if (netRef.current !== "signedout") setNet("offline");
      retry.current = setTimeout(() => void flush(), backoff.current);
      backoff.current = Math.min(backoff.current * 2, 30_000);
    } finally {
      setSaving(false);
      inflight.current = false;
      if (again.current) {
        again.current = false;
        void flush();
      }
    }
  }, [commit, payload.syncUrl, payload.questions.length, preview, setNet]);

  const schedule = useCallback(
    (ms: number) => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => void flush(), ms);
    },
    [flush],
  );

  // ── Boot: merge what this device kept, then push anything pending ────────
  useEffect(() => {
    device.current = deviceId();
    setTheme(pref<Theme>("sonocbt-exam-theme", "light", ["light", "dark", "contrast"]));
    setScale(Number(pref("sonocbt-exam-scale", "1", ["0.85", "0.95", "1", "1.15", "1.3", "1.45"])));
    let cancelled = false;
    if (preview) return;
    void loadLocal(payload.attemptId).then(async (local) => {
      if (cancelled) return;
      const merged = mergeState(payload, local, Date.now());
      await commit(() => merged);
      setNow(Date.now());
      void flush();
    });
    // Let the page reopen offline: register the exam service worker and warm its cache.
    if ("serviceWorker" in navigator) {
      // Marked on the page once every file is cached, so it can reopen offline (tests and support can check it).
      navigator.serviceWorker.addEventListener("message", (ev: MessageEvent<{ type?: string; ok?: boolean }>) => {
        if (ev.data?.type === "warmed") document.documentElement.dataset.offlineReady = ev.data.ok ? "yes" : "partly";
      });
      navigator.serviceWorker.startMessages();
      navigator.serviceWorker
        .register("/exam-sw.js", { scope: "/s/" })
        .then(async () => {
          const reg = await navigator.serviceWorker.ready;
          // Everything the page loaded or refers to, so it can start again with no connection.
          const referenced = [...document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>("script[src], link[href]")].map((el) =>
            "src" in el && el.src ? el.src : (el as HTMLLinkElement).href,
          );
          const urls = [location.href, ...performance.getEntriesByType("resource").map((r) => r.name), ...referenced];
          reg.active?.postMessage({ type: "warm", urls });
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clock, heartbeat, connection events, and a last push when the tab closes.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const beat = setInterval(() => void flush(), HEARTBEAT_MS);
    const online = () => void flush();
    const offline = () => netRef.current !== "signedout" && setNet("offline");
    const visible = () => document.visibilityState === "visible" && void flush();
    const hide = () => {
      if (preview) return;
      const cur = ref.current;
      const answers = pendingAnswers(cur);
      if (!answers.length || cur.done) return;
      try {
        void fetch(payload.syncUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attemptId: cur.attemptId, deviceSessionId: device.current, currentIndex: cur.currentIndex, answers }),
          keepalive: true,
        });
      } catch {
        /* it's on the device; next visit sends it */
      }
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pagehide", hide);
    return () => {
      clearInterval(tick);
      clearInterval(beat);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("pagehide", hide);
    };
  }, [flush, payload.syncUrl, preview, setNet]);

  // ── Integrity: leaving the window, full screen, copy and paste ───────────
  useEffect(() => {
    if (ref.current.done) return;
    let awaySince: number | null = null;
    let lastCopy = 0;
    const record = (ev: Parameters<typeof withEvent>[1]) => {
      if (preview || ref.current.submitting || ref.current.done) return;
      void commit((x) => withEvent(x, ev, Date.now())).then(() => flush());
    };
    const leave = () => {
      if (awaySince === null) awaySince = Date.now();
    };
    const back = () => {
      if (awaySince === null || document.visibilityState !== "visible" || !document.hasFocus()) return;
      const awayMs = Date.now() - awaySince;
      awaySince = null;
      if (awayMs < 1000 || !rules.logTabSwitches) return;
      record({ type: "tab_hidden", awayMs });
      if (rules.warnOnLeave || rules.submitAfterLeaves !== null) setWarning(true);
    };
    const onVisibility = () => (document.visibilityState === "hidden" ? leave() : back());
    const onFs = () => {
      if (document.fullscreenElement) setFs("in");
      else {
        setFs((was) => {
          if (was === "in" && rules.fullscreen !== "off") record({ type: "fullscreen_exit" });
          return "out";
        });
      }
    };
    const block = (e: ClipboardEvent | MouseEvent) => {
      e.preventDefault();
      if (e.type === "contextmenu" || Date.now() - lastCopy < 10_000) return;
      lastCopy = Date.now();
      record({ type: e.type === "paste" ? "paste" : "copy" });
    };
    window.addEventListener("blur", leave);
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFs);
    if (rules.fullscreen !== "off" && document.fullscreenEnabled) setFs(document.fullscreenElement ? "in" : "out");
    const clip = ["copy", "cut", "paste", "contextmenu"] as const;
    if (rules.blockCopy) for (const t of clip) document.addEventListener(t, block as EventListener);
    return () => {
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFs);
      for (const t of clip) document.removeEventListener(t, block as EventListener);
    };
  }, [rules, preview, commit, flush]);

  // ── Identity photos (Strict, with consent) ───────────────────────────────
  const camKey = `sonocbt-cam-${payload.attemptId}`;
  useEffect(() => {
    if (!rules.snapshot || preview || ref.current.done) return;
    const saved = pref<"on" | "off" | "ask">(camKey, "ask", ["on", "off", "ask"]);
    setCamera(saved);
  }, [rules.snapshot, preview, camKey]);
  useEffect(() => {
    if (camera !== "on") return;
    const url = payload.syncUrl.replace(/\/sync$/, `/snapshot?attempt=${payload.attemptId}`);
    const shoot = () =>
      import("./snapshot")
        .then(async (m) => m.sendPhoto(url, await m.capturePhoto()))
        .catch(() => {
          /* camera busy or offline: try again next time */
        });
    void shoot();
    const every = setInterval(() => void shoot(), 10 * 60_000);
    return () => clearInterval(every);
  }, [camera, payload.syncUrl, payload.attemptId]);
  const chooseCamera = (allow: boolean) => {
    savePref(camKey, allow ? "on" : "off");
    setCamera(allow ? "on" : "off");
    if (!allow) void commit((x) => withEvent(x, { type: "snapshot_declined" }, Date.now())).then(() => flush());
  };

  const goFullscreen = () => void document.documentElement.requestFullscreen?.().catch(() => setFs("out"));

  // ── Time ─────────────────────────────────────────────────────────────────
  const left = secondsLeft(s, now);
  const done = s.done;
  useEffect(() => {
    if (done) return;
    for (const mark of [600, 300, 60]) {
      if (left <= mark && left > 0 && !warned.current.has(mark)) {
        warned.current.add(mark);
        setAnnounce(mark === 60 ? "Less than a minute left." : `${mark / 60} minutes left.`);
      }
    }
    if (left === 0 && !ref.current.submitting) {
      void commit((x) => ({ ...x, submitting: "timeout" })).then(() => flush());
    }
  }, [left, done, commit, flush]);

  // ── Answering & moving ───────────────────────────────────────────────────
  const cur = Math.min(s.currentIndex, total - 1);
  const q = qs[cur];
  const ans = s.answers[q?.id];
  const locked = !!s.submitting || !!done;

  const setResponse = useCallback(
    (qid: string, response: AttemptResponse | null, text = false) => {
      if (ref.current.submitting || ref.current.done) return;
      void commit((x) => withAnswer(x, qid, { response })).then(() => schedule(text ? 1200 : 150));
    },
    [commit, schedule],
  );

  const choose = useCallback(
    (question: RuntimeQuestion, optionId: string) => {
      if (question.type === "true_false") return setResponse(question.id, { kind: "bool", value: optionId === "true" });
      const prev = ref.current.answers[question.id]?.response;
      const chosen = prev?.kind === "choice" ? prev.optionIds : [];
      if (question.type === "mcq_multi") {
        const next = chosen.includes(optionId) ? chosen.filter((o) => o !== optionId) : [...chosen, optionId];
        return setResponse(question.id, { kind: "choice", optionIds: next });
      }
      setResponse(question.id, { kind: "choice", optionIds: [optionId] });
    },
    [setResponse],
  );

  const go = useCallback(
    (i: number) => {
      if (i < 0 || i >= total) return;
      setSheet(null);
      setDialog((d) => (d === "submit" ? null : d));
      void commit((x) => ({ ...x, currentIndex: i })).then(() => schedule(2000));
      requestAnimationFrame(() => document.getElementById("exam-question")?.scrollTo({ top: 0 }));
    },
    [commit, schedule, total],
  );

  const toggleFlag = useCallback(() => {
    if (!q || locked) return;
    void commit((x) => withAnswer(x, q.id, { flagged: !x.answers[q.id]?.flagged })).then(() => schedule(400));
  }, [commit, schedule, q, locked]);

  const submit = useCallback(() => {
    void commit((x) => ({ ...x, submitting: "student" })).then(() => flush());
  }, [commit, flush]);

  // ── Keyboard (JAMB convention) ───────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || locked || warning || camera === "ask" || (rules.fullscreen === "required" && fs === "out")) return;
      const el = e.target as HTMLElement;
      const typing = el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && (el as HTMLInputElement).type !== "radio") || el.isContentEditable;
      if (e.key === "Escape") {
        if (dialog || sheet || zoom || calc) {
          setDialog(null);
          setSheet(null);
          setZoom(null);
          setCalc(false);
          e.preventDefault();
        } else if (typing) el.blur();
        return;
      }
      if (typing) return;
      const k = e.key.toLowerCase();
      if (dialog === "submit") {
        if (k === "y") submit();
        else if (k === "r") setDialog(null);
        return;
      }
      if (dialog === "help") {
        if (k === "?" || k === "r") setDialog(null);
        return;
      }
      if (k === "n") go(cur + 1);
      else if (k === "p") go(cur - 1);
      else if (k === "f") toggleFlag();
      else if (k === "s") setDialog("submit");
      else if (e.key === "?") setDialog("help");
      else if (k.length === 1 && "abcde".includes(k) && q && q.options.length) {
        const opt = q.options["abcde".indexOf(k)];
        if (opt) choose(q, opt.id);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, sheet, zoom, calc, locked, warning, camera, fs, rules.fullscreen, cur, q, go, toggleFlag, submit, choose]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const answeredIdx = useMemo(() => qs.map((x) => isAnswered(s.answers[x.id]?.response)), [qs, s.answers]);
  const answered = answeredIdx.filter(Boolean).length;
  const flaggedIdx = qs.map((x, i) => (s.answers[x.id]?.flagged ? i : -1)).filter((i) => i >= 0);
  const unansweredIdx = answeredIdx.map((a, i) => (a ? -1 : i)).filter((i) => i >= 0);
  const pending = pendingAnswers(s).length;
  const passage = q?.passageId ? payload.passages[q.passageId] : null;

  const leavesNow = s.leaves + s.events.filter((ev) => ev.type === "tab_hidden").length;
  const fsRequired = rules.fullscreen === "required" && fs === "out";
  const fsPrompt = rules.fullscreen === "prompt" && fs === "out" && !fsDismissed;
  const tone = left <= 60 ? "danger" : left <= 300 ? "warn" : "normal";
  const pill =
    net === "offline" || net === "signedout"
      ? { icon: <WifiOff />, label: "Saved on this device", cls: "bg-[#EAF1F9] text-[#1D4B80] border-[#C7D9EE]" }
      : saving || pending
        ? { icon: <span aria-hidden className="size-2.5 rounded-full border-2 border-current" />, label: "Saving…", cls: "bg-secondary text-ink-2 border-border" }
        : { icon: <Check />, label: "All answers saved", cls: "bg-[#E8F4EC] text-[#155E34] border-[#C3E2CF]" };

  let banner: { title: string; text: React.ReactNode; cls: string; dot: string } | null = null;
  if (preview)
    banner = { title: "Preview.", text: "This is what students will see. Nothing you do here is saved.", cls: "bg-[#EAF1F9] text-[#1D4B80] border-[#C7D9EE]", dot: "bg-info" };
  else if (net === "signedout")
    banner = {
      title: "You've been signed out.",
      text: (
        <>
          Your answers are safe on this device.{" "}
          <a href={payload.loginUrl} className="font-bold underline">
            Sign in again
          </a>{" "}
          to carry on.
        </>
      ),
      cls: "bg-[#FBEAE9] text-[#8E2019] border-[#F0C4C1]",
      dot: "bg-destructive",
    };
  else if (net === "offline")
    banner = { title: "Offline — your answers are safe on this device.", text: "Keep going. Everything will sync when the connection is back.", cls: "bg-[#EAF1F9] text-[#1D4B80] border-[#C7D9EE]", dot: "bg-info" };
  else if (net === "reconnected")
    banner = { title: "Reconnected — all answers saved.", text: synced ? `${synced} ${synced === 1 ? "answer" : "answers"} synced to the school server.` : "", cls: "bg-[#E8F4EC] text-[#155E34] border-[#C3E2CF]", dot: "bg-success" };
  else if (!storageOk)
    banner = { title: "This browser can't keep answers on the device.", text: "They still save to the school server while you're online. Tell your invigilator if you can.", cls: "bg-[#FDF1E6] text-[#7A3B0A] border-[#F3D3B5]", dot: "bg-warning" };
  else if (tone === "danger")
    banner = { title: "Less than a minute left.", text: "Your answers will be submitted automatically at 00:00.", cls: "bg-[#FBEAE9] text-[#8E2019] border-[#F0C4C1]", dot: "bg-destructive" };
  else if (tone === "warn")
    banner = { title: `${Math.ceil(left / 60)} minutes left.`, text: "Check your flagged questions before time runs out.", cls: "bg-[#FDF1E6] text-[#7A3B0A] border-[#F3D3B5]", dot: "bg-warning" };
  else if (left <= 600)
    banner = { title: "10 minutes left.", text: "Keep an eye on the clock.", cls: "bg-[#FDF1E6] text-[#7A3B0A] border-[#F3D3B5]", dot: "bg-warning" };

  const timerCls = tone === "danger" ? "bg-destructive text-white border-destructive" : tone === "warn" ? "bg-[#FDF1E6] text-[#8A430B] border-warning" : "bg-background text-foreground border-border";
  const qSize = Math.round(20 * scale);
  const optSize = Math.round(18 * scale);

  const changeScale = (d: number) => {
    const steps = [0.85, 0.95, 1, 1.15, 1.3, 1.45];
    const i = Math.max(0, Math.min(steps.length - 1, steps.indexOf(scale) + d));
    setScale(steps[i]);
    savePref("sonocbt-exam-scale", String(steps[i]));
  };
  const cycleTheme = () => {
    const next: Theme = theme === "light" ? "dark" : theme === "dark" ? "contrast" : "light";
    setTheme(next);
    savePref("sonocbt-exam-theme", next);
  };
  const onContentClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "IMG") setZoom((t as HTMLImageElement).src);
  };

  const themeCls = theme === "dark" ? "dark" : theme === "contrast" ? "contrast" : "";
  const nocopy = payload.exam.integrity.blockCopy ? "exam-nocopy" : "";

  // ── Submitted ────────────────────────────────────────────────────────────
  if (done || s.submitting) {
    return (
      <div className={`exam ${themeCls} flex min-h-dvh flex-col items-center justify-center bg-background p-6 text-foreground`}>
        {preview && done ? (
          <div className="flex max-w-[520px] flex-col items-center gap-4 text-center">
            <h1 className="text-[28px] font-extrabold">End of the preview</h1>
            <p className="text-base text-ink-2">
              You answered {done.answered} of {done.total}. Nothing was saved. Students will see the submitted screen here, with their score if the exam shows it.
            </p>
            <a href={payload.homeUrl} className="h-12 rounded-md bg-ink px-5 leading-[48px] font-bold text-white">
              Back to the exam builder
            </a>
          </div>
        ) : (
        <Done summary={done} submitting={s.submitting} net={net} school={payload.school.name} total={total} answered={answered} lateCount={lateCount} homeUrl={payload.homeUrl} loginUrl={payload.loginUrl} onRetry={() => void flush()} />
        )}
      </div>
    );
  }
  if (!q) return null;

  if (blocked) {
    return (
      <div className={`exam ${themeCls} flex min-h-dvh flex-col items-center justify-center bg-background p-6 text-foreground`}>
        <div role="alert" className="flex w-full max-w-[480px] flex-col items-center gap-4 text-center">
          <h1 className="text-[26px] font-extrabold">{blocked.kind === "device" ? "This exam is open on another computer" : "You're not on the school network"}</h1>
          <p className="text-base leading-relaxed text-ink-2">{blocked.message}</p>
          <p className="text-sm text-muted-foreground">Your answers on this device are safe. This page checks again every few seconds.</p>
          <button type="button" onClick={() => void flush()} className="h-12 rounded-md border-[1.5px] border-input bg-card px-5 font-semibold">
            Check again now
          </button>
        </div>
      </div>
    );
  }

  const cellCls = (i: number) => {
    const a = answeredIdx[i];
    const f = s.answers[qs[i].id]?.flagged;
    return [
      "relative rounded-md font-mono text-sm font-semibold transition-colors",
      a ? "bg-foreground text-card" : "bg-card text-foreground",
      f ? "border-2 border-warning" : a ? "border-[1.5px] border-foreground" : "border-[1.5px] border-[var(--ex-cell-line)]",
      i === cur ? "outline-3 outline-offset-2 outline-pencil" : "",
    ].join(" ");
  };
  const cellLabel = (i: number) => `Question ${i + 1}, ${answeredIdx[i] ? "answered" : "not answered"}${s.answers[qs[i].id]?.flagged ? ", flagged" : ""}${i === cur ? ", current" : ""}`;

  const navGrid = (cols: 5 | 6) => (
    <>
      {payload.sections.map((sec, si) => {
        const idx = qs.map((x, i) => (x.sectionIndex === si ? i : -1)).filter((i) => i >= 0);
        if (!idx.length) return null;
        return (
          <div key={si} className="mt-4">
            <div className="mb-2.5 flex justify-between text-xs font-bold tracking-[.06em] text-muted-foreground uppercase">
              <span>{sec.title}</span>
              <span className="font-mono tracking-normal">
                {idx.filter((i) => answeredIdx[i]).length}/{idx.length}
              </span>
            </div>
            <div className={`grid gap-2 ${cols === 5 ? "grid-cols-5" : "grid-cols-6"}`}>
              {idx.map((i) => (
                <button key={i} type="button" onClick={() => go(i)} aria-label={cellLabel(i)} aria-current={i === cur ? "step" : undefined} className={`${cellCls(i)} ${cols === 5 ? "h-11" : "h-12"}`}>
                  {i + 1}
                  {s.answers[qs[i].id]?.flagged && (
                    <span className="absolute -top-1.5 -right-1.5 flex size-[18px] items-center justify-center rounded-full border-2 border-card bg-warning text-white">
                      <Flag size={9} filled />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );

  const legend = (
    <div className="flex flex-col gap-2 text-[13px]">
      <div className="flex items-center gap-2.5">
        <span className="size-4 rounded bg-foreground" />
        <span className="flex-1">Answered</span>
        <span className="font-mono font-semibold">{answered}</span>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="size-4 rounded border-[1.5px] border-[var(--ex-cell-line)] bg-card" />
        <span className="flex-1">Not answered</span>
        <span className="font-mono font-semibold">{total - answered}</span>
      </div>
      <div className="flex items-center gap-2.5">
        <Flag size={16} filled className="text-warning" />
        <span className="flex-1">Flagged</span>
        <span className="font-mono font-semibold">{flaggedIdx.length}</span>
      </div>
    </div>
  );

  const questionBody = (
    <>
      <div className="exam-content rich" style={{ fontSize: qSize, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: q.stemHtml }} onClick={onContentClick} />
      <div className="mt-6 lg:mt-7">
        <Answer q={q} response={ans?.response ?? null} optSize={optSize} onChoose={(id) => choose(q, id)} onText={(text) => setResponse(q.id, { kind: "text", text }, true)} onZoom={onContentClick} />
      </div>
    </>
  );

  const marksLabel = `${q.marks} ${q.marks === 1 ? "mark" : "marks"}`;
  const sectionTitle = payload.sections[q.sectionIndex]?.title;
  const kbd = (k: string, dark = false) => (
    <kbd className={`hidden rounded-[5px] border border-b-2 px-1.5 py-px font-mono text-xs lg:inline ${dark ? "border-[#4A5878] text-[#D6DAE3]" : "border-[var(--ex-key)] text-muted-foreground"}`}>{k}</kbd>
  );

  return (
    <div className={`exam ${themeCls} ${nocopy} flex h-dvh min-h-[560px] flex-col bg-background font-sans text-foreground`}>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      {/* ── Desktop / lab header ── */}
      <header className="hidden h-[72px] flex-none items-center gap-5 border-b border-border bg-card px-6 lg:flex">
        {payload.school.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={payload.school.logoUrl} alt="" className="size-11 flex-none rounded-[10px] border border-border object-contain" />
        ) : (
          <span className="hatch size-11 flex-none rounded-[10px] border border-border" />
        )}
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="truncate text-xs font-medium text-muted-foreground">{[payload.school.name, payload.exam.series ?? payload.exam.title].join(" · ")}</div>
          <h1 className="truncate text-base font-bold">{payload.exam.fullTitle ?? payload.exam.title}</h1>
        </div>
        <div className="flex-1" />
        <div role="status" className={`flex h-[34px] items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold whitespace-nowrap ${pill.cls}`}>
          {pill.icon}
          {pill.label}
        </div>
        <div className={`flex h-[52px] min-w-32 flex-col items-end justify-center rounded-[10px] border px-4 transition-colors ${timerCls}`}>
          <div className="text-[11px] font-semibold tracking-[.06em] uppercase opacity-85">{tone === "danger" ? "Last minute" : "Time left"}</div>
          <div role="timer" aria-label={`Time left ${fmt(left)}`} className="font-mono text-2xl leading-[1.1] font-semibold tabular-nums" suppressHydrationWarning>
            {fmt(left)}
          </div>
        </div>
        <div className="flex items-center gap-3 border-l border-border pl-5">
          {payload.student.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={payload.student.photoUrl} alt="" className="size-11 flex-none rounded-full border border-border object-cover" />
          ) : (
            <span className="hatch size-11 flex-none rounded-full border border-border" />
          )}
          <div className="flex flex-col gap-0.5">
            <div className="text-sm font-bold whitespace-nowrap">{payload.student.name}</div>
            <div className="font-mono text-xs whitespace-nowrap text-muted-foreground">{[payload.student.className, payload.student.admissionNo].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
      </header>

      {/* ── Phone header ── */}
      <header className="flex h-[60px] flex-none items-center gap-2.5 border-b border-border bg-card pr-3 pl-4 lg:hidden">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{payload.exam.title}</div>
          <div role="status" className={`flex items-center gap-1.5 text-xs font-semibold ${net === "offline" || net === "signedout" ? "text-[#1D4B80]" : pending || saving ? "text-ink-2" : "text-success"}`}>
            {net === "offline" || net === "signedout" ? <WifiOff size={13} /> : !pending && !saving ? <Check size={13} /> : null}
            {net === "offline" || net === "signedout" ? "Saved on this phone" : pill.label}
          </div>
        </div>
        <button type="button" onClick={() => changeScale(scale >= 1.3 ? -9 : 1)} aria-label="Text size" className="size-12 flex-none rounded-md border border-border bg-card text-[15px] font-bold">
          Aa
        </button>
        <div role="timer" aria-label={`Time left ${fmt(left)}`} className={`flex h-12 min-w-24 flex-none items-center justify-center rounded-md border px-3 font-mono text-xl font-semibold tabular-nums ${timerCls}`} suppressHydrationWarning>
          {fmt(left)}
        </div>
      </header>

      {banner && (
        <div role="status" className={`flex flex-none items-start gap-3 border-b px-4 py-2.5 text-[13px] leading-snug lg:items-center lg:px-6 lg:py-3 lg:text-sm ${banner.cls}`}>
          <span className={`mt-1.5 size-2 flex-none rounded-full lg:mt-0 lg:size-2.5 ${banner.dot}`} />
          <span>
            <strong className="font-bold">{banner.title}</strong> {banner.text}
          </span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {passage && (
          <aside aria-label="Passage" className="hidden w-[40%] max-w-[560px] flex-none overflow-auto border-r border-border bg-[var(--ex-passage)] px-10 py-9 lg:block">
            <div className="text-xs font-bold tracking-[.08em] text-muted-foreground uppercase">Passage · {passage.label}</div>
            <div className="mt-1.5 text-sm text-muted-foreground">Read the passage carefully and answer the questions that follow.</div>
            <h2 className="font-exam mt-6 mb-4 text-[22px] font-bold">{passage.title}</h2>
            <div className="exam-content rich" style={{ fontSize: Math.round(17 * scale), lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: passage.html }} onClick={onContentClick} />
          </aside>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <div id="exam-question" className="min-h-0 flex-1 overflow-auto px-4 pt-5 pb-6 lg:px-[clamp(16px,4vw,56px)] lg:py-10">
            <div className="mx-auto max-w-[780px]">
              <div className="flex flex-wrap items-center gap-2 lg:gap-3">
                <h2 className="text-xs font-bold tracking-[.08em] whitespace-nowrap uppercase lg:text-[13px]" aria-live="polite">
                  Question {cur + 1} <span className="font-semibold text-muted-foreground">of {total}</span>
                </h2>
                {sectionTitle && <span className="rounded-full bg-chip px-2 py-[3px] text-[11px] font-semibold lg:px-2.5 lg:py-1 lg:text-xs">{sectionTitle}</span>}
                <span className="text-xs font-semibold text-muted-foreground">{marksLabel}</span>
                {ans?.flagged && (
                  <span className="flex items-center gap-1.5 text-xs font-bold text-[#A4520D]">
                    <Flag size={14} filled className="text-warning" />
                    Flagged for review
                  </span>
                )}
                <span className="flex-1" />
                <div className="hidden items-center gap-1 rounded-lg border border-border bg-card p-[3px] lg:flex" role="group" aria-label="Display">
                  <button type="button" onClick={() => changeScale(-1)} aria-label="Smaller text" className="h-[30px] min-w-[38px] rounded-md text-[13px] font-bold hover:bg-secondary">
                    A−
                  </button>
                  <button type="button" onClick={() => changeScale(1)} aria-label="Larger text" className="h-[30px] min-w-[38px] rounded-md text-base font-bold hover:bg-secondary">
                    A+
                  </button>
                  <button type="button" onClick={cycleTheme} aria-label={`Colours: ${theme === "light" ? "light" : theme === "dark" ? "dark" : "high contrast"}. Change`} title="Light, dark or high contrast" className="flex h-[30px] min-w-[38px] items-center justify-center rounded-md hover:bg-secondary">
                    <Contrast />
                  </button>
                  {payload.exam.calculator !== "off" && (
                    <button type="button" onClick={() => setCalc((c) => !c)} aria-pressed={calc} aria-label="Calculator" className="flex h-[30px] min-w-[38px] items-center justify-center rounded-md hover:bg-secondary">
                      <CalcIcon />
                    </button>
                  )}
                  <button type="button" onClick={() => setDialog("help")} aria-label="Keyboard shortcuts" className="h-[30px] min-w-[38px] rounded-md text-base font-bold hover:bg-secondary">
                    ?
                  </button>
                </div>
              </div>

              {passage && (
                <button type="button" onClick={() => setSheet("passage")} className="mt-3.5 flex min-h-14 w-full items-center gap-3 rounded-[10px] border border-border bg-[var(--ex-passage)] px-3.5 py-2.5 text-left lg:hidden">
                  <span className="flex-1">
                    <span className="block text-[11px] font-bold tracking-[.06em] text-muted-foreground uppercase">Passage · {passage.label}</span>
                    <span className="mt-0.5 block text-[15px] font-bold">{passage.title}</span>
                  </span>
                  <span className="text-sm font-bold">Read</span>
                  <Chevron dir="up" size={18} />
                </button>
              )}

              <div className="mt-4 lg:mt-5">{questionBody}</div>

              {/* Phone: display tools under the question */}
              <div className="mt-6 flex gap-2 lg:hidden">
                <button type="button" onClick={cycleTheme} className="flex h-11 items-center gap-2 rounded-md border border-border bg-card px-3 text-[13px] font-semibold">
                  <Contrast size={16} />
                  {theme === "light" ? "Light" : theme === "dark" ? "Dark" : "High contrast"}
                </button>
                {payload.exam.calculator !== "off" && (
                  <button type="button" onClick={() => setCalc((c) => !c)} aria-pressed={calc} className="flex h-11 items-center gap-2 rounded-md border border-border bg-card px-3 text-[13px] font-semibold">
                    <CalcIcon size={16} />
                    Calculator
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Desktop footer */}
          <div className="hidden h-20 flex-none items-center gap-3 border-t border-border bg-card px-[clamp(16px,4vw,56px)] lg:flex">
            <button type="button" onClick={() => go(cur - 1)} disabled={cur === 0} className="flex h-12 items-center gap-2.5 rounded-md border-[1.5px] border-input bg-card pr-[18px] pl-3 text-[15px] font-semibold hover:border-foreground disabled:opacity-45">
              <Chevron dir="left" />
              Previous {kbd("P")}
            </button>
            <button type="button" onClick={toggleFlag} aria-pressed={!!ans?.flagged} className={`flex h-12 items-center gap-2.5 rounded-md border-[1.5px] pr-[18px] pl-3.5 text-[15px] font-semibold ${ans?.flagged ? "border-warning bg-[#FDF1E6] text-[#8A430B]" : "border-input bg-card"}`}>
              <Flag size={18} filled={!!ans?.flagged} className={ans?.flagged ? "text-warning" : undefined} />
              {ans?.flagged ? "Flagged" : "Flag"} {kbd("F")}
            </button>
            <div className="min-w-0 flex-1 truncate text-right text-[13px] text-muted-foreground">
              {q.options.length ? `Press A–${LETTERS[Math.min(q.options.length, 5) - 1]} to choose an answer · ? for all shortcuts` : "Press Esc to leave the box and use shortcuts"}
            </div>
            <button type="button" onClick={() => go(cur + 1)} disabled={cur === total - 1} className="flex h-12 items-center gap-2.5 rounded-md border-[1.5px] border-ink bg-ink pr-3 pl-[22px] text-[15px] font-bold text-white hover:bg-[#223255] disabled:opacity-45">
              Next {kbd("N", true)}
              <Chevron dir="right" />
            </button>
          </div>

          {/* Phone bottom bar */}
          <div className="grid flex-none grid-cols-4 gap-2 border-t border-border bg-card px-3 pt-2.5 pb-3.5 lg:hidden">
            <button type="button" onClick={() => go(cur - 1)} disabled={cur === 0} aria-label="Previous question" className="flex h-[52px] flex-col items-center justify-center gap-0.5 rounded-md border-[1.5px] border-input bg-card text-[11px] font-semibold disabled:opacity-45">
              <Chevron dir="left" />
              Prev
            </button>
            <button type="button" onClick={toggleFlag} aria-pressed={!!ans?.flagged} className={`flex h-[52px] flex-col items-center justify-center gap-0.5 rounded-md border-[1.5px] text-[11px] font-semibold ${ans?.flagged ? "border-warning bg-[#FDF1E6] text-[#8A430B]" : "border-input bg-card"}`}>
              <Flag size={18} filled={!!ans?.flagged} className={ans?.flagged ? "text-warning" : undefined} />
              {ans?.flagged ? "Flagged" : "Flag"}
            </button>
            <button type="button" onClick={() => setSheet("nav")} aria-label="Open question navigator" className="flex h-[52px] flex-col items-center justify-center gap-0.5 rounded-md border-[1.5px] border-input bg-card">
              <span className="font-mono text-[15px] font-semibold">
                {answered}/{total}
              </span>
              <span className="text-[11px] font-semibold">Questions</span>
            </button>
            <button type="button" onClick={() => go(cur + 1)} disabled={cur === total - 1} aria-label="Next question" className="flex h-[52px] flex-col items-center justify-center gap-0.5 rounded-md border-[1.5px] border-ink bg-ink text-[11px] font-bold text-white disabled:opacity-45">
              <Chevron dir="right" />
              Next
            </button>
          </div>
        </main>

        {/* Desktop navigator */}
        <aside aria-label="Question navigator" className="hidden w-80 flex-none flex-col border-l border-border bg-card lg:flex">
          <div className="border-b border-divider px-6 pt-[22px] pb-4">
            <div className="text-[15px] font-bold">Question navigator</div>
            <div className="mt-3.5">{legend}</div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-6 pt-2 pb-5">{navGrid(5)}</div>
          <div className="flex flex-col gap-2.5 border-t border-divider px-6 pt-4 pb-5">
            <button type="button" onClick={() => setDialog("submit")} className="flex h-[52px] items-center justify-center gap-2.5 rounded-md bg-pencil text-base font-extrabold text-ink hover:bg-[#E0A800]">
              Submit exam
              <kbd className="rounded-[5px] border border-b-2 border-[#B88C00] px-1.5 py-px font-mono text-xs">S</kbd>
            </button>
            <p className="text-center text-xs text-muted-foreground">You&apos;ll see a summary before anything is submitted.</p>
          </div>
        </aside>
      </div>

      {calc && payload.exam.calculator !== "off" && (
        <div className="fixed right-4 bottom-24 z-20 lg:right-[340px] lg:bottom-24">
          <Calculator mode={payload.exam.calculator} onClose={() => setCalc(false)} />
        </div>
      )}

      {/* Phone sheets */}
      {sheet === "nav" && (
        <div className="fixed inset-0 z-10 flex flex-col justify-end bg-[rgba(20,33,61,.45)] lg:hidden">
          <button type="button" aria-label="Close" className="flex-1" onClick={() => setSheet(null)} />
          <div role="dialog" aria-modal="true" aria-label="Question navigator" className="flex max-h-[82%] flex-col rounded-t-2xl bg-card">
            <div className="flex justify-center pt-2.5 pb-1">
              <span className="h-1 w-10 rounded-sm bg-[var(--ex-key)]" />
            </div>
            <div className="flex items-center pt-1 pr-3 pb-3 pl-5">
              <div className="flex-1 text-base font-bold">Questions</div>
              <button type="button" onClick={() => setSheet(null)} className="h-11 px-3.5 text-sm font-bold">
                Close
              </button>
            </div>
            <div className="flex gap-4 border-b border-divider px-5 pb-3 text-xs text-ink-2">
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-[3px] bg-foreground" />
                {answered} answered
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-[3px] border-[1.5px] border-[var(--ex-cell-line)]" />
                {total - answered} left
              </span>
              <span className="flex items-center gap-1.5">
                <Flag size={12} filled className="text-warning" />
                {flaggedIdx.length} flagged
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-5 pt-1 pb-4">{navGrid(6)}</div>
            <div className="border-t border-divider px-5 pt-3 pb-[18px]">
              <button type="button" onClick={() => { setSheet(null); setDialog("submit"); }} className="h-[52px] w-full rounded-md bg-pencil text-base font-extrabold text-ink">
                Review &amp; submit
              </button>
            </div>
          </div>
        </div>
      )}
      {sheet === "passage" && passage && (
        <div className="fixed inset-0 z-10 flex flex-col justify-end bg-[rgba(20,33,61,.45)] lg:hidden">
          <button type="button" aria-label="Close" className="h-14 flex-none" onClick={() => setSheet(null)} />
          <div role="dialog" aria-modal="true" aria-label="Passage" className="flex min-h-0 flex-1 flex-col rounded-t-2xl bg-[var(--ex-passage)]">
            <div className="flex justify-center pt-2.5 pb-1">
              <span className="h-1 w-10 rounded-sm bg-[var(--ex-key)]" />
            </div>
            <div className="flex items-center border-b border-border pr-3 pb-2 pl-5">
              <div className="flex-1 text-[11px] font-bold tracking-[.06em] text-muted-foreground uppercase">Passage · {passage.label}</div>
              <button type="button" onClick={() => setSheet(null)} className="h-11 px-3.5 text-sm font-bold">
                Back to question
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-5 pt-4 pb-6">
              <h2 className="font-exam mb-3 text-xl font-bold">{passage.title}</h2>
              <div className="exam-content rich" style={{ fontSize: Math.round(17 * scale), lineHeight: 1.65 }} dangerouslySetInnerHTML={{ __html: passage.html }} onClick={onContentClick} />
            </div>
          </div>
        </div>
      )}

      {dialog === "submit" && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-[rgba(20,33,61,.5)] p-4 lg:p-6">
          <div role="dialog" aria-modal="true" aria-labelledby="sub-title" className="max-h-full w-full max-w-[560px] overflow-auto rounded-2xl bg-card p-6 shadow-[0_24px_60px_rgba(20,33,61,.25)] lg:p-8">
            <h2 id="sub-title" className="text-2xl font-extrabold">
              Submit your exam?
            </h2>
            <p className="mt-2 mb-6 text-[15px] leading-normal text-ink-2">
              Once you submit, you can&apos;t change your answers. You still have <strong className="font-mono">{fmt(left)}</strong> left.
            </p>
            <div className="grid grid-cols-3 gap-3">
              {[
                [answered, "Answered"],
                [total - answered, "Not answered"],
                [flaggedIdx.length, "Flagged"],
              ].map(([n, l]) => (
                <div key={l} className="rounded-[10px] border border-border bg-background p-4">
                  <div className="font-mono text-[28px] font-semibold">{n}</div>
                  <div className="text-[13px] text-ink-2">{l}</div>
                </div>
              ))}
            </div>
            {unansweredIdx.length > 0 && (
              <div className="mt-5">
                <div className="mb-2 text-[13px] font-bold">Not answered — tap to go there</div>
                <div className="flex flex-wrap gap-2">
                  {unansweredIdx.map((i) => (
                    <button key={i} type="button" onClick={() => go(i)} className="h-9 min-w-11 rounded-md border-[1.5px] border-[var(--ex-cell-line)] bg-card px-2.5 font-mono text-sm font-semibold hover:border-foreground">
                      {i + 1}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {flaggedIdx.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 text-[13px] font-bold">Flagged for review</div>
                <div className="flex flex-wrap gap-2">
                  {flaggedIdx.map((i) => (
                    <button key={i} type="button" onClick={() => go(i)} className="flex h-9 items-center gap-1.5 rounded-md border-[1.5px] border-warning bg-[#FDF1E6] px-2.5 font-mono text-sm font-semibold text-ink">
                      <Flag size={12} filled className="text-warning" />
                      {i + 1}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-7 flex flex-wrap justify-end gap-3">
              <button type="button" onClick={() => setDialog(null)} autoFocus className="flex h-12 items-center gap-2.5 rounded-md border-[1.5px] border-input bg-card px-[18px] text-[15px] font-semibold">
                Keep working {kbd("R")}
              </button>
              <button type="button" onClick={submit} className="flex h-12 items-center gap-2.5 rounded-md bg-ink px-5 text-[15px] font-bold text-white">
                Yes, submit {kbd("Y", true)}
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog === "help" && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-[rgba(20,33,61,.5)] p-4" onClick={() => setDialog(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="help-title" className="w-full max-w-md rounded-2xl bg-card p-6" onClick={(e) => e.stopPropagation()}>
            <h2 id="help-title" className="text-xl font-extrabold">
              Keyboard shortcuts
            </h2>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-[15px]">
              {[
                ["A – E", "Choose an option"],
                ["N", "Next question"],
                ["P", "Previous question"],
                ["F", "Flag for review"],
                ["S", "Open the submit summary"],
                ["Y", "Yes, submit (in the summary)"],
                ["R", "Return from the summary"],
                ["Esc", "Close, or leave a typing box"],
                ["?", "Show these shortcuts"],
              ].map(([k, d]) => (
                <div key={k} className="contents">
                  <dt>
                    <kbd className="rounded-[5px] border border-b-2 border-[var(--ex-key)] px-2 py-px font-mono text-sm">{k}</kbd>
                  </dt>
                  <dd>{d}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-[13px] text-muted-foreground">Letters don&apos;t work while you&apos;re typing an answer. Press Esc first.</p>
            <button type="button" onClick={() => setDialog(null)} autoFocus className="mt-5 h-11 w-full rounded-md bg-ink text-[15px] font-bold text-white">
              Back to the exam
            </button>
          </div>
        </div>
      )}

      {fsPrompt && !dialog && (
        <div role="status" className="fixed inset-x-0 bottom-24 z-20 mx-auto flex w-[min(92vw,520px)] items-center gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-lg lg:bottom-28">
          <span className="flex-1">Full screen helps you concentrate. Your school asks for it in this exam.</span>
          <button type="button" onClick={goFullscreen} className="h-10 rounded-md bg-pencil px-3 font-bold text-ink">
            Go full screen
          </button>
          <button type="button" onClick={() => setFsDismissed(true)} className="h-10 rounded-md px-2 font-semibold text-on-ink-muted">
            Not now
          </button>
        </div>
      )}

      {fsRequired && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background p-6" role="dialog" aria-modal="true" aria-labelledby="fs-title">
          <div className="flex max-w-[460px] flex-col items-center gap-4 text-center">
            <h2 id="fs-title" className="text-2xl font-extrabold">
              This exam runs in full screen
            </h2>
            <p className="text-base leading-relaxed text-ink-2">Your school requires it. Leaving full screen is recorded. Your answers and time are safe.</p>
            <button type="button" onClick={goFullscreen} autoFocus className="h-14 rounded-md bg-pencil px-7 text-base font-extrabold text-ink">
              Go full screen
            </button>
          </div>
        </div>
      )}

      {camera === "ask" && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(20,33,61,.5)] p-4">
          <div role="alertdialog" aria-modal="true" aria-labelledby="cam-title" className="w-full max-w-md rounded-2xl bg-card p-6">
            <h2 id="cam-title" className="text-xl font-extrabold">
              A photo to check it&apos;s you
            </h2>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
              Your school takes a small photo from your camera now and every 10 minutes during this exam. Only your invigilator and exam officer can see them, and they&apos;re deleted after 30 days.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button type="button" onClick={() => chooseCamera(true)} autoFocus className="h-12 rounded-md bg-ink text-[15px] font-bold text-white">
                Allow the camera
              </button>
              <button type="button" onClick={() => chooseCamera(false)} className="h-12 rounded-md border-[1.5px] border-input bg-card text-[15px] font-semibold">
                No thanks (this is recorded)
              </button>
            </div>
          </div>
        </div>
      )}

      {warning && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(20,33,61,.5)] p-4">
          <div role="alertdialog" aria-modal="true" aria-labelledby="leave-title" className="w-full max-w-md rounded-2xl bg-card p-6">
            <h2 id="leave-title" className="text-xl font-extrabold">
              You left the exam window
            </h2>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
              This has been recorded for your invigilator
              {rules.submitAfterLeaves !== null ? (
                <>
                  {" "}
                  ({leavesNow} of {rules.submitAfterLeaves}). If it happens {rules.submitAfterLeaves} times, your exam is submitted automatically.
                </>
              ) : (
                "."
              )}{" "}
              Stay on this page until you finish.
            </p>
            <button type="button" onClick={() => setWarning(false)} autoFocus className="mt-5 h-12 w-full rounded-md bg-ink text-[15px] font-bold text-white">
              Back to the exam
            </button>
          </div>
        </div>
      )}

      {zoom && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(20,33,61,.8)] p-4" onClick={() => setZoom(null)} role="dialog" aria-modal="true" aria-label="Picture, enlarged">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="" className="max-h-full max-w-full rounded-lg bg-white" />
          <button type="button" onClick={() => setZoom(null)} autoFocus className="absolute top-4 right-4 h-11 rounded-md bg-card px-4 text-sm font-bold">
            Close
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Answer area ────────────────────────────────────────────────────────────

function Answer({
  q,
  response,
  optSize,
  onChoose,
  onText,
  onZoom,
}: {
  q: RuntimeQuestion;
  response: AttemptResponse | null;
  optSize: number;
  onChoose: (optionId: string) => void;
  onText: (text: string) => void;
  onZoom: (e: React.MouseEvent) => void;
}) {
  if (q.options.length) {
    const selected = (id: string) =>
      response?.kind === "choice" ? response.optionIds.includes(id) : response?.kind === "bool" ? String(response.value) === id : false;
    const multi = q.type === "mcq_multi";
    return (
      <div role={multi ? "group" : "radiogroup"} aria-label={multi ? "Choose all that apply" : "Choose one answer"} className="flex flex-col gap-2.5 lg:gap-3">
        {multi && <p className="text-[13px] font-semibold text-muted-foreground">Choose all that apply.</p>}
        {q.options.map((o, i) => {
          const sel = selected(o.id);
          return (
            <button
              key={o.id}
              type="button"
              role={multi ? "checkbox" : "radio"}
              aria-checked={sel}
              onClick={() => onChoose(o.id)}
              className={`flex min-h-[60px] w-full items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-left transition-colors hover:border-foreground lg:min-h-16 lg:gap-[18px] lg:px-5 lg:py-3 ${sel ? "border-2 border-foreground bg-[var(--ex-sel)]" : "border-[1.5px] border-[var(--ex-opt-line)] bg-card"}`}
            >
              <span
                className={`flex size-9 flex-none items-center justify-center border-2 text-sm font-extrabold transition-colors lg:size-[38px] lg:text-[15px] ${multi ? "rounded-md" : "rounded-full"} ${sel ? "border-ink bg-pencil text-ink" : "border-[var(--ex-bubble-line)] bg-card"}`}
              >
                {LETTERS[i]}
              </span>
              <span className="exam-content rich min-w-0 flex-1" style={{ fontSize: optSize, lineHeight: 1.45 }} dangerouslySetInnerHTML={{ __html: o.html }} onClick={onZoom} />
            </button>
          );
        })}
      </div>
    );
  }
  const text = response?.kind === "text" ? response.text : "";
  if (q.type === "theory") {
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return (
      <div className="flex flex-col gap-2.5">
        <label htmlFor={`a-${q.id}`} className="text-[13px] font-semibold text-muted-foreground">
          Your answer
        </label>
        <textarea
          id={`a-${q.id}`}
          value={text}
          onChange={(e) => onText(e.target.value)}
          maxLength={20000}
          placeholder="Type your answer here. Number your points if you can."
          className="font-exam min-h-[300px] w-full resize-y rounded-xl border-[1.5px] border-input bg-card p-5 leading-relaxed text-foreground"
          style={{ fontSize: optSize }}
        />
        <div className="flex justify-between text-[13px] text-muted-foreground">
          <span className="font-mono">{words} words</span>
          <span>Saved as you type</span>
        </div>
      </div>
    );
  }
  return (
    <div className="flex max-w-md flex-col gap-2.5">
      <label htmlFor={`a-${q.id}`} className="text-[13px] font-semibold text-muted-foreground">
        {q.type === "numeric" ? "Your answer (a number)" : "Your answer"}
      </label>
      <input
        id={`a-${q.id}`}
        value={text}
        onChange={(e) => onText(e.target.value)}
        maxLength={200}
        inputMode={q.type === "numeric" ? "decimal" : "text"}
        autoComplete="off"
        spellCheck={q.type !== "numeric"}
        className="font-exam h-14 w-full rounded-xl border-[1.5px] border-input bg-card px-4 text-foreground"
        style={{ fontSize: optSize }}
      />
      {q.type === "numeric" && <span className="text-[13px] text-muted-foreground">Fractions like 3/4 are fine.</span>}
    </div>
  );
}

// ─── Finished ───────────────────────────────────────────────────────────────

function Done({
  summary,
  submitting,
  net,
  school,
  total,
  answered,
  lateCount,
  homeUrl,
  loginUrl,
  onRetry,
}: {
  summary: SubmitSummary | null;
  submitting: "student" | "timeout" | null;
  net: Net;
  school: string;
  total: number;
  answered: number;
  lateCount: number;
  homeUrl: string;
  loginUrl: string;
  onRetry: () => void;
}) {
  if (!summary) {
    return (
      <div className="flex w-full max-w-[520px] flex-col items-center gap-4 text-center" role="status">
        <h1 className="text-[28px] font-extrabold">{submitting === "timeout" ? "Time is up" : "Submitting your exam…"}</h1>
        {net === "offline" || net === "signedout" ? (
          <>
            <p className="text-base leading-relaxed text-ink-2">
              Your {answered} {answered === 1 ? "answer is" : "answers are"} saved on this device. They&apos;ll be sent to {school} as soon as the connection is back. Don&apos;t close this page, and tell your invigilator.
            </p>
            {net === "signedout" ? (
              <a href={loginUrl} className="h-12 rounded-md bg-ink px-5 leading-[48px] font-bold text-white">
                Sign in again to send them
              </a>
            ) : (
              <button type="button" onClick={onRetry} className="h-12 rounded-md border-[1.5px] border-input bg-card px-5 font-semibold">
                Try again now
              </button>
            )}
          </>
        ) : (
          <p className="text-base text-ink-2">Sending your answers to {school}. This only takes a moment.</p>
        )}
      </div>
    );
  }
  return (
    <div className="flex w-full max-w-[520px] flex-col items-center gap-4 text-center">
      <div className="flex size-[72px] items-center justify-center rounded-full bg-success text-white">
        <Check size={36} />
      </div>
      <h1 className="mt-2 text-[30px] font-extrabold">Your exam has been submitted</h1>
      <p className="text-base leading-relaxed text-ink-2">
        {summary.reason === "integrity"
          ? "You left the exam window too many times, so your exam was submitted. "
          : summary.reason === "staff"
            ? "Your invigilator submitted your exam. "
            : summary.auto
              ? "Time ran out, so your exam was submitted for you. "
              : ""}
        All your answers were received by {school}.{summary.score ? "" : " Your results will be released by your school."}
      </p>
      {lateCount > 0 && (
        <p className="rounded-md bg-[#FDF1E6] p-3 text-sm text-[#7A3B0A]">
          {lateCount} {lateCount === 1 ? "answer" : "answers"} reached the school after time ran out. They&apos;ve been kept for your exam officer to look at.
        </p>
      )}
      <div className={`mt-2 grid w-full rounded-xl border border-border bg-card ${summary.score ? "grid-cols-3" : "grid-cols-2"}`}>
        <div className="border-r border-border p-4">
          <div className="text-xs text-muted-foreground">Submitted</div>
          <div className="mt-1 font-mono text-base font-semibold">{dateTime(summary.submittedAt)}</div>
        </div>
        <div className={`p-4 ${summary.score ? "border-r border-border" : ""}`}>
          <div className="text-xs text-muted-foreground">Questions answered</div>
          <div className="mt-1 font-mono text-base font-semibold">
            {summary.answered} of {summary.total || total}
          </div>
        </div>
        {summary.score && (
          <div className="p-4">
            <div className="text-xs text-muted-foreground">Your score</div>
            <div className="mt-1 font-mono text-base font-semibold">
              {summary.score.score} / {summary.score.max}
            </div>
          </div>
        )}
      </div>
      <p className="text-sm text-muted-foreground">Please stay seated until the invigilator tells you to leave.</p>
      <a href={homeUrl} className="text-sm font-semibold underline">
        Back to home
      </a>
    </div>
  );
}
