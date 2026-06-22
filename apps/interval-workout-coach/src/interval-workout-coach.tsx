import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  Settings2,
  X,
  Minus,
  Plus,
  Volume2,
  VolumeX,
  Smartphone,
  Zap,
  Dumbbell,
  Coffee,
  Flag,
} from "lucide-react";

/* ------------------------------------------------------------------ *
 * Model
 * ------------------------------------------------------------------ */

type Phase = "prepare" | "work" | "rest" | "setrest" | "done";

interface Settings {
  prepare: number; // seconds
  work: number; // seconds
  rest: number; // seconds
  rounds: number; // work/rest rounds per set
  sets: number; // number of cycles
  setRest: number; // seconds, longer rest between sets
  sound: boolean;
  vibrate: boolean;
  wake: boolean;
}

const DEFAULTS: Settings = {
  prepare: 10,
  work: 30,
  rest: 15,
  rounds: 8,
  sets: 1,
  setRest: 60,
  sound: true,
  vibrate: true,
  wake: true,
};

const STORAGE_KEY = "interval-workout-coach:v1";

/* A single timeline segment. */
interface Segment {
  phase: Exclude<Phase, "done">;
  dur: number; // seconds
  round: number; // 1-based round within the set (0 for prepare/setrest)
  set: number; // 1-based set
}

// Phase identity: label, color, icon-key.
const PHASE_META: Record<
  Phase,
  { label: string; accent: string; deep: string; icon: "zap" | "work" | "rest" | "flag" }
> = {
  prepare: { label: "PREPARE", accent: "#f5b21a", deep: "#3a2a05", icon: "zap" },
  work: { label: "WORK", accent: "#ff1f6b", deep: "#3d0418", icon: "work" },
  rest: { label: "REST", accent: "#19e3c0", deep: "#03332b", icon: "rest" },
  setrest: { label: "SET BREAK", accent: "#22b8ff", deep: "#04263a", icon: "rest" },
  done: { label: "DONE", accent: "#a3ff3c", deep: "#192f04", icon: "flag" },
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function formatTime(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Build the flat workout timeline from settings. */
function buildTimeline(s: Settings): Segment[] {
  const segs: Segment[] = [];
  if (s.prepare > 0) {
    segs.push({ phase: "prepare", dur: s.prepare, round: 0, set: 1 });
  }
  for (let set = 1; set <= s.sets; set++) {
    for (let round = 1; round <= s.rounds; round++) {
      segs.push({ phase: "work", dur: s.work, round, set });
      const isLastRound = round === s.rounds;
      const isLastSet = set === s.sets;
      if (!isLastRound && s.rest > 0) {
        segs.push({ phase: "rest", dur: s.rest, round, set });
      } else if (isLastRound && !isLastSet && s.setRest > 0) {
        segs.push({ phase: "setrest", dur: s.setRest, round, set });
      }
    }
  }
  return segs;
}

interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: "release", cb: () => void): void;
}
interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}
function getWakeLock(): WakeLockLike | undefined {
  return (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
}

function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(pattern);
    }
  } catch {
    /* unsupported — ignore */
  }
}

/** Web Audio beeps. `kind`: "tick" (countdown), "go" (work), "ease" (rest/prepare), "finish". */
function beep(
  kind: "tick" | "go" | "ease" | "finish",
  ctxRef: { current: AudioContext | null }
) {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return;
  if (!ctxRef.current) {
    try {
      ctxRef.current = new Ctx();
    } catch {
      return;
    }
  }
  const ctx = ctxRef.current;
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const t0 = ctx.currentTime;

  const tone = (freq: number, start: number, len: number, peak: number, type: OscillatorType) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0008, start + len);
    osc.start(start);
    osc.stop(start + len + 0.02);
  };

  if (kind === "tick") {
    tone(880, t0, 0.09, 0.18, "square");
  } else if (kind === "go") {
    // bright rising two-note "GO" blast
    tone(660, t0, 0.16, 0.28, "sawtooth");
    tone(990, t0 + 0.12, 0.34, 0.3, "sawtooth");
  } else if (kind === "ease") {
    // soft descending pair into rest
    tone(523.25, t0, 0.2, 0.22, "sine");
    tone(392, t0 + 0.16, 0.34, 0.2, "sine");
  } else {
    // finish fanfare
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      tone(f, t0 + i * 0.13, 0.4, 0.26, "triangle");
    });
  }
}

/* ------------------------------------------------------------------ *
 * Scoped styles
 * ------------------------------------------------------------------ */

const STYLES = `
.iwc {
  --font-ui: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-num: "SF Pro Display", "Helvetica Neue", ui-sans-serif, system-ui, sans-serif;
  font-family: var(--font-ui);
  -webkit-font-smoothing: antialiased;
  background: #06060a;
  color: #f4f5f7;
  padding:
    env(safe-area-inset-top) env(safe-area-inset-right)
    env(safe-area-inset-bottom) env(safe-area-inset-left);
}
.iwc-stage {
  background:
    radial-gradient(120% 80% at 50% 0%, var(--accent-glow), transparent 62%),
    var(--accent-deep);
  transition: background .45s ease;
}
.num {
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  font-weight: 900;
  letter-spacing: -0.04em;
}
.phase-label {
  font-weight: 900;
  letter-spacing: 0.12em;
}
.bar {
  transition: width .25s linear, background .3s ease;
}
.btn { transition: transform .08s ease, background .15s ease, color .15s ease, box-shadow .2s ease, opacity .15s ease; }
.btn:active { transform: scale(.92); }
.pulse-run { animation: pulseRun 1.6s ease-in-out infinite; }
@keyframes pulseRun {
  0%, 100% { box-shadow: 0 0 0 0 var(--accent-ring); }
  50% { box-shadow: 0 0 0 14px transparent; }
}
.sheet-backdrop { animation: fade .2s ease both; }
.sheet { animation: slideUp .28s cubic-bezier(.2,.8,.2,1) both; }
@keyframes fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes slideUp { from { transform: translateY(100%) } to { transform: none } }
@keyframes pop { from { opacity: 0; transform: scale(.86) } to { opacity: 1; transform: none } }
.pop { animation: pop .32s cubic-bezier(.2,.8,.2,1) both; }
@media (prefers-reduced-motion: reduce) {
  .bar, .btn, .sheet, .sheet-backdrop, .pop, .iwc-stage, .pulse-run { transition: none; animation: none; }
}
`;

/* ------------------------------------------------------------------ *
 * App
 * ------------------------------------------------------------------ */

interface Persisted {
  settings: Settings;
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return { ...DEFAULTS, ...(parsed.settings ?? {}) };
  } catch {
    return DEFAULTS;
  }
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const timeline = useMemo(() => buildTimeline(settings), [settings]);

  // index into timeline; running state via wall-clock target.
  const [index, setIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [endAt, setEndAt] = useState<number | null>(null);
  const [pausedRemaining, setPausedRemaining] = useState<number | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [finished, setFinished] = useState(false);

  const audioRef = useRef<AudioContext | null>(null);
  const lastTickRef = useRef<number>(-1); // last whole-second we ticked on

  const isStandalone = useMemo(() => {
    try {
      return (
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true
      );
    } catch {
      return false;
    }
  }, []);

  // Clamp index if the timeline shrank (e.g. settings changed while idle).
  useEffect(() => {
    if (index > timeline.length) setIndex(timeline.length);
  }, [timeline.length, index]);

  const atEnd = finished || index >= timeline.length;
  const current: Segment | null = atEnd ? null : timeline[index];
  const phase: Phase = atEnd ? "done" : current!.phase;
  const meta = PHASE_META[phase];

  const fullMs = current ? current.dur * 1000 : 0;
  const displayMs = atEnd
    ? 0
    : running && endAt != null
      ? Math.max(0, endAt - now)
      : pausedRemaining != null
        ? pausedRemaining
        : fullMs;

  const progress = fullMs > 0 ? clamp(1 - displayMs / fullMs, 0, 1) : atEnd ? 1 : 0;

  // Persist settings only.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings }));
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [settings]);

  // Tick while running.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [running]);

  // Refresh clock on return to foreground (drift-free after backgrounding).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Cue helpers honoring settings.
  const cueChange = useCallback((next: Phase) => {
    const s = settingsRef.current;
    if (next === "work") {
      if (s.sound) beep("go", audioRef);
      if (s.vibrate) vibrate([60, 40, 120]); // strong double buzz into WORK
    } else if (next === "rest" || next === "setrest") {
      if (s.sound) beep("ease", audioRef);
      if (s.vibrate) vibrate(50); // short buzz into REST
    } else if (next === "prepare") {
      if (s.sound) beep("ease", audioRef);
      if (s.vibrate) vibrate(40);
    } else if (next === "done") {
      if (s.sound) beep("finish", audioRef);
      if (s.vibrate) vibrate([90, 60, 90, 60, 200]);
    }
  }, []);

  // Advance to the next segment (or finish). `auto` always advances in HIIT.
  const advance = useCallback(() => {
    const tl = buildTimeline(settingsRef.current);
    setIndex((i) => {
      const next = i + 1;
      if (next >= tl.length) {
        setFinished(true);
        setRunning(false);
        setEndAt(null);
        setPausedRemaining(null);
        cueChange("done");
        return tl.length;
      }
      const nextSeg = tl[next];
      cueChange(nextSeg.phase);
      lastTickRef.current = -1;
      setEndAt(Date.now() + nextSeg.dur * 1000);
      setNow(Date.now());
      return next;
    });
  }, [cueChange]);

  // Fire completion exactly when the wall-clock target is reached.
  useEffect(() => {
    if (running && endAt != null && now >= endAt) advance();
  }, [now, running, endAt, advance]);

  // Countdown ticks on the last 3 seconds of each phase.
  useEffect(() => {
    if (!running || atEnd || endAt == null) return;
    const remaining = Math.max(0, endAt - now);
    const secsLeft = Math.ceil(remaining / 1000);
    if (secsLeft <= 3 && secsLeft >= 1 && secsLeft !== lastTickRef.current) {
      lastTickRef.current = secsLeft;
      if (settingsRef.current.sound) beep("tick", audioRef);
      if (settingsRef.current.vibrate) vibrate(20);
    }
  }, [now, running, atEnd, endAt]);

  // Screen Wake Lock while running; re-acquire on foreground.
  useEffect(() => {
    const wl = getWakeLock();
    if (!wl || !settings.wake || !running) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let active = true;
    const acquire = async () => {
      try {
        sentinel = await wl.request("screen");
      } catch {
        /* denied or unsupported — ignore */
      }
    };
    void acquire();
    const onVis = () => {
      if (document.visibilityState === "visible" && active) void acquire();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVis);
      if (sentinel) void sentinel.release().catch(() => {});
    };
  }, [running, settings.wake]);

  /* Controls */
  const start = useCallback(() => {
    // Unlock audio on the user gesture.
    if (audioRef.current?.state === "suspended") void audioRef.current.resume();
    if (settingsRef.current.sound && !audioRef.current) {
      // prime context on first start
      beep("tick", audioRef);
    }
    const tl = buildTimeline(settingsRef.current);
    if (tl.length === 0) return;
    if (finished) {
      // restart from the top
      setFinished(false);
      setIndex(0);
    }
    const startIdx = finished ? 0 : index;
    const seg = tl[Math.min(startIdx, tl.length - 1)];
    const base = pausedRemaining ?? seg.dur * 1000;
    const startingFresh = pausedRemaining == null;
    lastTickRef.current = -1;
    setEndAt(Date.now() + base);
    setRunning(true);
    setPausedRemaining(null);
    setNow(Date.now());
    if (startingFresh) cueChange(seg.phase);
  }, [index, pausedRemaining, finished, cueChange]);

  const pause = useCallback(() => {
    const rem = endAt != null ? Math.max(0, endAt - Date.now()) : displayMs;
    setPausedRemaining(rem);
    setRunning(false);
    setEndAt(null);
    vibrate(0); // cancel any ongoing vibration
  }, [endAt, displayMs]);

  const toggleRun = useCallback(() => {
    if (running) pause();
    else start();
  }, [running, pause, start]);

  const reset = useCallback(() => {
    setRunning(false);
    setEndAt(null);
    setPausedRemaining(null);
    setIndex(0);
    setFinished(false);
    lastTickRef.current = -1;
    vibrate(0);
  }, []);

  const skip = useCallback(() => {
    if (atEnd) return;
    const tl = buildTimeline(settingsRef.current);
    const next = index + 1;
    if (next >= tl.length) {
      setFinished(true);
      setRunning(false);
      setEndAt(null);
      setPausedRemaining(null);
      setIndex(tl.length);
      return;
    }
    lastTickRef.current = -1;
    setIndex(next);
    setPausedRemaining(null);
    if (running) {
      setEndAt(Date.now() + tl[next].dur * 1000);
      setNow(Date.now());
    } else {
      setEndAt(null);
    }
  }, [atEnd, index, running]);

  const change = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
  }, []);

  // Space toggles; Escape closes the sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheetOpen(false);
      if (e.code === "Space" && e.target === document.body) {
        e.preventDefault();
        toggleRun();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleRun]);

  // Derived display numbers.
  const totalRounds = settings.rounds;
  const curRound = current && current.round > 0 ? current.round : phase === "done" ? settings.rounds : 0;
  const curSet = current ? current.set : settings.sets;

  const phaseIcon = (k: typeof meta.icon, cls: string): ReactNode => {
    if (k === "zap") return <Zap className={cls} />;
    if (k === "work") return <Dumbbell className={cls} />;
    if (k === "rest") return <Coffee className={cls} />;
    return <Flag className={cls} />;
  };

  const wakeAvail = !!getWakeLock();
  const vibrateAvail =
    typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

  return (
    <div
      className="iwc relative flex h-[100dvh] w-full flex-col overflow-hidden"
      style={
        {
          "--accent": meta.accent,
          "--accent-deep": meta.deep,
          "--accent-glow": meta.accent + "33",
          "--accent-ring": meta.accent + "66",
        } as CSSProperties
      }
    >
      <style>{STYLES}</style>

      {/* Stage (full-bleed color fill driven by phase) */}
      <div className="iwc-stage relative flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="relative z-10 flex items-center gap-2 px-5 pt-5">
          <div className="flex items-center gap-2">
            {isStandalone && (
              <span className="flex items-center gap-1.5 rounded-full border border-white/15 bg-black/25 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white/70">
                <Smartphone className="h-3 w-3" /> App
              </span>
            )}
            {settings.sets > 1 && !atEnd && (
              <span
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider"
                style={{ background: "var(--accent)", color: "#06060a" }}
              >
                SET {curSet}/{settings.sets}
              </span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => change("sound", !settings.sound)}
              aria-label={settings.sound ? "Mute sound" : "Unmute sound"}
              title={settings.sound ? "Mute" : "Unmute"}
              className="btn flex h-9 w-9 items-center justify-center rounded-full text-white/70 hover:bg-white/10"
            >
              {settings.sound ? <Volume2 className="h-[18px] w-[18px]" /> : <VolumeX className="h-[18px] w-[18px]" />}
            </button>
            <button
              onClick={() => setSheetOpen(true)}
              aria-label="Settings"
              title="Settings"
              className="btn flex h-9 w-9 items-center justify-center rounded-full text-white/70 hover:bg-white/10"
            >
              <Settings2 className="h-[18px] w-[18px]" />
            </button>
          </div>
        </header>

        {/* Center: phase + giant time */}
        <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6">
          <div key={phase + "-" + index} className="pop flex w-full flex-col items-center">
            <div
              className="phase-label mb-1 flex items-center gap-2 text-[clamp(1.4rem,7vw,2.2rem)]"
              style={{ color: "var(--accent)" }}
            >
              {phaseIcon(meta.icon, "h-[1em] w-[1em]")}
              <span aria-label="Phase">{meta.label}</span>
            </div>

            <div
              aria-label="Time remaining"
              className="num text-[clamp(5rem,32vw,12rem)] leading-[0.86] text-white"
              style={{ textShadow: "0 0 60px var(--accent-glow)" }}
            >
              {atEnd ? "✓" : formatTime(displayMs)}
            </div>

            {!atEnd ? (
              <div
                className="mt-2 text-[clamp(0.95rem,4.5vw,1.3rem)] font-extrabold uppercase tracking-[0.14em] text-white/80"
                aria-label="Round"
              >
                {phase === "prepare"
                  ? "GET READY"
                  : phase === "setrest"
                    ? "NEXT SET UP"
                    : `ROUND ${curRound} / ${totalRounds}`}
              </div>
            ) : (
              <div className="mt-2 text-[clamp(0.95rem,4.5vw,1.3rem)] font-extrabold uppercase tracking-[0.14em] text-white/80">
                WORKOUT COMPLETE
              </div>
            )}
          </div>
        </main>

        {/* Round pips + progress bar */}
        <div className="relative z-10 px-6 pb-3">
          {!atEnd && (
            <div className="mb-3 flex flex-wrap items-center justify-center gap-1.5" aria-label="Round progress">
              {Array.from({ length: totalRounds }).map((_, i) => {
                const done = i + 1 < curRound || (i + 1 === curRound && (phase === "rest" || phase === "setrest"));
                const active = i + 1 === curRound && phase === "work";
                return (
                  <span
                    key={i}
                    className="h-2 rounded-full transition-all"
                    style={{
                      width: active ? "1.5rem" : "0.5rem",
                      background: done || active ? "var(--accent)" : "rgba(255,255,255,0.22)",
                    }}
                  />
                );
              })}
            </div>
          )}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
            <div
              className="bar h-full rounded-full"
              style={{ width: `${(atEnd ? 1 : progress) * 100}%`, background: "var(--accent)" }}
            />
          </div>
        </div>
      </div>

      {/* Controls (on the dark base, below the color stage) */}
      <div className="relative z-10 flex items-center justify-center gap-6 bg-[#06060a] pt-4 pb-3">
        <button
          onClick={reset}
          aria-label="Reset"
          title="Reset"
          className="btn flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-white/5 text-white/70 hover:text-white"
        >
          <RotateCcw className="h-5 w-5" />
        </button>

        <button
          onClick={toggleRun}
          aria-label={running ? "Pause" : finished ? "Restart" : "Start"}
          title={running ? "Pause" : finished ? "Restart" : "Start"}
          className={`btn flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full text-[#06060a] ${running ? "pulse-run" : ""}`}
          style={{ background: "var(--accent)" }}
        >
          {running ? (
            <Pause className="h-8 w-8" fill="currentColor" />
          ) : finished ? (
            <RotateCcw className="h-8 w-8" />
          ) : (
            <Play className="h-8 w-8 translate-x-0.5" fill="currentColor" />
          )}
        </button>

        <button
          onClick={skip}
          aria-label="Skip"
          title="Skip"
          disabled={atEnd}
          className="btn flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-white/5 text-white/70 hover:text-white disabled:opacity-30"
        >
          <SkipForward className="h-5 w-5" />
        </button>
      </div>

      {/* Capability footer */}
      <footer className="relative z-10 flex items-center justify-center gap-4 bg-[#06060a] px-6 pb-6 text-[11px] font-medium text-white/40">
        <span className="flex items-center gap-1.5">
          <Smartphone className="h-3.5 w-3.5" />
          {!settings.vibrate ? "Vibrate off" : vibrateAvail ? "Haptics on" : "Haptics n/a"}
        </span>
        <span className="flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5" />
          {!settings.wake ? "Screen lock on" : wakeAvail ? "Screen stays on" : "Wake Lock n/a"}
        </span>
      </footer>

      {/* Settings sheet */}
      {sheetOpen && (
        <div className="absolute inset-0 z-20 flex items-end justify-center">
          <button
            aria-label="Close settings"
            className="sheet-backdrop absolute inset-0 bg-black/60"
            onClick={() => setSheetOpen(false)}
          />
          <div className="sheet relative max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0d0d14] px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 shadow-2xl">
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-white/20" />
            <div className="mb-4 flex items-center">
              <h2 className="text-base font-extrabold uppercase tracking-wider">Workout</h2>
              <button
                onClick={() => setSheetOpen(false)}
                aria-label="Close settings"
                className="btn ml-auto flex h-8 w-8 items-center justify-center rounded-full text-white/60 hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Stepper label="Prepare" suffix="s" value={settings.prepare} min={0} max={60} step={5}
                onChange={(v) => change("prepare", v)} />
              <Stepper label="Work" suffix="s" value={settings.work} min={5} max={600} step={5}
                onChange={(v) => change("work", v)} />
              <Stepper label="Rest" suffix="s" value={settings.rest} min={0} max={300} step={5}
                onChange={(v) => change("rest", v)} />
              <Stepper label="Rounds" suffix="" value={settings.rounds} min={1} max={30} step={1}
                onChange={(v) => change("rounds", v)} />
              <Stepper label="Sets" suffix="" value={settings.sets} min={1} max={20} step={1}
                onChange={(v) => change("sets", v)} />
              <Stepper label="Set break" suffix="s" value={settings.setRest} min={0} max={600} step={10}
                onChange={(v) => change("setRest", v)} />
            </div>

            <div className="mt-3 divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
              <Toggle icon={<Volume2 className="h-4 w-4" />} label="Sound cues"
                on={settings.sound} onClick={() => change("sound", !settings.sound)} />
              <Toggle icon={<Smartphone className="h-4 w-4" />} label="Vibration"
                on={settings.vibrate} onClick={() => change("vibrate", !settings.vibrate)} />
              <Toggle icon={<Zap className="h-4 w-4" />} label="Keep screen awake"
                on={settings.wake} onClick={() => change("wake", !settings.wake)} />
            </div>

            <div className="mt-4 flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[12px] text-white/50">
              <span className="font-bold uppercase tracking-wider text-white/70">Total time</span>
              <span className="num text-base text-white">
                {formatTime(timeline.reduce((a, s) => a + s.dur, 0) * 1000)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Subcomponents
 * ------------------------------------------------------------------ */

function Stepper({
  label,
  suffix,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  suffix: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-white/50">{label}</div>
      <div className="flex items-center justify-between">
        <button
          onClick={() => onChange(clamp(value - step, min, max))}
          aria-label={`Decrease ${label}`}
          className="btn flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 text-white disabled:opacity-30"
          disabled={value <= min}
        >
          <Minus className="h-4 w-4" />
        </button>
        <div className="num text-2xl text-white">
          {value}
          {suffix && <span className="ml-0.5 font-sans text-[11px] font-medium text-white/40">{suffix}</span>}
        </div>
        <button
          onClick={() => onChange(clamp(value + step, min, max))}
          aria-label={`Increase ${label}`}
          className="btn flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 text-white disabled:opacity-30"
          disabled={value >= max}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function Toggle({
  icon,
  label,
  on,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="flex w-full items-center gap-3 px-4 py-3 text-left"
    >
      <span className="text-white/60">{icon}</span>
      <span className="text-sm font-semibold text-white">{label}</span>
      <span
        className="btn ml-auto flex h-6 w-10 items-center rounded-full p-0.5"
        style={{ background: on ? "#a3ff3c" : "rgba(255,255,255,0.18)" }}
      >
        <span
          className="h-5 w-5 rounded-full bg-white transition-transform"
          style={{ transform: on ? "translateX(16px)" : "translateX(0)" }}
        />
      </span>
    </button>
  );
}
