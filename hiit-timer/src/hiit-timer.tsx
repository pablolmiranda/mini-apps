import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Plus,
  Play,
  Pause,
  Pencil,
  Trash2,
  X,
  Check,
  ChevronUp,
  ChevronDown,
  ArrowLeft,
  Dumbbell,
  Clock,
  Repeat,
  Timer,
  GripVertical,
} from "lucide-react";

/* ------------------------------------------------------------------ *
 * Data model (per spec §5)
 * ------------------------------------------------------------------ */

interface Exercise {
  id: string;
  name: string;
  durationSeconds: number;
}

interface Session {
  id: string;
  name: string;
  exercises: Exercise[];
  setRepetitions: number;
  restSeconds: number;
  createdAt: number;
  updatedAt: number;
}

const INITIAL_COUNTDOWN = 10;

/* ------------------------------------------------------------------ *
 * IndexedDB (hand-rolled, zero-dependency) — offline-first.
 * ------------------------------------------------------------------ */

const DB_NAME = "hiit-timer";
const DB_VERSION = 1;
const STORE = "sessions";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: "id" });
        s.createIndex("updatedAt", "updatedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function store(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllSessions(): Promise<Session[]> {
  const db = await openDB();
  try {
    const all = await reqToPromise(store(db, "readonly").getAll() as IDBRequest<Session[]>);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    db.close();
  }
}

async function putSession(s: Session): Promise<void> {
  const db = await openDB();
  try {
    await reqToPromise(store(db, "readwrite").put(s));
  } finally {
    db.close();
  }
}

async function deleteSession(id: string): Promise<void> {
  const db = await openDB();
  try {
    await reqToPromise(store(db, "readwrite").delete(id));
  } finally {
    db.close();
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function genId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function clockText(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  if (s < 60) return String(s);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${String(ss).padStart(2, "0")}`;
}

function durationLabel(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const m = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return ss ? `${m}m ${ss}s` : `${m}m`;
}

/** Total workout duration in seconds (excludes the lead-in countdown). */
function sessionWorkSeconds(s: Session): number {
  const exTotal = s.exercises.reduce((a, e) => a + e.durationSeconds, 0) * s.setRepetitions;
  // A rest precedes every exercise except the very first of the whole workout.
  const restCount = s.restSeconds > 0 ? s.exercises.length * s.setRepetitions - 1 : 0;
  return exTotal + restCount * s.restSeconds;
}

/* ------------------------------------------------------------------ *
 * Player phase plan
 * ------------------------------------------------------------------ */

type Phase =
  | { kind: "countdown"; seconds: number }
  | { kind: "exercise"; seconds: number; name: string; rep: number; exIndex: number; exTotal: number }
  | { kind: "rest"; seconds: number; nextName: string };

/**
 * Build the flat ordered phase plan for a session.
 * Rest precedes every exercise except the very first of the whole workout
 * (the 10s lead-in countdown takes that slot); the rest before the first
 * exercise of each subsequent set repetition is the "rest between sets".
 */
function buildPhases(s: Session): Phase[] {
  const phases: Phase[] = [{ kind: "countdown", seconds: INITIAL_COUNTDOWN }];
  const total = s.exercises.length;
  for (let rep = 1; rep <= s.setRepetitions; rep++) {
    for (let i = 0; i < total; i++) {
      const isVeryFirst = rep === 1 && i === 0;
      if (!isVeryFirst && s.restSeconds > 0) {
        phases.push({ kind: "rest", seconds: s.restSeconds, nextName: s.exercises[i].name });
      }
      const ex = s.exercises[i];
      phases.push({
        kind: "exercise",
        seconds: ex.durationSeconds,
        name: ex.name,
        rep,
        exIndex: i,
        exTotal: total,
      });
    }
  }
  return phases;
}

/* ------------------------------------------------------------------ *
 * Wake Lock + Fullscreen shims
 * ------------------------------------------------------------------ */

interface WakeLockSentinelLike {
  release(): Promise<void>;
}
interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}
function getWakeLock(): WakeLockLike | undefined {
  return (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
}

function requestFullscreen(el: HTMLElement): void {
  const anyEl = el as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
  try {
    if (anyEl.requestFullscreen) void anyEl.requestFullscreen().catch(() => {});
    else if (anyEl.webkitRequestFullscreen) void anyEl.webkitRequestFullscreen();
  } catch {
    /* blocked (e.g. iOS Safari) — CSS fallback fills the viewport */
  }
}

function exitFullscreen(): void {
  const anyDoc = document as Document & {
    webkitExitFullscreen?: () => Promise<void>;
    webkitFullscreenElement?: Element | null;
  };
  try {
    if (document.fullscreenElement && document.exitFullscreen) void document.exitFullscreen().catch(() => {});
    else if (anyDoc.webkitFullscreenElement && anyDoc.webkitExitFullscreen) void anyDoc.webkitExitFullscreen();
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ *
 * Scoped styles
 * ------------------------------------------------------------------ */

const STYLES = `
.hi {
  --font-ui: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --bg: #0c0e16;
  --surface: #151826;
  --surface-2: #1d2133;
  --text: #eef0f7;
  --muted: #9aa0bd;
  --faint: #5b6184;
  --border: #262b42;
  --accent: #6366f1;
  --accent-2: #818cf8;
  --work: #fb5d6f;
  --work-2: #f43f5e;
  --rest: #10b981;
  --rest-2: #34d399;
  --ready: #6366f1;
  font-family: var(--font-ui);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
}
.num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }

.btn { transition: transform .08s ease, background .15s ease, color .15s ease, opacity .15s ease; }
.btn:active { transform: scale(.96); }
.btn:disabled { opacity: .35; }

.card { transition: transform .14s ease, border-color .15s ease; }
.card:hover { border-color: var(--accent); }

.scroll::-webkit-scrollbar { width: 9px; }
.scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 9999px; border: 2px solid transparent; background-clip: padding-box; }

/* Player phase backdrops */
.stage { transition: background .4s ease; }
.stage[data-phase="countdown"] { background: radial-gradient(120% 90% at 50% 0%, #2a2e6b, var(--bg) 70%); }
.stage[data-phase="exercise"] { background: radial-gradient(120% 90% at 50% 0%, #5b1f2e, #160c12 72%); }
.stage[data-phase="rest"]     { background: radial-gradient(120% 90% at 50% 0%, #0d4a3a, #0a1512 72%); }
.stage[data-phase="done"]     { background: radial-gradient(120% 90% at 50% 0%, #2a2e6b, var(--bg) 70%); }

.pulse { animation: pulse 1s ease-in-out infinite; }
@keyframes pulse { 0%,100% { transform: scale(1); opacity: 1 } 50% { transform: scale(1.04); opacity: .92 } }
@keyframes rise { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
.rise { animation: rise .4s cubic-bezier(.2,.7,.2,1) both; }
@keyframes pop { from { opacity: 0; transform: scale(.85) } to { opacity: 1; transform: scale(1) } }
.pop { animation: pop .35s cubic-bezier(.2,.8,.2,1) both; }

.ring-track { stroke: rgba(255,255,255,.14); }
.ring-fill { transition: stroke-dashoffset .25s linear; stroke-linecap: round; }

@media (prefers-reduced-motion: reduce) {
  .btn, .card, .stage, .pulse, .rise, .pop, .ring-fill { transition: none; animation: none; }
}
`;

/* ------------------------------------------------------------------ *
 * App
 * ------------------------------------------------------------------ */

type Route = { name: "list" } | { name: "edit"; id: string | null } | { name: "play"; id: string };

const SAMPLE: Session = {
  id: "sample-quick-hiit",
  name: "Quick 7-Minute Burner",
  exercises: [
    { id: "e1", name: "Jumping Jacks", durationSeconds: 40 },
    { id: "e2", name: "Squats", durationSeconds: 40 },
    { id: "e3", name: "Push-ups", durationSeconds: 40 },
    { id: "e4", name: "Plank", durationSeconds: 40 },
  ],
  setRepetitions: 3,
  restSeconds: 20,
  createdAt: 1,
  updatedAt: 1,
};

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [route, setRoute] = useState<Route>({ name: "list" });
  const didInit = useRef(false);

  const current = useMemo(() => {
    const id = route.name === "play" ? route.id : route.name === "edit" ? route.id : null;
    return id ? sessions.find((s) => s.id === id) ?? null : null;
  }, [route, sessions]);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    (async () => {
      try {
        let all = await getAllSessions();
        if (all.length === 0) {
          await putSession(SAMPLE);
          all = await getAllSessions();
        }
        setSessions(all);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = useCallback(async (s: Session) => {
    await putSession(s);
    setSessions((prev) =>
      [s, ...prev.filter((p) => p.id !== s.id)].sort((a, b) => b.updatedAt - a.updatedAt)
    );
    setRoute({ name: "list" });
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return (
    <div className="hi h-[100dvh] w-full overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <style>{STYLES}</style>

      {route.name === "list" && (
        <SessionList
          loading={loading}
          sessions={sessions}
          onNew={() => setRoute({ name: "edit", id: null })}
          onEdit={(id) => setRoute({ name: "edit", id })}
          onStart={(id) => setRoute({ name: "play", id })}
          onDelete={remove}
        />
      )}

      {route.name === "edit" && (
        <SessionEditor
          session={route.id ? current : null}
          onCancel={() => setRoute({ name: "list" })}
          onSave={save}
        />
      )}

      {route.name === "play" && current && (
        <Player session={current} onExit={() => setRoute({ name: "list" })} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Session list
 * ------------------------------------------------------------------ */

function SessionList({
  loading,
  sessions,
  onNew,
  onEdit,
  onStart,
  onDelete,
}: {
  loading: boolean;
  sessions: Session[];
  onNew: () => void;
  onEdit: (id: string) => void;
  onStart: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/15 text-[var(--accent-2)]">
          <Timer className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-[19px] font-bold tracking-tight">HIIT Timer</h1>
          <p className="text-[11px] text-[var(--faint)]">{sessions.length} saved · works offline</p>
        </div>
        <button
          onClick={onNew}
          aria-label="New session"
          className="btn ml-auto flex h-10 items-center gap-1.5 rounded-full bg-[var(--accent)] pl-3 pr-4 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> New
        </button>
      </header>

      <div className="scroll flex-1 overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {loading ? (
          <p className="py-16 text-center text-sm text-[var(--faint)]">Loading…</p>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-20 text-center text-[var(--faint)]">
            <Dumbbell className="h-10 w-10" />
            <p className="text-sm">No workouts yet — create your first</p>
            <button onClick={onNew} className="btn rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white">
              New session
            </button>
          </div>
        ) : (
          <div className="mx-auto grid w-full max-w-2xl grid-cols-1 gap-3">
            {sessions.map((s) => {
              const work = sessionWorkSeconds(s);
              return (
                <div key={s.id} className="card rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-[17px] font-semibold">{s.name}</h3>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12px] text-[var(--muted)]">
                        <span className="flex items-center gap-1"><Dumbbell className="h-3.5 w-3.5" />{s.exercises.length} exercises</span>
                        <span className="flex items-center gap-1"><Repeat className="h-3.5 w-3.5" />{s.setRepetitions}× sets</span>
                        <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{s.restSeconds}s rest</span>
                        <span className="text-[var(--faint)]">~{durationLabel(work)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3.5 flex items-center gap-2">
                    <button
                      onClick={() => onStart(s.id)}
                      aria-label={`Start ${s.name}`}
                      className="btn flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] py-2.5 text-sm font-semibold text-white"
                    >
                      <Play className="h-4 w-4" fill="currentColor" /> Start
                    </button>
                    <button onClick={() => onEdit(s.id)} aria-label={`Edit ${s.name}`} className="btn flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-2)] text-[var(--muted)]">
                      <Pencil className="h-[18px] w-[18px]" />
                    </button>
                    <button onClick={() => setConfirmId(s.id)} aria-label={`Delete ${s.name}`} className="btn flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-2)] text-[var(--muted)] hover:text-rose-400">
                      <Trash2 className="h-[18px] w-[18px]" />
                    </button>
                  </div>

                  {confirmId === s.id && (
                    <div className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-2.5">
                      <span className="text-[13px] text-[var(--muted)]">Delete this session?</span>
                      <button onClick={() => setConfirmId(null)} className="btn ml-auto rounded-lg px-3 py-1.5 text-[13px] text-[var(--muted)]">Cancel</button>
                      <button
                        onClick={() => { onDelete(s.id); setConfirmId(null); }}
                        aria-label={`Confirm delete ${s.name}`}
                        className="btn rounded-lg bg-rose-500 px-3 py-1.5 text-[13px] font-semibold text-white"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Session editor
 * ------------------------------------------------------------------ */

function SessionEditor({
  session,
  onCancel,
  onSave,
}: {
  session: Session | null;
  onCancel: () => void;
  onSave: (s: Session) => void;
}) {
  const [name, setName] = useState(session?.name ?? "");
  const [exercises, setExercises] = useState<Exercise[]>(
    session?.exercises.map((e) => ({ ...e })) ?? [
      { id: genId(), name: "Exercise 1", durationSeconds: 40 },
    ]
  );
  const [setRepetitions, setReps] = useState(session?.setRepetitions ?? 3);
  const [restSeconds, setRest] = useState(session?.restSeconds ?? 20);

  const updateExercise = (id: string, patch: Partial<Exercise>) =>
    setExercises((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const addExercise = () =>
    setExercises((prev) => [
      ...prev,
      { id: genId(), name: `Exercise ${prev.length + 1}`, durationSeconds: 40 },
    ]);

  const removeExercise = (id: string) =>
    setExercises((prev) => (prev.length > 1 ? prev.filter((e) => e.id !== id) : prev));

  const move = (index: number, dir: -1 | 1) =>
    setExercises((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });

  const handleSave = () => {
    const now = Date.now();
    const cleaned = exercises.map((e, i) => ({
      ...e,
      name: e.name.trim() || `Exercise ${i + 1}`,
      durationSeconds: clamp(Math.round(e.durationSeconds) || 1, 1, 3600),
    }));
    const s: Session = {
      id: session?.id ?? genId(),
      name: name.trim() || "Untitled workout",
      exercises: cleaned,
      setRepetitions: clamp(Math.round(setRepetitions) || 1, 1, 50),
      restSeconds: clamp(Math.round(restSeconds) || 0, 0, 600),
      createdAt: session?.createdAt ?? now,
      updatedAt: now,
    };
    onSave(s);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-[var(--border)] px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2.5">
        <button onClick={onCancel} aria-label="Cancel" className="btn flex h-9 items-center gap-1 rounded-full px-2 text-sm text-[var(--muted)]">
          <X className="h-[18px] w-[18px]" /> Cancel
        </button>
        <h2 className="ml-1 text-[16px] font-semibold">{session ? "Edit session" : "New session"}</h2>
        <button onClick={handleSave} aria-label="Save session" className="btn ml-auto flex h-9 items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 text-sm font-semibold text-white">
          <Check className="h-4 w-4" /> Save
        </button>
      </header>

      <div className="scroll flex-1 overflow-y-auto px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4">
        <div className="mx-auto w-full max-w-2xl space-y-4">
          <label className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Session name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Session name"
              placeholder="Full-body blast"
              className="mt-1 w-full bg-transparent text-[17px] font-medium outline-none placeholder:text-[var(--faint)]"
            />
          </label>

          {/* Exercises */}
          <div>
            <div className="mb-2 flex items-center px-1">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--muted)]">Exercises (one set)</h3>
              <span className="ml-2 text-[12px] text-[var(--faint)]">{exercises.length}</span>
            </div>
            <div className="space-y-2">
              {exercises.map((ex, i) => (
                <div key={ex.id} className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2.5">
                  <div className="flex flex-col">
                    <button onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${ex.name} up`} className="btn flex h-5 w-6 items-center justify-center rounded text-[var(--faint)] hover:text-[var(--text)]">
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button onClick={() => move(i, 1)} disabled={i === exercises.length - 1} aria-label={`Move ${ex.name} down`} className="btn flex h-5 w-6 items-center justify-center rounded text-[var(--faint)] hover:text-[var(--text)]">
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>
                  <GripVertical className="h-4 w-4 shrink-0 text-[var(--faint)]" />
                  <input
                    value={ex.name}
                    onChange={(e) => updateExercise(ex.id, { name: e.target.value })}
                    aria-label="Exercise name"
                    placeholder="Exercise name"
                    className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--faint)]"
                  />
                  <div className="flex items-center gap-1 rounded-lg bg-[var(--surface-2)] px-2 py-1">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={ex.durationSeconds}
                      onChange={(e) => updateExercise(ex.id, { durationSeconds: Number(e.target.value) })}
                      aria-label="Exercise duration seconds"
                      className="num w-12 bg-transparent text-right text-[15px] outline-none"
                    />
                    <span className="text-[12px] text-[var(--faint)]">s</span>
                  </div>
                  <button onClick={() => removeExercise(ex.id)} disabled={exercises.length <= 1} aria-label={`Remove ${ex.name}`} className="btn flex h-8 w-8 items-center justify-center rounded-lg text-[var(--faint)] hover:text-rose-400">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <button onClick={addExercise} aria-label="Add exercise" className="btn mt-2 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-[var(--border)] py-2.5 text-sm font-medium text-[var(--muted)]">
              <Plus className="h-4 w-4" /> Add exercise
            </button>
          </div>

          {/* Set reps + rest */}
          <div className="grid grid-cols-2 gap-3">
            <Stepper label="Set repetitions" icon={<Repeat className="h-4 w-4" />} value={setRepetitions} min={1} max={50} step={1} suffix="×" onChange={setReps} />
            <Stepper label="Rest (before each)" icon={<Clock className="h-4 w-4" />} value={restSeconds} min={0} max={600} step={5} suffix="s" onChange={setRest} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Stepper({
  label,
  icon,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  icon: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        <span className="text-[var(--accent-2)]">{icon}</span> {label}
      </div>
      <div className="flex items-center justify-between">
        <button onClick={() => onChange(clamp(value - step, min, max))} aria-label={`Decrease ${label}`} className="btn flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--text)]">−</button>
        <div className="num text-2xl font-bold">{value}<span className="ml-0.5 text-sm font-normal text-[var(--faint)]">{suffix}</span></div>
        <button onClick={() => onChange(clamp(value + step, min, max))} aria-label={`Increase ${label}`} className="btn flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--text)]">+</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Player
 * ------------------------------------------------------------------ */

function Player({ session, onExit }: { session: Session; onExit: () => void }) {
  const phases = useMemo(() => buildPhases(session), [session]);

  const [phaseIndex, setPhaseIndex] = useState(0);
  const [phaseEndAt, setPhaseEndAt] = useState<number | null>(null);
  const [pausedRemaining, setPausedRemaining] = useState<number | null>(null);
  const [running, setRunning] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const rootRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  const done = phaseIndex >= phases.length;
  const phase = done ? null : phases[phaseIndex];
  const phaseMs = phase ? phase.seconds * 1000 : 0;

  /* Kick off the first phase + immersive mode once. */
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    setPhaseEndAt(Date.now() + phases[0].seconds * 1000);
    setNow(Date.now());
    if (rootRef.current) requestFullscreen(rootRef.current);
    return () => exitFullscreen();
  }, [phases]);

  /* Tick while running. */
  useEffect(() => {
    if (!running || done) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [running, done]);

  /* Advance phases (drift-free, with catch-up when backgrounded). */
  useEffect(() => {
    if (!running || done || phaseEndAt == null) return;
    if (now < phaseEndAt) return;
    let idx = phaseIndex;
    let end = phaseEndAt;
    while (now >= end && idx < phases.length) {
      idx++;
      if (idx < phases.length) end = end + phases[idx].seconds * 1000;
    }
    if (idx >= phases.length) {
      setPhaseIndex(phases.length);
      setPhaseEndAt(null);
      setRunning(false);
    } else {
      setPhaseIndex(idx);
      setPhaseEndAt(end);
    }
  }, [now, running, done, phaseEndAt, phaseIndex, phases]);

  /* Wake Lock while actively playing; re-acquire on foreground. */
  useEffect(() => {
    if (!running || done) return;
    const wl = getWakeLock();
    if (!wl) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let active = true;
    const acquire = async () => {
      try {
        sentinel = await wl.request("screen");
      } catch {
        /* ignore */
      }
    };
    void acquire();
    const onVis = () => {
      if (document.visibilityState === "visible") {
        setNow(Date.now()); // reconcile timers
        if (active) void acquire();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVis);
      if (sentinel) void sentinel.release().catch(() => {});
    };
  }, [running, done]);

  const remainingMs = done
    ? 0
    : running && phaseEndAt != null
      ? Math.max(0, phaseEndAt - now)
      : pausedRemaining != null
        ? pausedRemaining
        : phaseMs;
  const remainingSec = Math.ceil(remainingMs / 1000);
  const progress = phaseMs > 0 ? clamp(1 - remainingMs / phaseMs, 0, 1) : 0;

  const togglePause = useCallback(() => {
    if (done) return;
    if (running) {
      setPausedRemaining(phaseEndAt != null ? Math.max(0, phaseEndAt - Date.now()) : phaseMs);
      setRunning(false);
      setPhaseEndAt(null);
    } else {
      const rem = pausedRemaining ?? phaseMs;
      setPhaseEndAt(Date.now() + rem);
      setNow(Date.now());
      setPausedRemaining(null);
      setRunning(true);
    }
  }, [done, running, phaseEndAt, phaseMs, pausedRemaining]);

  const exit = useCallback(() => {
    exitFullscreen();
    onExit();
  }, [onExit]);

  const dataPhase = done ? "done" : phase!.kind;
  const accentVar = dataPhase === "exercise" ? "var(--work)" : dataPhase === "rest" ? "var(--rest)" : "var(--ready)";

  // Ring geometry
  const R = 130;
  const C = 2 * Math.PI * R;

  return (
    <div ref={rootRef} data-phase={dataPhase} className="stage relative flex h-full w-full flex-col">
      {/* Top controls */}
      <div className="flex items-center px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        {done ? (
          <button onClick={exit} aria-label="Back to sessions" className="btn flex h-11 w-11 items-center justify-center rounded-full bg-black/30 text-white">
            <ArrowLeft className="h-6 w-6" />
          </button>
        ) : (
          <button onClick={exit} aria-label="Exit" className="btn flex h-11 items-center gap-1.5 rounded-full bg-black/30 pl-2.5 pr-4 text-sm font-medium text-white">
            <X className="h-5 w-5" /> Exit
          </button>
        )}
        {!done && (
          <span className="ml-auto rounded-full bg-black/25 px-3 py-1 text-[12px] font-semibold text-white/90">
            {session.name}
          </span>
        )}
      </div>

      {/* Stage */}
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        {done ? (
          <div className="pop flex flex-col items-center text-center">
            <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-white/10">
              <Check className="h-9 w-9 text-white" />
            </div>
            <div className="text-[64px] font-black leading-none tracking-tight text-white sm:text-[88px]">DONE</div>
            <p className="mt-3 text-[15px] text-white/70">{session.name} complete — nice work.</p>
            <button onClick={exit} className="btn mt-6 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black">
              Back to sessions
            </button>
          </div>
        ) : (
          <div key={phaseIndex} className="rise flex flex-col items-center">
            {/* Progress indicator */}
            <div className="mb-4 h-6 text-[13px] font-semibold uppercase tracking-[0.16em] text-white/75">
              {phase!.kind === "exercise"
                ? `Set ${phase!.rep} · Exercise ${phase!.exIndex + 1} of ${phase!.exTotal}`
                : phase!.kind === "rest"
                  ? "Next up"
                  : "Get ready"}
            </div>

            {/* Title */}
            <h2
              className="mb-5 max-w-[88vw] text-center text-[34px] font-black leading-tight tracking-tight text-white sm:text-[46px]"
              style={{ color: dataPhase === "countdown" ? "#fff" : accentVar }}
            >
              {phase!.kind === "exercise" ? phase!.name : phase!.kind === "rest" ? "Rest" : "Starting…"}
            </h2>

            {/* Ring + countdown */}
            <div className="relative flex items-center justify-center">
              <svg width="300" height="300" viewBox="0 0 300 300" className="max-w-[74vw] -rotate-90">
                <circle className="ring-track" cx="150" cy="150" r={R} fill="none" strokeWidth="12" />
                <circle
                  className="ring-fill"
                  cx="150"
                  cy="150"
                  r={R}
                  fill="none"
                  stroke={accentVar}
                  strokeWidth="12"
                  strokeDasharray={C}
                  strokeDashoffset={C * progress}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div aria-label="Time remaining" className={`num text-[84px] font-black leading-none text-white ${phase!.kind === "rest" ? "" : remainingSec <= 3 ? "pulse" : ""}`}>
                  {clockText(remainingSec)}
                </div>
                {phase!.kind === "rest" && (
                  <div className="mt-1 max-w-[60vw] truncate text-[13px] text-white/70">then {phase!.nextName}</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      {!done && (
        <div className="flex items-center justify-center pb-[max(2rem,env(safe-area-inset-bottom))]">
          <button
            onClick={togglePause}
            aria-label={running ? "Pause" : "Resume"}
            className="btn flex h-16 w-16 items-center justify-center rounded-full bg-white text-black shadow-lg"
          >
            {running ? <Pause className="h-7 w-7" fill="currentColor" /> : <Play className="h-7 w-7 translate-x-0.5" fill="currentColor" />}
          </button>
        </div>
      )}
    </div>
  );
}
