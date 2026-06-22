import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import {
  Menu,
  X,
  Play,
  Square,
  Plus,
  Minus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Check,
  Sun,
  Moon,
  Hand,
  Target,
  Clock,
  Music2,
  ListMusic,
  TrendingUp,
  Pencil,
  ArrowLeft,
  Gauge,
  SkipForward,
  MoreVertical,
  Copy,
} from "lucide-react";

/* ================================================================== *
 * Model
 * ================================================================== */

type Unit = "time" | "bars";
interface Dur {
  unit: Unit;
  value: number; // seconds (time) or bar count (bars)
}
interface Settings {
  bpm: number;
  beats: number; // numerator
  denom: number; // denominator (2/4/8)
  subdivision: number; // notes per beat
  accentFirst: boolean;
}
interface Exercise extends Settings {
  id: string;
  name: string;
  duration: Dur;
}
interface Workout {
  id: string;
  name: string;
  exercises: Exercise[];
  rest: Dur;
  createdAt: number;
  updatedAt: number;
}
interface TrainerConfig extends Settings {
  startBpm: number;
  incrementBpm: number;
  intervalSeconds: number;
  targetBpm: number;
}

type Mode = "metronome" | "workout" | "trainer";

interface SegParams {
  bpm: number;
  beats: number;
  denom: number;
  subdivision: number;
  accentFirst: boolean;
  silent: boolean;
}
interface Segment {
  params: SegParams;
  end: Dur; // value Infinity = open-ended
  kind: "basic" | "exercise" | "rest";
  label: string;
}

const BPM_MIN = 30;
const BPM_MAX = 300;
const SUBDIVISIONS = [
  { v: 1, label: "1", name: "Quarter" },
  { v: 2, label: "2", name: "Eighth" },
  { v: 3, label: "3", name: "Triplet" },
  { v: 4, label: "4", name: "Sixteenth" },
];
const DENOMS = [2, 4, 8];

/* ================================================================== *
 * Pure helpers
 * ================================================================== */

function genId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function clampBpm(n: number): number {
  if (!Number.isFinite(n)) return 120;
  return Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(n)));
}

export function tempoMarking(bpm: number): string {
  if (bpm < 40) return "Grave";
  if (bpm < 60) return "Largo";
  if (bpm < 66) return "Larghetto";
  if (bpm < 76) return "Adagio";
  if (bpm < 108) return "Andante";
  if (bpm < 120) return "Moderato";
  if (bpm < 156) return "Allegro";
  if (bpm < 176) return "Vivace";
  if (bpm < 200) return "Presto";
  return "Prestissimo";
}

export function computeTapBpm(times: number[]): number | null {
  if (times.length < 2) return null;
  const intervals: number[] = [];
  for (let i = 1; i < times.length; i++) intervals.push(times[i] - times[i - 1]);
  const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  if (avg <= 0) return null;
  return clampBpm(60000 / avg);
}

export function barSeconds(s: Pick<Settings, "bpm" | "beats">): number {
  return (s.beats * 60) / s.bpm;
}

export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${m}:${String(ss).padStart(2, "0")}`;
}

/** Append/increment a trailing "(N)" suffix when duplicating a workout name. */
export function nextDuplicateName(name: string): string {
  const m = name.match(/^(.*?)\s*\((\d+)\)\s*$/);
  if (m) return `${m[1]} (${parseInt(m[2], 10) + 1})`;
  return `${name} (1)`;
}

export function buildTrainerSegments(cfg: TrainerConfig): Segment[] {
  const mk = (bpm: number): Segment => ({
    params: {
      bpm,
      beats: cfg.beats,
      denom: cfg.denom,
      subdivision: cfg.subdivision,
      accentFirst: cfg.accentFirst,
      silent: false,
    },
    end: { unit: "time", value: Math.max(1, cfg.intervalSeconds) },
    kind: "exercise",
    label: `${bpm} BPM`,
  });
  const start = clampBpm(cfg.startBpm);
  const target = clampBpm(cfg.targetBpm);
  const inc = Math.max(1, Math.round(cfg.incrementBpm));
  if (target <= start) return [mk(start)];
  const segs: Segment[] = [];
  for (let bpm = start; bpm < target; bpm += inc) segs.push(mk(bpm));
  segs.push(mk(target)); // final hold at target
  return segs;
}

export function buildWorkoutSegments(w: Workout): Segment[] {
  const segs: Segment[] = [];
  w.exercises.forEach((ex, i) => {
    segs.push({
      params: {
        bpm: ex.bpm,
        beats: ex.beats,
        denom: ex.denom,
        subdivision: ex.subdivision,
        accentFirst: ex.accentFirst,
        silent: false,
      },
      end: ex.duration,
      kind: "exercise",
      label: ex.name || `Exercise ${i + 1}`,
    });
    if (i < w.exercises.length - 1 && w.rest.value > 0) {
      segs.push({
        params: {
          bpm: ex.bpm,
          beats: ex.beats,
          denom: ex.denom,
          subdivision: ex.subdivision,
          accentFirst: false,
          silent: true,
        },
        end: w.rest,
        kind: "rest",
        label: "Rest",
      });
    }
  });
  return segs;
}

function basicSegments(s: Settings, duration: Dur | null): Segment[] {
  const params: SegParams = { ...s, silent: false };
  return [
    {
      params,
      end: duration ?? { unit: "time", value: Infinity },
      kind: "basic",
      label: duration ? "Practice" : "Metronome",
    },
  ];
}

/* ================================================================== *
 * IndexedDB (workouts)
 * ================================================================== */

const DB_NAME = "metronome";
const DB_VERSION = 1;
const STORE = "workouts";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" }).createIndex("updatedAt", "updatedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}
function toPromise<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function getAllWorkouts(): Promise<Workout[]> {
  const db = await openDB();
  try {
    const all = await toPromise(tx(db, "readonly").getAll() as IDBRequest<Workout[]>);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    db.close();
  }
}
async function putWorkout(w: Workout): Promise<void> {
  const db = await openDB();
  try {
    await toPromise(tx(db, "readwrite").put(w));
  } finally {
    db.close();
  }
}
async function deleteWorkout(id: string): Promise<void> {
  const db = await openDB();
  try {
    await toPromise(tx(db, "readwrite").delete(id));
  } finally {
    db.close();
  }
}

/* ================================================================== *
 * Audio + Wake Lock shims
 * ================================================================== */

interface WakeLockSentinelLike {
  release(): Promise<void>;
}
interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}
function getWakeLock(): WakeLockLike | undefined {
  return (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
}
function getAudioCtor(): typeof AudioContext | undefined {
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
}

type ClickType = "accent" | "beat" | "sub";
function click(ac: AudioContext, time: number, type: ClickType) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.connect(g);
  g.connect(ac.destination);
  osc.type = "triangle";
  osc.frequency.value = type === "accent" ? 1500 : 920;
  const vol = type === "accent" ? 0.5 : type === "beat" ? 0.32 : 0.13;
  const dur = type === "sub" ? 0.028 : 0.045;
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(vol, time + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  osc.start(time);
  osc.stop(time + dur + 0.02);
}

/* ================================================================== *
 * Engine
 * ================================================================== */

interface EngineUi {
  playing: boolean;
  beatInBar: number; // -1 when none
  pulse: number;
  liveBpm: number;
  beats: number;
  segIdx: number;
  segCount: number;
  label: string;
  kind: Segment["kind"];
  endUnit: Unit;
  endValue: number;
  remainMs: number;
  barsRemaining: number;
}

const MAX_ANGLE = 28;
const PIVOT_Y = 60;

function useEngine() {
  const supported = useMemo(() => Boolean(getAudioCtor()), []);
  const pendRef = useRef<SVGGElement>(null);

  const acRef = useRef<AudioContext | null>(null);
  const schedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef = useRef<number | null>(null);
  const progRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const segsRef = useRef<Segment[]>([]);
  const segIdxRef = useRef(0);
  const paramsRef = useRef<SegParams>({
    bpm: 120,
    beats: 4,
    denom: 4,
    subdivision: 1,
    accentFirst: true,
    silent: false,
  });
  const nextNoteRef = useRef(0);
  const subIdxRef = useRef(0);
  const beatInBarRef = useRef(0);
  const barsDoneRef = useRef(0);
  const absBeatRef = useRef(0);
  const segStartRef = useRef(0);
  const playingRef = useRef(false);
  const queueRef = useRef<{ time: number; beatInBar: number; abs: number }[]>([]);
  const lastBeatRef = useRef<{ time: number; abs: number } | null>(null);

  const [ui, setUi] = useState<EngineUi>({
    playing: false,
    beatInBar: -1,
    pulse: 0,
    liveBpm: 120,
    beats: 4,
    segIdx: 0,
    segCount: 1,
    label: "",
    kind: "basic",
    endUnit: "time",
    endValue: Infinity,
    remainMs: Infinity,
    barsRemaining: 0,
  });

  const applySeg = useCallback((seg: Segment) => {
    paramsRef.current = { ...seg.params };
    setUi((u) => ({
      ...u,
      liveBpm: seg.params.bpm,
      beats: seg.params.beats,
      label: seg.label,
      kind: seg.kind,
      endUnit: seg.end.unit,
      endValue: seg.end.value,
    }));
  }, []);

  const stop = useCallback(() => {
    playingRef.current = false;
    if (schedRef.current) clearInterval(schedRef.current);
    if (progRef.current) clearInterval(progRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    schedRef.current = progRef.current = null;
    rafRef.current = null;
    queueRef.current = [];
    lastBeatRef.current = null;
    if (pendRef.current) pendRef.current.setAttribute("transform", `rotate(0 150 ${PIVOT_Y})`);
    setUi((u) => ({ ...u, playing: false, beatInBar: -1 }));
  }, []);

  const advance = useCallback(
    (atTime: number) => {
      const next = segIdxRef.current + 1;
      if (next >= segsRef.current.length) {
        stop();
        return;
      }
      segIdxRef.current = next;
      applySeg(segsRef.current[next]);
      segStartRef.current = atTime;
      subIdxRef.current = 0;
      beatInBarRef.current = 0;
      barsDoneRef.current = 0;
      setUi((u) => ({ ...u, segIdx: next }));
    },
    [applySeg, stop]
  );

  const scheduler = useCallback(() => {
    const ac = acRef.current;
    if (!ac || !playingRef.current) return;
    while (nextNoteRef.current < ac.currentTime + 0.1) {
      const time = nextNoteRef.current;
      // End the current segment if its deadline has passed.
      const seg = segsRef.current[segIdxRef.current];
      const ended =
        seg.end.unit === "bars"
          ? barsDoneRef.current >= seg.end.value
          : time - segStartRef.current >= seg.end.value;
      if (ended) {
        advance(time);
        if (!playingRef.current) return;
      }
      const p = paramsRef.current;
      const sub = subIdxRef.current;
      const bib = beatInBarRef.current;
      if (sub === 0) {
        if (!p.silent) click(ac, time, bib === 0 && p.accentFirst ? "accent" : "beat");
        queueRef.current.push({ time, beatInBar: bib, abs: absBeatRef.current });
      } else if (!p.silent) {
        click(ac, time, "sub");
      }
      nextNoteRef.current += 60 / p.bpm / p.subdivision;
      subIdxRef.current++;
      if (subIdxRef.current >= p.subdivision) {
        subIdxRef.current = 0;
        absBeatRef.current++;
        const nb = bib + 1;
        if (nb >= p.beats) {
          beatInBarRef.current = 0;
          barsDoneRef.current++;
        } else {
          beatInBarRef.current = nb;
        }
      }
    }
  }, [advance]);

  const draw = useCallback(() => {
    const ac = acRef.current;
    if (!ac) return;
    const t = ac.currentTime;
    const q = queueRef.current;
    while (q.length && q[0].time <= t) {
      const b = q.shift()!;
      lastBeatRef.current = { time: b.time, abs: b.abs };
      setUi((u) => ({ ...u, beatInBar: b.beatInBar, pulse: u.pulse + 1 }));
    }
    const last = lastBeatRef.current;
    if (last && pendRef.current) {
      const spb = 60 / paramsRef.current.bpm;
      const frac = Math.min(1.25, Math.max(0, (t - last.time) / spb));
      const angle = MAX_ANGLE * Math.cos(Math.PI * (last.abs + frac));
      pendRef.current.setAttribute("transform", `rotate(${angle.toFixed(2)} 150 ${PIVOT_Y})`);
    }
    if (playingRef.current) rafRef.current = requestAnimationFrame(draw);
  }, []);

  const updateProgress = useCallback(() => {
    const ac = acRef.current;
    if (!ac) return;
    const seg = segsRef.current[segIdxRef.current];
    if (!seg) return;
    const t = ac.currentTime;
    let remainMs = Infinity;
    let barsRemaining = 0;
    if (seg.end.unit === "time" && Number.isFinite(seg.end.value)) {
      remainMs = Math.max(0, (segStartRef.current + seg.end.value - t) * 1000);
    } else if (seg.end.unit === "bars") {
      barsRemaining = Math.max(0, seg.end.value - barsDoneRef.current);
    }
    setUi((u) => ({ ...u, liveBpm: Math.round(paramsRef.current.bpm), remainMs, barsRemaining }));
  }, []);

  const start = useCallback(
    (segments: Segment[]) => {
      const Ctor = getAudioCtor();
      if (!Ctor || segments.length === 0) return;
      if (!acRef.current) acRef.current = new Ctor();
      const ac = acRef.current;
      void ac.resume();

      segsRef.current = segments;
      segIdxRef.current = 0;
      subIdxRef.current = 0;
      beatInBarRef.current = 0;
      barsDoneRef.current = 0;
      absBeatRef.current = 0;
      queueRef.current = [];
      lastBeatRef.current = null;
      segStartRef.current = ac.currentTime + 0.12;
      nextNoteRef.current = ac.currentTime + 0.12;
      paramsRef.current = { ...segments[0].params };
      playingRef.current = true;

      setUi((u) => ({
        ...u,
        playing: true,
        beatInBar: -1,
        segIdx: 0,
        segCount: segments.length,
        liveBpm: segments[0].params.bpm,
        beats: segments[0].params.beats,
        label: segments[0].label,
        kind: segments[0].kind,
        endUnit: segments[0].end.unit,
        endValue: segments[0].end.value,
        remainMs: Number.isFinite(segments[0].end.value) ? segments[0].end.value * 1000 : Infinity,
        barsRemaining: segments[0].end.unit === "bars" ? segments[0].end.value : 0,
      }));

      schedRef.current = setInterval(scheduler, 25);
      progRef.current = setInterval(updateProgress, 200);
      rafRef.current = requestAnimationFrame(draw);
    },
    [scheduler, draw, updateProgress]
  );

  // Jump to the next exercise segment (skipping a following rest). Stops if
  // there is no further exercise.
  const skip = useCallback(() => {
    const ac = acRef.current;
    if (!ac || !playingRef.current) return;
    let next = segIdxRef.current + 1;
    while (next < segsRef.current.length && segsRef.current[next].kind === "rest") next++;
    if (next >= segsRef.current.length) {
      stop();
      return;
    }
    segIdxRef.current = next;
    applySeg(segsRef.current[next]);
    const t = ac.currentTime;
    segStartRef.current = t;
    nextNoteRef.current = t + 0.05;
    subIdxRef.current = 0;
    beatInBarRef.current = 0;
    barsDoneRef.current = 0;
    setUi((u) => ({ ...u, segIdx: next, beatInBar: -1 }));
  }, [applySeg, stop]);

  // Live edits for the basic metronome (open-ended single segment).
  const updateLive = useCallback((patch: Partial<SegParams>) => {
    paramsRef.current = { ...paramsRef.current, ...patch };
    if (segsRef.current[segIdxRef.current]) {
      segsRef.current[segIdxRef.current] = {
        ...segsRef.current[segIdxRef.current],
        params: { ...paramsRef.current },
      };
    }
    setUi((u) => ({
      ...u,
      liveBpm: paramsRef.current.bpm,
      beats: paramsRef.current.beats,
    }));
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { ui, start, stop, skip, updateLive, pendRef, supported };
}

/* ================================================================== *
 * Scoped styles
 * ================================================================== */

const STYLES = `
.mt {
  --font-ui: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-family: var(--font-ui);
  -webkit-font-smoothing: antialiased;
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}
.mt[data-theme="dark"] {
  --bg: #15141b;
  --surface: #201e2a;
  --surface-2: #2a2735;
  --text: #f1eef7;
  --muted: #a39db8;
  --faint: #645d78;
  --border: #322e3f;
  --accent: #f0a93e;
  --accent-2: #ffc266;
  --accent-soft: rgba(240,169,62,.14);
}
.mt[data-theme="light"] {
  --bg: #f4f1ea;
  --surface: #ffffff;
  --surface-2: #efeae0;
  --text: #211d2a;
  --muted: #6c6678;
  --faint: #aaa394;
  --border: #e5ddcf;
  --accent: #c87f1b;
  --accent-2: #a8690f;
  --accent-soft: rgba(200,127,27,.12);
}
.num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }
.btn { transition: transform .08s ease, background .15s ease, color .15s ease, opacity .15s ease; }
.btn:active { transform: scale(.95); }
.btn:disabled { opacity: .4; }
.pill { transition: background .15s ease, color .15s ease, border-color .15s ease; }
.dot { transition: background .12s ease, transform .12s ease; }
.scroll::-webkit-scrollbar { width: 9px; }
.scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 9999px; border: 2px solid transparent; background-clip: padding-box; }
@keyframes rise { from { opacity:0; transform: translateY(8px) } to { opacity:1; transform:none } }
.rise { animation: rise .35s cubic-bezier(.2,.7,.2,1) both; }
@keyframes slideDown { from { opacity:0; transform: translateY(-8px) } to { opacity:1; transform:none } }
.menu { animation: slideDown .16s ease both; }
input[type="range"].slider { -webkit-appearance: none; appearance: none; height: 6px; border-radius: 9999px; background: linear-gradient(to right, var(--accent) var(--fill,50%), var(--surface-2) var(--fill,50%)); outline: none; }
input[type="range"].slider::-webkit-slider-thumb { -webkit-appearance: none; height: 24px; width: 24px; border-radius: 9999px; background: var(--accent); border: 3px solid var(--bg); box-shadow: 0 2px 6px rgba(0,0,0,.35); cursor: pointer; }
input[type="range"].slider::-moz-range-thumb { height: 22px; width: 22px; border-radius: 9999px; background: var(--accent); border: 3px solid var(--bg); }
@media (prefers-reduced-motion: reduce) { .btn,.pill,.dot,.rise,.menu { transition: none; animation: none; } }
`;

/* ================================================================== *
 * App
 * ================================================================== */

const DEFAULT_SETTINGS: Settings = { bpm: 120, beats: 4, denom: 4, subdivision: 1, accentFirst: true };
const DEFAULT_TRAINER: TrainerConfig = {
  ...DEFAULT_SETTINGS,
  startBpm: 80,
  incrementBpm: 5,
  intervalSeconds: 60,
  targetBpm: 120,
};

const SAMPLE_WORKOUT: Workout = {
  id: "sample-warmup",
  name: "Warm-up Ladder",
  exercises: [
    { id: "w1", name: "Slow & steady", bpm: 70, beats: 4, denom: 4, subdivision: 1, accentFirst: true, duration: { unit: "time", value: 60 } },
    { id: "w2", name: "Eighth notes", bpm: 90, beats: 4, denom: 4, subdivision: 2, accentFirst: true, duration: { unit: "time", value: 60 } },
    { id: "w3", name: "Push it", bpm: 120, beats: 4, denom: 4, subdivision: 2, accentFirst: true, duration: { unit: "bars", value: 16 } },
  ],
  rest: { unit: "time", value: 15 },
  createdAt: 1,
  updatedAt: 1,
};

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const engine = useEngine();
  const [theme, setTheme] = useState<"dark" | "light">(() => loadJSON("metronome:theme", "dark"));
  const [mode, setMode] = useState<Mode>(() => loadJSON("metronome:mode", "metronome"));
  const [menuOpen, setMenuOpen] = useState(false);

  const [settings, setSettings] = useState<Settings>(() => loadJSON("metronome:settings", DEFAULT_SETTINGS));
  const [duration, setDuration] = useState<Dur | null>(() => loadJSON("metronome:duration", null));
  const [trainer, setTrainer] = useState<TrainerConfig>(() => loadJSON("metronome:trainer", DEFAULT_TRAINER));

  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [woView, setWoView] = useState<{ name: "list" } | { name: "edit"; id: string | null } | { name: "run"; id: string }>({ name: "list" });
  const didInit = useRef(false);

  const [practice, setPractice] = useState<Record<string, number>>(() => loadJSON("metronome:practice", {}));
  const [day, setDay] = useState(todayKey());
  const [historyOpen, setHistoryOpen] = useState(false);

  const running = engine.ui.playing;

  /* Persist small state. */
  useEffect(() => { try { localStorage.setItem("metronome:theme", JSON.stringify(theme)); } catch { /* */ } }, [theme]);
  useEffect(() => { try { localStorage.setItem("metronome:mode", JSON.stringify(mode)); } catch { /* */ } }, [mode]);
  useEffect(() => { try { localStorage.setItem("metronome:settings", JSON.stringify(settings)); } catch { /* */ } }, [settings]);
  useEffect(() => { try { localStorage.setItem("metronome:duration", JSON.stringify(duration)); } catch { /* */ } }, [duration]);
  useEffect(() => { try { localStorage.setItem("metronome:trainer", JSON.stringify(trainer)); } catch { /* */ } }, [trainer]);
  useEffect(() => { try { localStorage.setItem("metronome:practice", JSON.stringify(practice)); } catch { /* */ } }, [practice]);

  /* Load workouts (offline). */
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    (async () => {
      let all = await getAllWorkouts();
      if (all.length === 0) {
        await putWorkout(SAMPLE_WORKOUT);
        all = await getAllWorkouts();
      }
      setWorkouts(all);
    })();
  }, []);

  /* Practice ticking — accumulate one second per second while running. */
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const k = todayKey();
      setDay(k);
      setPractice((p) => ({ ...p, [k]: (p[k] ?? 0) + 1 }));
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  /* Wake Lock while running. */
  useEffect(() => {
    if (!running) return;
    const wl = getWakeLock();
    if (!wl) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let active = true;
    const acquire = async () => {
      try { sentinel = await wl.request("screen"); } catch { /* */ }
    };
    void acquire();
    const onVis = () => { if (document.visibilityState === "visible" && active) void acquire(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVis);
      if (sentinel) void sentinel.release().catch(() => {});
    };
  }, [running]);

  const todaySeconds = practice[day] ?? 0;

  /* Settings mutators (live-update the engine when the basic metronome plays). */
  const patchSettings = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((s) => {
        const next = { ...s, ...patch };
        if (running && mode === "metronome") {
          engine.updateLive({ ...next, silent: false });
        }
        return next;
      });
    },
    [running, mode, engine]
  );

  /* Transport. */
  const onPlay = useCallback(() => {
    if (running) {
      engine.stop();
      return;
    }
    if (mode === "metronome") engine.start(basicSegments(settings, duration));
    else if (mode === "trainer") engine.start(buildTrainerSegments(trainer));
    else if (mode === "workout" && woView.name === "run") {
      const w = workouts.find((x) => x.id === woView.id);
      if (w) engine.start(buildWorkoutSegments(w));
    }
  }, [running, mode, settings, duration, trainer, woView, workouts, engine]);

  // Stop playback when switching modes / leaving the runner.
  const switchMode = useCallback((m: Mode) => {
    if (running) engine.stop();
    setMode(m);
    setMenuOpen(false);
    if (m === "workout") setWoView({ name: "list" });
  }, [running, engine]);

  const saveWorkout = useCallback(async (w: Workout) => {
    await putWorkout(w);
    setWorkouts((prev) => [w, ...prev.filter((x) => x.id !== w.id)].sort((a, b) => b.updatedAt - a.updatedAt));
    setWoView({ name: "list" });
  }, []);
  const removeWorkout = useCallback(async (id: string) => {
    await deleteWorkout(id);
    setWorkouts((prev) => prev.filter((x) => x.id !== id));
  }, []);
  const duplicateWorkout = useCallback(async (id: string) => {
    setWorkouts((prev) => {
      const src = prev.find((x) => x.id === id);
      if (!src) return prev;
      const now = Date.now();
      const copy: Workout = {
        ...src,
        id: genId(),
        name: nextDuplicateName(src.name),
        exercises: src.exercises.map((e) => ({ ...e, id: genId() })),
        createdAt: now,
        updatedAt: now,
      };
      void putWorkout(copy);
      return [copy, ...prev].sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }, []);

  const runningWorkout = woView.name === "run" ? workouts.find((x) => x.id === woView.id) ?? null : null;
  const showTransport = mode === "metronome" || mode === "trainer" || (mode === "workout" && woView.name === "run");

  return (
    <div data-theme={theme} className="mt flex h-[100dvh] w-full flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <style>{STYLES}</style>

      {/* Header */}
      <header className="relative z-20 flex shrink-0 items-center gap-2 px-4 pt-[max(0.85rem,env(safe-area-inset-top))] pb-2">
        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Choose mode"
            aria-expanded={menuOpen}
            className="btn flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          >
            <Menu className="h-[18px] w-[18px] text-[var(--accent)]" />
            <span className="text-sm font-semibold">{MODE_LABEL[mode]}</span>
            <ChevronDown className="h-4 w-4 text-[var(--faint)]" />
          </button>
          {menuOpen && (
            <>
              <button className="fixed inset-0 z-10 cursor-default" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
              <div className="menu absolute left-0 top-full z-20 mt-1.5 w-56 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-xl">
                {(["metronome", "workout", "trainer"] as Mode[]).map((m) => {
                  const Icon = m === "metronome" ? Gauge : m === "workout" ? ListMusic : TrendingUp;
                  return (
                    <button
                      key={m}
                      onClick={() => switchMode(m)}
                      aria-label={`${MODE_LABEL[m]} mode`}
                      className="btn flex w-full items-center gap-2.5 px-3.5 py-3 text-left text-sm hover:bg-[var(--surface-2)]"
                      style={{ color: mode === m ? "var(--accent)" : "var(--text)" }}
                    >
                      <Icon className="h-[18px] w-[18px]" />
                      <span className="font-medium">{MODE_LABEL[m]}</span>
                      {mode === m && <Check className="ml-auto h-4 w-4" />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Practice pill (always visible, top-right) */}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setHistoryOpen(true)}
            aria-label="Practice time today"
            className="pill flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${running ? "bg-[var(--accent)]" : "bg-[var(--faint)]"}`} />
            <span className="text-[11px] uppercase tracking-wide text-[var(--faint)]">Today</span>
            <span className="num text-[13px] font-bold">{formatHMS(todaySeconds)}</span>
          </button>
          <button onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} aria-label="Toggle theme" className="btn flex h-9 w-9 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--surface)]">
            {theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="scroll relative z-0 min-h-0 flex-1 overflow-y-auto">
        {mode === "metronome" && (
          <MetronomeView ui={engine.ui} settings={settings} duration={duration} setDuration={setDuration} patch={patchSettings} pendRef={engine.pendRef} />
        )}
        {mode === "trainer" && (
          <TrainerView ui={engine.ui} cfg={trainer} setCfg={setTrainer} running={running} pendRef={engine.pendRef} />
        )}
        {mode === "workout" && woView.name === "list" && (
          <WorkoutList workouts={workouts} onNew={() => setWoView({ name: "edit", id: null })} onEdit={(id) => setWoView({ name: "edit", id })} onRun={(id) => setWoView({ name: "run", id })} onDelete={removeWorkout} onDuplicate={duplicateWorkout} />
        )}
        {mode === "workout" && woView.name === "edit" && (
          <WorkoutEditor workout={woView.id ? workouts.find((w) => w.id === woView.id) ?? null : null} onCancel={() => setWoView({ name: "list" })} onSave={saveWorkout} />
        )}
        {mode === "workout" && woView.name === "run" && runningWorkout && (
          <WorkoutRunner ui={engine.ui} workout={runningWorkout} pendRef={engine.pendRef} onBack={() => { if (running) engine.stop(); setWoView({ name: "list" }); }} />
        )}
      </main>

      {/* Transport */}
      {showTransport && (
        <footer className="relative z-10 flex shrink-0 items-center justify-center gap-4 border-t border-[var(--border)] px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          {!engine.supported && <span className="absolute left-4 text-[11px] text-[var(--faint)]">audio n/a</span>}
          <button
            onClick={onPlay}
            disabled={!engine.supported}
            aria-label={running ? "Stop" : "Start"}
            className="btn flex h-16 w-16 items-center justify-center rounded-full text-[var(--bg)] shadow-lg"
            style={{ background: "var(--accent)", boxShadow: "0 10px 30px -8px var(--accent-soft)" }}
          >
            {running ? <Square className="h-6 w-6" fill="currentColor" /> : <Play className="h-7 w-7 translate-x-0.5" fill="currentColor" />}
          </button>
          {mode === "workout" && woView.name === "run" && running && (
            <button
              onClick={engine.skip}
              aria-label="Skip to next exercise"
              title="Skip to next exercise"
              className="btn absolute right-6 flex h-12 w-12 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"
            >
              <SkipForward className="h-5 w-5" />
            </button>
          )}
        </footer>
      )}

      {/* Practice history sheet */}
      {historyOpen && (
        <PracticeHistory practice={practice} onClose={() => setHistoryOpen(false)} />
      )}
    </div>
  );
}

const MODE_LABEL: Record<Mode, string> = {
  metronome: "Metronome",
  workout: "Workout",
  trainer: "Trainer",
};

/* ================================================================== *
 * Shared visual stage
 * ================================================================== */

function Stage({
  ui,
  beats,
  bpm,
  pendRef,
  subtitle,
}: {
  ui: EngineUi;
  beats: number;
  bpm: number;
  pendRef: RefObject<SVGGElement>;
  subtitle?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg width="280" height="260" viewBox="0 0 300 280" className="max-w-[70vw]">
          {/* housing */}
          <path d="M150 80 L196 250 L104 250 Z" fill="var(--surface)" stroke="var(--border)" strokeWidth="2" />
          <line x1="150" y1="110" x2="150" y2="235" stroke="var(--border)" strokeWidth="2" strokeDasharray="2 6" />
          {/* pivot */}
          <circle cx="150" cy={PIVOT_Y} r="6" fill="var(--accent)" />
          {/* swinging arm */}
          <g ref={pendRef} transform={`rotate(0 150 ${PIVOT_Y})`}>
            <line x1="150" y1={PIVOT_Y} x2="150" y2="220" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" />
            <rect x="140" y="150" width="20" height="14" rx="3" fill="var(--accent-2)" />
            <circle cx="150" cy="224" r="9" fill="var(--accent)" />
          </g>
        </svg>
      </div>

      {/* Beat dots */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2" aria-label="Beats">
        {Array.from({ length: Math.max(1, beats) }).map((_, i) => {
          const active = ui.playing && ui.beatInBar === i;
          const isOne = i === 0;
          return (
            <span
              key={i}
              className="dot rounded-full"
              style={{
                width: isOne ? 13 : 10,
                height: isOne ? 13 : 10,
                background: active ? "var(--accent)" : "var(--surface-2)",
                transform: active ? "scale(1.25)" : "scale(1)",
                boxShadow: active ? "0 0 12px var(--accent-soft)" : "none",
              }}
            />
          );
        })}
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span className="num text-[64px] font-black leading-none tracking-tight">{bpm}</span>
        <span className="text-sm font-medium text-[var(--muted)]">BPM</span>
      </div>
      <div className="text-[13px] font-medium text-[var(--accent)]">{tempoMarking(bpm)}</div>
      {subtitle}
    </div>
  );
}

/* ================================================================== *
 * Metronome view
 * ================================================================== */

function MetronomeView({
  ui,
  settings,
  duration,
  setDuration,
  patch,
  pendRef,
}: {
  ui: EngineUi;
  settings: Settings;
  duration: Dur | null;
  setDuration: (d: Dur | null) => void;
  patch: (p: Partial<Settings>) => void;
  pendRef: RefObject<SVGGElement>;
}) {
  const bpm = ui.playing ? ui.liveBpm : settings.bpm;
  const tapsRef = useRef<number[]>([]);
  const tap = () => {
    const now = performance.now();
    const taps = tapsRef.current;
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 6) taps.shift();
    const computed = computeTapBpm(taps);
    if (computed != null) patch({ bpm: computed });
  };

  return (
    <div className="mx-auto w-full max-w-xl px-5 pb-6 pt-2">
      <Stage ui={ui} beats={settings.beats} bpm={bpm} pendRef={pendRef} />

      {/* Tempo controls */}
      <div className="mt-5 flex items-center gap-3">
        <button onClick={() => patch({ bpm: clampBpm(settings.bpm - 1) })} aria-label="Decrease tempo" className="btn flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--text)]"><Minus className="h-5 w-5" /></button>
        <input
          type="range" min={BPM_MIN} max={BPM_MAX} value={settings.bpm}
          onChange={(e) => patch({ bpm: clampBpm(Number(e.target.value)) })}
          aria-label="Tempo" className="slider w-full"
          style={{ ["--fill" as string]: `${((settings.bpm - BPM_MIN) / (BPM_MAX - BPM_MIN)) * 100}%` }}
        />
        <button onClick={() => patch({ bpm: clampBpm(settings.bpm + 1) })} aria-label="Increase tempo" className="btn flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--text)]"><Plus className="h-5 w-5" /></button>
      </div>
      <button onClick={tap} aria-label="Tap tempo" className="btn mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-semibold">
        <Hand className="h-4 w-4 text-[var(--accent)]" /> Tap tempo
      </button>

      <SignatureSubdivision settings={settings} patch={patch} />

      {/* Optional duration */}
      <DurationField label="Exercise duration" value={duration} onChange={setDuration} optional />
    </div>
  );
}

function SignatureSubdivision({ settings, patch }: { settings: Settings; patch: (p: Partial<Settings>) => void }) {
  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]"><Music2 className="h-3.5 w-3.5 text-[var(--accent)]" /> Time signature</div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <button onClick={() => patch({ beats: Math.max(1, settings.beats - 1) })} aria-label="Fewer beats" className="btn flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-2)]"><Minus className="h-4 w-4" /></button>
            <span className="num w-7 text-center text-2xl font-bold">{settings.beats}</span>
            <button onClick={() => patch({ beats: Math.min(12, settings.beats + 1) })} aria-label="More beats" className="btn flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-2)]"><Plus className="h-4 w-4" /></button>
          </div>
          <span className="text-2xl font-light text-[var(--faint)]">/</span>
          <div className="flex gap-1.5">
            {DENOMS.map((d) => (
              <button key={d} onClick={() => patch({ denom: d })} aria-label={`Note value ${d}`} aria-pressed={settings.denom === d}
                className="btn num flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold"
                style={{ background: settings.denom === d ? "var(--accent)" : "var(--surface-2)", color: settings.denom === d ? "var(--bg)" : "var(--text)" }}>{d}</button>
            ))}
          </div>
          <button onClick={() => patch({ accentFirst: !settings.accentFirst })} aria-label="Accent first beat" aria-pressed={settings.accentFirst}
            className="pill ml-auto rounded-full border px-3 py-1.5 text-[12px] font-semibold"
            style={{ borderColor: settings.accentFirst ? "var(--accent)" : "var(--border)", color: settings.accentFirst ? "var(--accent)" : "var(--muted)" }}>Accent 1</button>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Subdivision</div>
        <div className="grid grid-cols-4 gap-1.5">
          {SUBDIVISIONS.map((s) => (
            <button key={s.v} onClick={() => patch({ subdivision: s.v })} aria-label={s.name} aria-pressed={settings.subdivision === s.v}
              className="btn flex flex-col items-center gap-0.5 rounded-xl py-2"
              style={{ background: settings.subdivision === s.v ? "var(--accent)" : "var(--surface-2)", color: settings.subdivision === s.v ? "var(--bg)" : "var(--text)" }}>
              <span className="num text-base font-bold">{s.label}</span>
              <span className="text-[10px] opacity-80">{s.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DurationField({ label, value, onChange, optional, timeStep = 15 }: { label: string; value: Dur | null; onChange: (d: Dur | null) => void; optional?: boolean; timeStep?: number }) {
  const enabled = value != null;
  const v = value ?? { unit: "time" as Unit, value: 60 };
  const step = v.unit === "time" ? timeStep : 1;
  return (
    <div className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
      <div className="flex items-center">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]"><Clock className="h-3.5 w-3.5 text-[var(--accent)]" /> {label}</div>
        {optional && (
          <button onClick={() => onChange(enabled ? null : { unit: "time", value: 60 })} aria-label="Toggle duration" aria-pressed={enabled}
            className="pill ml-auto rounded-full border px-3 py-1 text-[12px] font-semibold"
            style={{ borderColor: enabled ? "var(--accent)" : "var(--border)", color: enabled ? "var(--accent)" : "var(--muted)" }}>{enabled ? "On" : "Off"}</button>
        )}
      </div>
      {enabled && (
        <div className="mt-2.5 flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-[var(--border)]">
            {(["time", "bars"] as Unit[]).map((u) => (
              <button key={u} onClick={() => onChange({ unit: u, value: v.value })} aria-label={u === "time" ? "Time" : "Bars"} aria-pressed={v.unit === u}
                className="btn px-3 py-1.5 text-[12px] font-semibold"
                style={{ background: v.unit === u ? "var(--accent)" : "transparent", color: v.unit === u ? "var(--bg)" : "var(--muted)" }}>{u === "time" ? "Time" : "Bars"}</button>
            ))}
          </div>
          <button onClick={() => onChange({ unit: v.unit, value: Math.max(1, v.value - step) })} aria-label={`Decrease ${label}`} className="btn flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-2)]"><Minus className="h-4 w-4" /></button>
          <span className="num min-w-16 text-center text-base font-bold">{v.unit === "time" ? formatHMS(v.value) : `${v.value} bars`}</span>
          <button onClick={() => onChange({ unit: v.unit, value: v.value + step })} aria-label={`Increase ${label}`} className="btn flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-2)]"><Plus className="h-4 w-4" /></button>
        </div>
      )}
    </div>
  );
}

/* ================================================================== *
 * Trainer view
 * ================================================================== */

function TrainerView({ ui, cfg, setCfg, running, pendRef }: { ui: EngineUi; cfg: TrainerConfig; setCfg: (c: TrainerConfig) => void; running: boolean; pendRef: RefObject<SVGGElement> }) {
  const bpm = running ? ui.liveBpm : cfg.startBpm;
  const patch = (p: Partial<TrainerConfig>) => setCfg({ ...cfg, ...p });
  return (
    <div className="mx-auto w-full max-w-xl px-5 pb-6 pt-2">
      <Stage ui={ui} beats={cfg.beats} bpm={bpm} pendRef={pendRef}
        subtitle={running ? (
          <div className="mt-2 flex items-center gap-2 rounded-full bg-[var(--accent-soft)] px-3 py-1 text-[12px] font-semibold text-[var(--accent)]">
            <Target className="h-3.5 w-3.5" /> target {cfg.targetBpm} · next in {formatHMS(Math.ceil(ui.remainMs / 1000))}
          </div>
        ) : (
          <div className="mt-2 text-[12px] text-[var(--muted)]">{cfg.startBpm} → {cfg.targetBpm} BPM · +{cfg.incrementBpm} every {formatHMS(cfg.intervalSeconds)}</div>
        )} />

      <div className="mt-5 grid grid-cols-2 gap-3">
        <NumField label="Start BPM" value={cfg.startBpm} min={BPM_MIN} max={BPM_MAX} step={1} onChange={(v) => patch({ startBpm: v })} disabled={running} />
        <NumField label="Target BPM" value={cfg.targetBpm} min={BPM_MIN} max={BPM_MAX} step={1} onChange={(v) => patch({ targetBpm: v })} disabled={running} />
        <NumField label="Increment" value={cfg.incrementBpm} min={1} max={30} step={1} suffix=" BPM" onChange={(v) => patch({ incrementBpm: v })} disabled={running} />
        <NumField label="Every" value={cfg.intervalSeconds} min={5} max={600} step={5} suffix="s" onChange={(v) => patch({ intervalSeconds: v })} disabled={running} />
      </div>
      <div className="mt-3">
        <SignatureSubdivision settings={cfg} patch={(p) => patch(p)} />
      </div>
    </div>
  );
}

function NumField({ label, value, min, max, step, suffix, onChange, disabled }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (v: number) => void; disabled?: boolean }) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3" style={{ opacity: disabled ? 0.5 : 1 }}>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="flex items-center justify-between">
        <button onClick={() => onChange(clamp(value - step))} disabled={disabled} aria-label={`Decrease ${label}`} className="btn flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-2)]"><Minus className="h-4 w-4" /></button>
        <span className="num text-xl font-bold">{value}{suffix && <span className="ml-0.5 text-xs font-normal text-[var(--faint)]">{suffix}</span>}</span>
        <button onClick={() => onChange(clamp(value + step))} disabled={disabled} aria-label={`Increase ${label}`} className="btn flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-2)]"><Plus className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

/* ================================================================== *
 * Workout list / editor / runner
 * ================================================================== */

function WorkoutList({ workouts, onNew, onEdit, onRun, onDelete, onDuplicate }: { workouts: Workout[]; onNew: () => void; onEdit: (id: string) => void; onRun: (id: string) => void; onDelete: (id: string) => void; onDuplicate: (id: string) => void }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  return (
    <div className="mx-auto w-full max-w-xl px-5 pb-6 pt-3">
      <button onClick={onNew} aria-label="New workout" className="btn mb-3 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-[var(--border)] py-3 text-sm font-semibold text-[var(--muted)]"><Plus className="h-4 w-4" /> New workout</button>
      {workouts.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--faint)]">No workouts yet</p>
      ) : workouts.map((w) => (
        <div key={w.id} className="mb-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="text-[16px] font-semibold">{w.name}</h3>
          <p className="mt-0.5 text-[12px] text-[var(--muted)]">{w.exercises.length} exercises · {w.rest.value > 0 ? `${w.rest.unit === "time" ? formatHMS(w.rest.value) : `${w.rest.value} bars`} rest` : "no rest"}</p>
          <div className="mt-3 flex items-center gap-2">
            <button onClick={() => onRun(w.id)} aria-label={`Run ${w.name}`} className="btn flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] py-2.5 text-sm font-semibold text-[var(--bg)]"><Play className="h-4 w-4" fill="currentColor" /> Run</button>
            <button onClick={() => onEdit(w.id)} aria-label={`Edit ${w.name}`} className="btn flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-2)] text-[var(--muted)]"><Pencil className="h-[18px] w-[18px]" /></button>
            <div className="relative">
              <button onClick={() => setMenuFor((m) => (m === w.id ? null : w.id))} aria-label={`Options for ${w.name}`} aria-expanded={menuFor === w.id} className="btn flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-2)] text-[var(--muted)]"><MoreVertical className="h-[18px] w-[18px]" /></button>
              {menuFor === w.id && (
                <>
                  <button className="fixed inset-0 z-10 cursor-default" aria-label="Close menu" onClick={() => setMenuFor(null)} />
                  <div className="menu absolute right-0 top-full z-20 mt-1.5 w-44 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-xl">
                    <button onClick={() => { onDuplicate(w.id); setMenuFor(null); }} aria-label={`Duplicate ${w.name}`} className="btn flex w-full items-center gap-2.5 px-3.5 py-3 text-left text-sm hover:bg-[var(--surface-2)]"><Copy className="h-[18px] w-[18px] text-[var(--muted)]" /> Duplicate</button>
                    <button onClick={() => { setConfirm(w.id); setMenuFor(null); }} aria-label={`Delete ${w.name}`} className="btn flex w-full items-center gap-2.5 px-3.5 py-3 text-left text-sm text-rose-400 hover:bg-[var(--surface-2)]"><Trash2 className="h-[18px] w-[18px]" /> Delete</button>
                  </div>
                </>
              )}
            </div>
          </div>
          {confirm === w.id && (
            <div className="mt-2.5 flex items-center gap-2 rounded-xl bg-[var(--surface-2)] p-2.5 text-[13px]">
              <span className="text-[var(--muted)]">Delete?</span>
              <button onClick={() => setConfirm(null)} className="btn ml-auto px-2 text-[var(--muted)]">Cancel</button>
              <button onClick={() => { onDelete(w.id); setConfirm(null); }} aria-label={`Confirm delete ${w.name}`} className="btn rounded-lg bg-rose-500 px-3 py-1 font-semibold text-white">Delete</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function newExercise(i: number): Exercise {
  return { id: genId(), name: `Exercise ${i}`, bpm: 100, beats: 4, denom: 4, subdivision: 1, accentFirst: true, duration: { unit: "time", value: 60 } };
}

function WorkoutEditor({ workout, onCancel, onSave }: { workout: Workout | null; onCancel: () => void; onSave: (w: Workout) => void }) {
  const [name, setName] = useState(workout?.name ?? "");
  const [exercises, setExercises] = useState<Exercise[]>(workout?.exercises.map((e) => ({ ...e })) ?? [newExercise(1)]);
  const [rest, setRest] = useState<Dur>(workout?.rest ?? { unit: "time", value: 15 });

  const upd = (id: string, patch: Partial<Exercise>) => setExercises((p) => p.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const move = (i: number, d: -1 | 1) => setExercises((p) => { const n = [...p]; const j = i + d; if (j < 0 || j >= n.length) return p; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const dup = (i: number) => setExercises((p) => {
    const copy: Exercise = { ...p[i], id: genId(), name: nextDuplicateName(p[i].name) };
    const n = [...p];
    n.splice(i + 1, 0, copy);
    return n;
  });

  const save = () => {
    const now = Date.now();
    onSave({
      id: workout?.id ?? genId(),
      name: name.trim() || "Untitled workout",
      exercises: exercises.map((e, i) => ({ ...e, name: e.name.trim() || `Exercise ${i + 1}`, bpm: clampBpm(e.bpm) })),
      rest,
      createdAt: workout?.createdAt ?? now,
      updatedAt: now,
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-4 py-2.5">
        <button onClick={onCancel} aria-label="Cancel" className="btn flex items-center gap-1 rounded-full px-2 py-1.5 text-sm text-[var(--muted)]"><X className="h-[18px] w-[18px]" /> Cancel</button>
        <h2 className="ml-1 text-[15px] font-semibold">{workout ? "Edit workout" : "New workout"}</h2>
        <button onClick={save} aria-label="Save workout" className="btn ml-auto flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-semibold text-[var(--bg)]"><Check className="h-4 w-4" /> Save</button>
      </div>
      <div className="scroll flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto w-full max-w-xl space-y-3">
          <label className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Workout name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Workout name" placeholder="Daily warm-up" className="mt-1 w-full bg-transparent text-[16px] font-medium outline-none placeholder:text-[var(--faint)]" />
          </label>

          {exercises.map((ex, i) => (
            <div key={ex.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="flex items-center gap-2">
                <div className="flex flex-col">
                  <button onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${ex.name} up`} className="btn flex h-5 w-6 items-center justify-center text-[var(--faint)]"><ChevronUp className="h-4 w-4" /></button>
                  <button onClick={() => move(i, 1)} disabled={i === exercises.length - 1} aria-label={`Move ${ex.name} down`} className="btn flex h-5 w-6 items-center justify-center text-[var(--faint)]"><ChevronDown className="h-4 w-4" /></button>
                </div>
                <input value={ex.name} onChange={(e) => upd(ex.id, { name: e.target.value })} aria-label="Exercise name" className="min-w-0 flex-1 bg-transparent text-[15px] font-medium outline-none" />
                <button onClick={() => dup(i)} aria-label={`Duplicate ${ex.name}`} className="btn flex h-8 w-8 items-center justify-center rounded-lg text-[var(--faint)] hover:text-[var(--accent)]"><Copy className="h-4 w-4" /></button>
                <button onClick={() => setExercises((p) => (p.length > 1 ? p.filter((e) => e.id !== ex.id) : p))} disabled={exercises.length <= 1} aria-label={`Remove ${ex.name}`} className="btn flex h-8 w-8 items-center justify-center rounded-lg text-[var(--faint)] hover:text-rose-400"><Trash2 className="h-4 w-4" /></button>
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <MiniNum label="BPM" value={ex.bpm} min={BPM_MIN} max={BPM_MAX} step={5} onChange={(v) => upd(ex.id, { bpm: v })} />
                <MiniNum label="Beats" value={ex.beats} min={1} max={12} step={1} onChange={(v) => upd(ex.id, { beats: v })} />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Sub</span>
                <div className="flex gap-1">
                  {SUBDIVISIONS.map((s) => (
                    <button key={s.v} onClick={() => upd(ex.id, { subdivision: s.v })} aria-label={`${ex.name} ${s.name}`} aria-pressed={ex.subdivision === s.v} className="btn num flex h-7 w-7 items-center justify-center rounded-md text-[12px] font-bold" style={{ background: ex.subdivision === s.v ? "var(--accent)" : "var(--surface-2)", color: ex.subdivision === s.v ? "var(--bg)" : "var(--text)" }}>{s.label}</button>
                  ))}
                </div>
              </div>
              <div className="mt-2"><DurationField label="Duration" value={ex.duration} onChange={(d) => upd(ex.id, { duration: d ?? { unit: "time", value: 60 } })} /></div>
            </div>
          ))}

          <button onClick={() => setExercises((p) => [...p, newExercise(p.length + 1)])} aria-label="Add exercise" className="btn flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-[var(--border)] py-2.5 text-sm font-medium text-[var(--muted)]"><Plus className="h-4 w-4" /> Add exercise</button>

          <DurationField label="Rest between exercises" value={rest} onChange={(d) => setRest(d ?? { unit: "time", value: 0 })} timeStep={1} />
        </div>
      </div>
    </div>
  );
}

function MiniNum({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="rounded-xl bg-[var(--surface-2)] px-2.5 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="flex items-center justify-between">
        <button onClick={() => onChange(clamp(value - step))} aria-label={`Decrease ${label}`} className="btn flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface)]"><Minus className="h-3.5 w-3.5" /></button>
        <span className="num text-base font-bold">{value}</span>
        <button onClick={() => onChange(clamp(value + step))} aria-label={`Increase ${label}`} className="btn flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface)]"><Plus className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}

function WorkoutRunner({ ui, workout, pendRef, onBack }: { ui: EngineUi; workout: Workout; pendRef: RefObject<SVGGElement>; onBack: () => void }) {
  const exerciseCount = workout.exercises.length;
  const exerciseNumber = Math.min(exerciseCount, Math.floor(ui.segIdx / (workout.rest.value > 0 ? 2 : 1)) + 1);
  return (
    <div className="mx-auto w-full max-w-xl px-5 pb-6 pt-2">
      <button onClick={onBack} aria-label="Back" className="btn mb-1 flex items-center gap-1 text-sm text-[var(--muted)]"><ArrowLeft className="h-4 w-4" /> {workout.name}</button>
      <Stage ui={ui} beats={ui.beats} bpm={ui.playing ? ui.liveBpm : (workout.exercises[0]?.bpm ?? 120)} pendRef={pendRef}
        subtitle={
          <div className="mt-3 flex flex-col items-center gap-1">
            <span className="rounded-full px-3 py-1 text-[13px] font-bold" style={{ background: ui.kind === "rest" ? "var(--surface-2)" : "var(--accent-soft)", color: ui.kind === "rest" ? "var(--muted)" : "var(--accent)" }}>{ui.playing ? ui.label : "Ready"}</span>
            {ui.playing && (
              <span className="text-[12px] text-[var(--muted)]">
                {ui.kind !== "rest" && `Exercise ${exerciseNumber} of ${exerciseCount} · `}
                {ui.endUnit === "time" && Number.isFinite(ui.endValue) ? `${formatHMS(Math.ceil(ui.remainMs / 1000))} left` : `${ui.barsRemaining} bars left`}
              </span>
            )}
          </div>
        } />
      {!ui.playing && (
        <p className="mt-5 text-center text-[13px] text-[var(--muted)]">Press start to run “{workout.name}”.</p>
      )}
    </div>
  );
}

/* ================================================================== *
 * Practice history
 * ================================================================== */

function PracticeHistory({ practice, onClose }: { practice: Record<string, number>; onClose: () => void }) {
  const days: { key: string; secs: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = todayKey(d);
    days.push({ key: k, secs: practice[k] ?? 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.secs));
  const total = Object.values(practice).reduce((a, b) => a + b, 0);
  return (
    <div className="absolute inset-0 z-30 flex items-end justify-center sm:items-center">
      <button aria-label="Close history" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="rise relative m-4 w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="mb-4 flex items-center">
          <h2 className="text-base font-semibold">Practice — last 7 days</h2>
          <button onClick={onClose} aria-label="Close" className="btn ml-auto flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2">
          {days.map((d, i) => (
            <div key={d.key} className="flex items-center gap-3">
              <span className="w-10 text-[11px] text-[var(--faint)]">{i === 0 ? "Today" : d.key.slice(5)}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
                <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${(d.secs / max) * 100}%` }} />
              </div>
              <span className="num w-14 text-right text-[12px] font-semibold">{formatHMS(d.secs)}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 border-t border-[var(--border)] pt-3 text-[12px] text-[var(--muted)]">All-time: <span className="num font-bold text-[var(--text)]">{formatHMS(total)}</span></div>
      </div>
    </div>
  );
}
