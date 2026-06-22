import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  Settings2,
  X,
  Bell,
  Volume2,
  Eye,
  Repeat,
  Minus,
  Plus,
  Sun,
  Moon,
  Smartphone,
  Check,
} from "lucide-react";

/* ------------------------------------------------------------------ *
 * Model
 * ------------------------------------------------------------------ */

type Phase = "focus" | "short" | "long";
type Theme = "dark" | "light";

interface Settings {
  focus: number; // minutes
  short: number;
  long: number;
  cycle: number; // focus sessions per long break
  sound: boolean;
  notify: boolean;
  wake: boolean;
  auto: boolean; // auto-start next phase
}

const DEFAULTS: Settings = {
  focus: 25,
  short: 5,
  long: 15,
  cycle: 4,
  sound: true,
  notify: true,
  wake: true,
  auto: false,
};

const PHASE_LABEL: Record<Phase, string> = {
  focus: "Focus",
  short: "Short Break",
  long: "Long Break",
};

// Phase-driven accent (the visual heartbeat of the app), per theme.
const ACCENTS: Record<Phase, Record<Theme, string>> = {
  focus: { dark: "#ff6a3d", light: "#d8492a" },
  short: { dark: "#2dd4bf", light: "#0d9488" },
  long: { dark: "#818cf8", light: "#4f46e5" },
};

const STORAGE_KEY = "focus-timer:v1";

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function formatTime(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function durOf(phase: Phase, s: Settings): number {
  const mins = phase === "focus" ? s.focus : phase === "short" ? s.short : s.long;
  return mins * 60_000;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
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

function playChime(phase: Phase, ctxRef: { current: AudioContext | null }) {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return;
  if (!ctxRef.current) ctxRef.current = new Ctx();
  const ctx = ctxRef.current;
  if (ctx.state === "suspended") void ctx.resume();
  const base = phase === "focus" ? 392 : 523.25; // soft, distinct per phase
  const notes = [base, base * 1.5];
  const t0 = ctx.currentTime;
  notes.forEach((f, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = f;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t = t0 + i * 0.18;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.4);
    osc.start(t);
    osc.stop(t + 0.45);
  });
}

/* ------------------------------------------------------------------ *
 * Scoped styles — self-contained theming, type, texture, motion.
 * ------------------------------------------------------------------ */

const STYLES = `
.ft {
  --font-ui: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-num: "SF Pro Display", ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-family: var(--font-ui);
  -webkit-font-smoothing: antialiased;
  padding:
    env(safe-area-inset-top) env(safe-area-inset-right)
    env(safe-area-inset-bottom) env(safe-area-inset-left);
}
.ft[data-theme="dark"] {
  --bg: #0e0f13;
  --bg-2: #15171d;
  --surface: #1b1e26;
  --surface-2: #232732;
  --text: #f3f4f6;
  --muted: #9aa1ad;
  --faint: #5c6370;
  --border: #2a2f3a;
  --track: #262b35;
}
.ft[data-theme="light"] {
  --bg: #f5f6f8;
  --bg-2: #eceef2;
  --surface: #ffffff;
  --surface-2: #f1f3f6;
  --text: #1b1f27;
  --muted: #5c6470;
  --faint: #a3abb8;
  --border: #e3e7ee;
  --track: #e7eaf0;
}

.ft-glow {
  position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(60% 50% at 50% 38%, var(--accent-faint), transparent 70%);
  transition: background .6s ease;
}

.num {
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  font-weight: 200;
  letter-spacing: -0.02em;
}

.ring-progress {
  transition: stroke-dashoffset .35s linear, stroke .6s ease;
  stroke-linecap: round;
}

.btn { transition: transform .08s ease, background .15s ease, color .15s ease, box-shadow .2s ease; }
.btn:active { transform: scale(.94); }

.pill { transition: color .2s ease, background .2s ease, border-color .2s ease; }

.sheet-backdrop { animation: fade .2s ease both; }
.sheet { animation: slideUp .28s cubic-bezier(.2,.8,.2,1) both; }
@keyframes fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes slideUp { from { transform: translateY(100%) } to { transform: none } }

@keyframes rise { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: none } }
.rise { animation: rise .5s cubic-bezier(.2,.7,.2,1) both; }

@media (prefers-reduced-motion: reduce) {
  .ring-progress, .btn, .sheet, .sheet-backdrop, .rise, .ft-glow { transition: none; animation: none; }
}
`;

/* ------------------------------------------------------------------ *
 * App
 * ------------------------------------------------------------------ */

interface Persisted {
  settings: Settings;
  theme: Theme;
  phase: Phase;
  completed: number;
  daily: { date: string; count: number };
  running: boolean;
  endAt: number | null;
  pausedRemaining: number | null;
}

function loadPersisted(): Partial<Persisted> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<Persisted>;
  } catch {
    return {};
  }
}

export default function App() {
  const saved = useRef<Partial<Persisted>>(loadPersisted());

  const [settings, setSettings] = useState<Settings>({
    ...DEFAULTS,
    ...(saved.current.settings ?? {}),
  });
  const [theme, setTheme] = useState<Theme>(saved.current.theme ?? "dark");
  const [phase, setPhase] = useState<Phase>(saved.current.phase ?? "focus");
  const [completed, setCompleted] = useState<number>(saved.current.completed ?? 0);
  const [daily, setDaily] = useState<{ date: string; count: number }>(() => {
    const d = saved.current.daily;
    return d && d.date === todayStr() ? d : { date: todayStr(), count: 0 };
  });

  // Timer state: when running, `endAt` is the wall-clock target; when paused,
  // `pausedRemaining` holds the frozen remaining ms; idle = both null.
  const [running, setRunning] = useState<boolean>(() => {
    const s = saved.current;
    return Boolean(s.running && s.endAt && s.endAt > Date.now());
  });
  const [endAt, setEndAt] = useState<number | null>(() => {
    const s = saved.current;
    return s.running && s.endAt && s.endAt > Date.now() ? s.endAt : null;
  });
  const [pausedRemaining, setPausedRemaining] = useState<number | null>(
    saved.current.pausedRemaining ?? null
  );

  const [now, setNow] = useState<number>(Date.now());
  const [sheetOpen, setSheetOpen] = useState(false);

  const audioRef = useRef<AudioContext | null>(null);

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

  const fullMs = durOf(phase, settings);
  const displayMs =
    running && endAt != null
      ? Math.max(0, endAt - now)
      : pausedRemaining != null
        ? pausedRemaining
        : fullMs;
  const progress = clamp(displayMs / fullMs, 0, 1); // remaining fraction
  const accent = ACCENTS[phase][theme];

  /* Persist everything that matters. */
  useEffect(() => {
    const payload: Persisted = {
      settings,
      theme,
      phase,
      completed,
      daily,
      running,
      endAt,
      pausedRemaining,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [settings, theme, phase, completed, daily, running, endAt, pausedRemaining]);

  /* Tick while running. */
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);

  /* Keep accurate after backgrounding; refresh on return to foreground. */
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const notify = useCallback(
    (title: string, body: string) => {
      if (!settings.notify) return;
      if (typeof Notification === "undefined") return;
      if (Notification.permission === "granted") {
        try {
          new Notification(title, { body, tag: "focus-timer" });
        } catch {
          /* some browsers require SW-based notifications — degrade silently */
        }
      }
    },
    [settings.notify]
  );

  const requestNotifyPermission = useCallback(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") void Notification.requestPermission();
  }, []);

  const completePhase = useCallback(() => {
    const wasFocus = phase === "focus";
    let nextCount = completed;
    let next: Phase;
    if (wasFocus) {
      nextCount = completed + 1;
      next = nextCount % settings.cycle === 0 ? "long" : "short";
      setCompleted(nextCount);
      setDaily((d) =>
        d.date === todayStr()
          ? { date: d.date, count: d.count + 1 }
          : { date: todayStr(), count: 1 }
      );
    } else {
      next = "focus";
    }

    if (settings.sound) playChime(phase, audioRef);
    notify(
      wasFocus ? "Focus complete" : "Break over",
      wasFocus ? "Nice work — time for a break." : "Back to focus."
    );

    setPhase(next);
    if (settings.auto) {
      setEndAt(Date.now() + durOf(next, settings));
      setRunning(true);
      setPausedRemaining(null);
    } else {
      setRunning(false);
      setEndAt(null);
      setPausedRemaining(null);
    }
  }, [phase, completed, settings, notify]);

  /* Fire completion exactly when the wall-clock target is reached. */
  useEffect(() => {
    if (running && endAt != null && now >= endAt) completePhase();
  }, [now, running, endAt, completePhase]);

  /* Screen Wake Lock while running (if enabled); re-acquire on foreground. */
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
  const toggleRun = useCallback(() => {
    if (running) {
      // pause
      const rem = endAt != null ? Math.max(0, endAt - Date.now()) : displayMs;
      setPausedRemaining(rem);
      setRunning(false);
      setEndAt(null);
    } else {
      // start / resume
      requestNotifyPermission();
      if (audioRef.current?.state === "suspended") void audioRef.current.resume();
      const base = pausedRemaining ?? fullMs;
      setEndAt(Date.now() + base);
      setRunning(true);
      setPausedRemaining(null);
      setNow(Date.now());
    }
  }, [running, endAt, displayMs, pausedRemaining, fullMs, requestNotifyPermission]);

  const reset = useCallback(() => {
    setRunning(false);
    setEndAt(null);
    setPausedRemaining(null);
  }, []);

  const skip = useCallback(() => {
    const next: Phase =
      phase === "focus"
        ? (completed + 1) % settings.cycle === 0
          ? "long"
          : "short"
        : "focus";
    setPhase(next);
    setRunning(false);
    setEndAt(null);
    setPausedRemaining(null);
  }, [phase, completed, settings.cycle]);

  const change = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
  }, []);

  /* Space toggles start/pause; Escape closes the sheet. */
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

  /* Ring geometry */
  const R = 130;
  const C = 2 * Math.PI * R;
  const dashOffset = C * (1 - progress);

  const dotsFilled = (() => {
    const inCycle = completed % settings.cycle;
    return inCycle === 0 && completed > 0 ? settings.cycle : inCycle;
  })();

  const notifyState =
    typeof Notification !== "undefined" ? Notification.permission : "unsupported";

  return (
    <div
      data-theme={theme}
      className="ft relative flex h-[100dvh] w-full flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)]"
      style={{
        "--accent": accent,
        "--accent-soft": accent + "33",
        "--accent-faint": accent + (theme === "dark" ? "22" : "14"),
      } as CSSProperties}
    >
      <style>{STYLES}</style>
      <div className="ft-glow" />

      {/* Top bar */}
      <header className="relative z-10 flex items-center gap-2 px-5 pt-5">
        <div className="flex items-center gap-2">
          {isStandalone && (
            <span className="pill flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--muted)]">
              <Smartphone className="h-3 w-3" /> Standalone
            </span>
          )}
          {daily.count > 0 && (
            <span className="pill flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--muted)]">
              <Check className="h-3 w-3 text-[var(--accent)]" /> {daily.count} today
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            aria-label="Toggle theme"
            title="Toggle theme"
            className="btn flex h-9 w-9 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--surface)]"
          >
            {theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          </button>
          <button
            onClick={() => setSheetOpen(true)}
            aria-label="Settings"
            title="Settings"
            className="btn flex h-9 w-9 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--surface)]"
          >
            <Settings2 className="h-[18px] w-[18px]" />
          </button>
        </div>
      </header>

      {/* Center: phase + ring + time */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6">
        <div key={phase} className="rise flex flex-col items-center">
          <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
            {PHASE_LABEL[phase]}
          </div>

          <div className="relative flex items-center justify-center">
            <svg
              width="300"
              height="300"
              viewBox="0 0 300 300"
              className="max-w-[78vw]"
              style={{ filter: "drop-shadow(0 0 24px var(--accent-soft))" }}
            >
              <circle
                cx="150"
                cy="150"
                r={R}
                fill="none"
                stroke="var(--track)"
                strokeWidth="12"
              />
              <circle
                cx="150"
                cy="150"
                r={R}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="12"
                className="ring-progress"
                strokeDasharray={C}
                strokeDashoffset={dashOffset}
                transform="rotate(-90 150 150)"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div
                aria-label="Time remaining"
                className="num text-[clamp(3.2rem,17vw,5.2rem)] leading-none text-[var(--text)]"
              >
                {formatTime(displayMs)}
              </div>
              <div className="mt-2 text-[12px] font-medium text-[var(--faint)]">
                {running ? "in progress" : pausedRemaining != null ? "paused" : "ready"}
              </div>
            </div>
          </div>

          {/* Cycle dots */}
          <div className="mt-7 flex items-center gap-2" aria-label="Session progress">
            {Array.from({ length: settings.cycle }).map((_, i) => (
              <span
                key={i}
                className="h-2 w-2 rounded-full transition-colors"
                style={{
                  background: i < dotsFilled ? "var(--accent)" : "var(--track)",
                }}
              />
            ))}
          </div>
        </div>
      </main>

      {/* Controls */}
      <div className="relative z-10 flex items-center justify-center gap-5 pb-3">
        <button
          onClick={reset}
          aria-label="Reset"
          title="Reset"
          className="btn flex h-12 w-12 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--text)]"
        >
          <RotateCcw className="h-5 w-5" />
        </button>

        <button
          onClick={toggleRun}
          aria-label={running ? "Pause" : "Start"}
          title={running ? "Pause" : "Start"}
          className="btn flex h-20 w-20 items-center justify-center rounded-full text-white shadow-lg"
          style={{ background: "var(--accent)", boxShadow: "0 12px 40px -8px var(--accent-soft)" }}
        >
          {running ? (
            <Pause className="h-8 w-8" fill="currentColor" />
          ) : (
            <Play className="h-8 w-8 translate-x-0.5" fill="currentColor" />
          )}
        </button>

        <button
          onClick={skip}
          aria-label="Skip"
          title="Skip"
          className="btn flex h-12 w-12 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--text)]"
        >
          <SkipForward className="h-5 w-5" />
        </button>
      </div>

      {/* Capability status */}
      <footer className="relative z-10 flex items-center justify-center gap-4 px-6 pb-6 text-[11px] text-[var(--faint)]">
        <span className="flex items-center gap-1.5">
          <Eye className="h-3.5 w-3.5" />
          {settings.wake ? (getWakeLock() ? "Screen stays on" : "Wake Lock n/a") : "Screen lock on"}
        </span>
        <span className="flex items-center gap-1.5">
          <Bell className="h-3.5 w-3.5" />
          {!settings.notify
            ? "Alerts off"
            : notifyState === "granted"
              ? "Alerts on"
              : notifyState === "denied"
                ? "Alerts blocked"
                : "Tap start to allow alerts"}
        </span>
      </footer>

      {/* Settings sheet */}
      {sheetOpen && (
        <div className="absolute inset-0 z-20 flex items-end justify-center">
          <button
            aria-label="Close settings"
            className="sheet-backdrop absolute inset-0 bg-black/50"
            onClick={() => setSheetOpen(false)}
          />
          <div className="sheet relative w-full max-w-md rounded-t-3xl border border-[var(--border)] bg-[var(--bg-2)] px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 shadow-2xl">
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-[var(--border)]" />
            <div className="mb-4 flex items-center">
              <h2 className="text-base font-semibold">Settings</h2>
              <button
                onClick={() => setSheetOpen(false)}
                aria-label="Close settings"
                className="btn ml-auto flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--surface)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Stepper label="Focus" suffix="min" value={settings.focus} min={1} max={90}
                onChange={(v) => change("focus", v)} />
              <Stepper label="Short break" suffix="min" value={settings.short} min={1} max={30}
                onChange={(v) => change("short", v)} />
              <Stepper label="Long break" suffix="min" value={settings.long} min={1} max={45}
                onChange={(v) => change("long", v)} />
              <Stepper label="Sessions / long" suffix="" value={settings.cycle} min={2} max={8}
                onChange={(v) => change("cycle", v)} />
            </div>

            <div className="mt-3 divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
              <Toggle icon={<Repeat className="h-4 w-4" />} label="Auto-start next"
                on={settings.auto} onClick={() => change("auto", !settings.auto)} />
              <Toggle icon={<Volume2 className="h-4 w-4" />} label="Sound chime"
                on={settings.sound} onClick={() => change("sound", !settings.sound)} />
              <Toggle icon={<Bell className="h-4 w-4" />} label="Notifications"
                on={settings.notify}
                onClick={() => {
                  const nv = !settings.notify;
                  change("notify", nv);
                  if (nv) requestNotifyPermission();
                }} />
              <Toggle icon={<Eye className="h-4 w-4" />} label="Keep screen awake"
                on={settings.wake} onClick={() => change("wake", !settings.wake)} />
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
  onChange,
}: {
  label: string;
  suffix: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
      <div className="mb-1.5 text-[12px] font-medium text-[var(--muted)]">{label}</div>
      <div className="flex items-center justify-between">
        <button
          onClick={() => onChange(clamp(value - 1, min, max))}
          aria-label={`Decrease ${label}`}
          className="btn flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--text)] disabled:opacity-40"
          disabled={value <= min}
        >
          <Minus className="h-4 w-4" />
        </button>
        <div className="num text-xl text-[var(--text)]">
          {value}
          {suffix && <span className="ml-0.5 text-[11px] font-sans text-[var(--faint)]">{suffix}</span>}
        </div>
        <button
          onClick={() => onChange(clamp(value + 1, min, max))}
          aria-label={`Increase ${label}`}
          className="btn flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--text)] disabled:opacity-40"
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
      <span className="text-[var(--muted)]">{icon}</span>
      <span className="text-sm text-[var(--text)]">{label}</span>
      <span
        className="btn ml-auto flex h-6 w-10 items-center rounded-full p-0.5"
        style={{ background: on ? "var(--accent)" : "var(--border)" }}
      >
        <span
          className="h-5 w-5 rounded-full bg-white transition-transform"
          style={{ transform: on ? "translateX(16px)" : "translateX(0)" }}
        />
      </span>
    </button>
  );
}
