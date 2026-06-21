import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, CSSProperties } from "react";
import {
  Compass,
  Plus,
  MapPin,
  Map as MapIcon,
  Library,
  Camera,
  ChevronLeft,
  Trash2,
  X,
  Crosshair,
  LocateFixed,
  LocateOff,
  Loader2,
  ImageOff,
  Check,
  AlertTriangle,
  Navigation,
} from "lucide-react";

/* ================================================================== *
 * Data model
 * ================================================================== */

export interface Entry {
  id: string;
  title: string;
  note: string;
  photo: string | null; // dataURL
  lat: number | null;
  lng: number | null;
  accuracy: number | null; // meters
  ts: number;
}

/* ================================================================== *
 * IndexedDB layer (hand-rolled, zero-dependency) — fully offline.
 * ================================================================== */

const DB_NAME = "geo-field-journal";
const DB_VERSION = 1;
const STORE = "entries";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: "id" });
        s.createIndex("ts", "ts");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listEntries(): Promise<Entry[]> {
  const db = await openDB();
  try {
    const all = await reqToPromise(tx(db, "readonly").getAll() as IDBRequest<Entry[]>);
    return all.sort((a, b) => b.ts - a.ts);
  } finally {
    db.close();
  }
}

export async function putEntry(entry: Entry): Promise<void> {
  const db = await openDB();
  try {
    await reqToPromise(tx(db, "readwrite").put(entry));
  } finally {
    db.close();
  }
}

export async function deleteEntry(id: string): Promise<void> {
  const db = await openDB();
  try {
    await reqToPromise(tx(db, "readwrite").delete(id));
  } finally {
    db.close();
  }
}

/* ================================================================== *
 * Geometry / formatting helpers
 * ================================================================== */

export function genId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface PlottedPin {
  id: string;
  x: number;
  y: number;
}

export interface MapProjection {
  pins: PlottedPin[];
  width: number;
  height: number;
}

/**
 * Normalize a set of geo-points into an SVG viewBox of `size` x `size`.
 *
 * - Auto-fits the bounding box of all lat/lng with a margin (in viewBox units).
 * - Latitude increases upward, so y is flipped (north = top).
 * - Degenerate cases (single point, or all-identical coords) center the pins
 *   instead of dividing by zero.
 * - Points without coordinates are skipped.
 */
export function projectPins(
  points: { id: string; lat: number | null; lng: number | null }[],
  size = 1000,
  margin = 80
): MapProjection {
  const valid = points.filter(
    (p): p is { id: string; lat: number; lng: number } =>
      typeof p.lat === "number" &&
      typeof p.lng === "number" &&
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lng)
  );

  if (valid.length === 0) {
    return { pins: [], width: size, height: size };
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of valid) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  const spanLat = maxLat - minLat;
  const spanLng = maxLng - minLng;
  const inner = size - margin * 2;
  const cx = size / 2;
  const cy = size / 2;

  const pins: PlottedPin[] = valid.map((p) => {
    const x =
      spanLng === 0 ? cx : margin + ((p.lng - minLng) / spanLng) * inner;
    // Flip latitude so north is at the top of the viewBox.
    const y =
      spanLat === 0 ? cy : margin + ((maxLat - p.lat) / spanLat) * inner;
    return { id: p.id, x, y };
  });

  return { pins, width: size, height: size };
}

export function formatCoord(lat: number | null, lng: number | null): string {
  if (lat == null || lng == null) return "no fix";
  const la = `${Math.abs(lat).toFixed(5)}°${lat >= 0 ? "N" : "S"}`;
  const lo = `${Math.abs(lng).toFixed(5)}°${lng >= 0 ? "E" : "W"}`;
  return `${la}  ${lo}`;
}

export function formatAccuracy(acc: number | null): string {
  if (acc == null || !Number.isFinite(acc)) return "";
  if (acc < 1000) return `±${Math.round(acc)}m`;
  return `±${(acc / 1000).toFixed(1)}km`;
}

function relTime(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function absTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ================================================================== *
 * Device-API helpers (feature-detected; safe in jsdom/desktop)
 * ================================================================== */

function hasGeolocation(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
}

type GeoErr = "denied" | "unavailable" | "timeout" | "unsupported";

function getFix(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!hasGeolocation()) {
      reject("unsupported" as GeoErr);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) => {
        const code = err?.code;
        if (code === 1) reject("denied" as GeoErr);
        else if (code === 3) reject("timeout" as GeoErr);
        else reject("unavailable" as GeoErr);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  });
}

/**
 * Read an image File, downscale to <= maxDim on the longest edge via a canvas,
 * return a JPEG dataURL. Falls back to a raw FileReader dataURL if canvas is
 * unavailable (e.g. some test environments).
 */
function readAndDownscale(file: File, maxDim = 1280): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const raw = String(reader.result || "");
      const Img = (globalThis as { Image?: typeof Image }).Image;
      const canDownscale =
        typeof document !== "undefined" &&
        typeof document.createElement === "function" &&
        typeof Img === "function";
      if (!canDownscale) {
        resolve(raw);
        return;
      }
      const img = new Img();
      img.onerror = () => resolve(raw); // can't decode → keep original
      img.onload = () => {
        try {
          const { width, height } = img;
          if (!width || !height) {
            resolve(raw);
            return;
          }
          const scale = Math.min(1, maxDim / Math.max(width, height));
          const w = Math.max(1, Math.round(width * scale));
          const h = Math.max(1, Math.round(height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(raw);
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        } catch {
          resolve(raw);
        }
      };
      img.src = raw;
    };
    reader.readAsDataURL(file);
  });
}

/* ================================================================== *
 * Scoped styles — "field survey / topographic"
 * ================================================================== */

const STYLES = `
.gfj {
  --font-ui: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
  --bg: #0f1311;
  --bg-2: #131816;
  --surface: #19201d;
  --surface-2: #212a26;
  --line: #2a342f;
  --text: #eef2ef;
  --muted: #9aa8a0;
  --faint: #61706a;
  --accent: #f5a524;
  --accent-2: #ff8a3d;
  --danger: #f87171;
  font-family: var(--font-ui);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  background-color: var(--bg);
  background-image:
    linear-gradient(var(--line) 1px, transparent 1px),
    linear-gradient(90deg, var(--line) 1px, transparent 1px);
  background-size: 28px 28px, 28px 28px;
}
.gfj .topo {
  background-image:
    repeating-radial-gradient(circle at 30% 20%, transparent 0 38px, rgba(245,165,36,.05) 38px 39px),
    repeating-radial-gradient(circle at 78% 72%, transparent 0 46px, rgba(245,165,36,.045) 46px 47px);
  pointer-events: none;
}
.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.btn { transition: transform .08s ease, background .15s ease, color .15s ease, border-color .15s ease; }
.btn:active { transform: scale(.96); }
.tab.active { color: var(--accent); }

.fade { animation: fade .22s ease both; }
.up { animation: up .26s cubic-bezier(.2,.8,.2,1) both; }
.sheet { animation: slideUp .28s cubic-bezier(.2,.8,.2,1) both; }
@keyframes fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes up { from { transform: translateY(10px); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes slideUp { from { transform: translateY(100%) } to { transform: none } }

.locate-dot { animation: ping 1.6s ease-in-out infinite; }
@keyframes ping { 0%,100% { opacity: 1 } 50% { opacity: .3 } }

.pin-hit { cursor: pointer; }
.pin-hit:focus { outline: none; }

@media (prefers-reduced-motion: reduce) {
  .fade, .up, .sheet, .locate-dot { animation: none; }
}
`;

/* ================================================================== *
 * App
 * ================================================================== */

type View = "library" | "detail" | "map";

export default function App() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<View>("library");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  const now = Date.now();

  /* Load from IndexedDB on mount. */
  useEffect(() => {
    let alive = true;
    listEntries()
      .then((rows) => {
        if (alive) setEntries(rows);
      })
      .catch(() => {
        /* db unavailable — stay empty */
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const active = useMemo(
    () => entries.find((e) => e.id === activeId) ?? null,
    [entries, activeId]
  );

  const saveEntry = useCallback(async (entry: Entry) => {
    setEntries((prev) => [entry, ...prev.filter((e) => e.id !== entry.id)].sort((a, b) => b.ts - a.ts));
    try {
      await putEntry(entry);
    } catch {
      /* write failed — in-memory copy remains */
    }
  }, []);

  const removeEntry = useCallback(async (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    setActiveId((cur) => (cur === id ? null : cur));
    setView((v) => (v === "detail" ? "library" : v));
    try {
      await deleteEntry(id);
    } catch {
      /* ignore */
    }
  }, []);

  const openEntry = useCallback((id: string) => {
    setActiveId(id);
    setView("detail");
  }, []);

  return (
    <div className="gfj relative flex h-[100dvh] w-full flex-col overflow-hidden">
      <style>{STYLES}</style>
      <div className="topo pointer-events-none absolute inset-0 z-0" />

      {/* Header */}
      <header
        className="relative z-10 flex items-center gap-2 border-b border-[var(--line)] bg-[var(--bg-2)]/80 px-4 backdrop-blur"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))", paddingBottom: "0.75rem" }}
      >
        {view === "detail" ? (
          <button
            aria-label="Back to library"
            onClick={() => setView("library")}
            className="btn -ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-2)]"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)]/15 text-[var(--accent)]">
            <Compass className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold leading-tight tracking-tight">
            {view === "detail" ? active?.title || "Entry" : "Field Journal"}
          </h1>
          <p className="mono text-[10.5px] leading-tight text-[var(--faint)]">
            {view === "map"
              ? "OFFLINE SURVEY MAP"
              : view === "detail"
                ? formatCoord(active?.lat ?? null, active?.lng ?? null)
                : `${entries.length} ENTR${entries.length === 1 ? "Y" : "IES"} · OFFLINE`}
          </p>
        </div>
      </header>

      {/* Body */}
      <main className="relative z-10 flex-1 overflow-y-auto">
        {!loaded ? (
          <div className="flex h-full items-center justify-center text-[var(--faint)]">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : view === "library" ? (
          <LibraryView entries={entries} now={now} onOpen={openEntry} onNew={() => setComposerOpen(true)} />
        ) : view === "map" ? (
          <MapView entries={entries} activeId={activeId} onSelect={openEntry} />
        ) : active ? (
          <DetailView entry={active} onDelete={() => removeEntry(active.id)} onMap={() => setView("map")} />
        ) : (
          <div className="flex h-full items-center justify-center text-[var(--faint)]">Entry not found</div>
        )}
      </main>

      {/* Bottom nav (hidden on detail) */}
      {view !== "detail" && (
        <nav
          className="relative z-10 flex items-stretch border-t border-[var(--line)] bg-[var(--bg-2)]/90 backdrop-blur"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <TabButton
            label="Library"
            active={view === "library"}
            onClick={() => setView("library")}
            icon={<Library className="h-5 w-5" />}
          />
          <div className="flex items-center justify-center px-2">
            <button
              aria-label="New entry"
              onClick={() => setComposerOpen(true)}
              className="btn -mt-7 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent)] text-[#1a1207] shadow-lg shadow-[var(--accent)]/20 ring-4 ring-[var(--bg-2)]"
            >
              <Plus className="h-7 w-7" strokeWidth={2.5} />
            </button>
          </div>
          <TabButton
            label="Map"
            active={view === "map"}
            onClick={() => setView("map")}
            icon={<MapIcon className="h-5 w-5" />}
          />
        </nav>
      )}

      {composerOpen && (
        <Composer
          onClose={() => setComposerOpen(false)}
          onSave={async (e) => {
            await saveEntry(e);
            setComposerOpen(false);
            setActiveId(e.id);
            setView("detail");
          }}
        />
      )}
    </div>
  );
}

/* ================================================================== *
 * Library
 * ================================================================== */

function LibraryView({
  entries,
  now,
  onOpen,
  onNew,
}: {
  entries: Entry[];
  now: number;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-dashed border-[var(--line)] text-[var(--accent)]">
          <Navigation className="h-7 w-7" />
        </div>
        <div>
          <h2 className="text-base font-semibold">No entries yet</h2>
          <p className="mt-1 max-w-[15rem] text-sm text-[var(--muted)]">
            Capture a geotagged photo note to start your survey log.
          </p>
        </div>
        <button
          onClick={onNew}
          className="btn flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#1a1207]"
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} /> New entry
        </button>
      </div>
    );
  }

  return (
    <ul className="mx-auto w-full max-w-2xl space-y-2.5 p-3 md:p-4">
      {entries.map((e) => (
        <li key={e.id}>
          <button
            onClick={() => onOpen(e.id)}
            className="btn up flex w-full items-stretch gap-3 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-2.5 text-left hover:border-[var(--accent)]/40"
          >
            <Thumb photo={e.photo} className="h-[72px] w-[72px] shrink-0 rounded-xl md:h-20 md:w-20" />
            <div className="flex min-w-0 flex-1 flex-col justify-center py-0.5">
              <div className="flex items-baseline gap-2">
                <h3 className="truncate text-[15px] font-semibold leading-tight">{e.title || "Untitled"}</h3>
                <span className="mono ml-auto shrink-0 text-[10px] text-[var(--faint)]">{relTime(e.ts, now)}</span>
              </div>
              {e.note && (
                <p className="mt-0.5 line-clamp-1 text-[12.5px] text-[var(--muted)]">{e.note}</p>
              )}
              <div className="mono mt-1.5 flex items-center gap-1.5 text-[10.5px]">
                {e.lat != null && e.lng != null ? (
                  <>
                    <MapPin className="h-3 w-3 text-[var(--accent)]" />
                    <span className="truncate text-[var(--muted)]">{formatCoord(e.lat, e.lng)}</span>
                  </>
                ) : (
                  <>
                    <LocateOff className="h-3 w-3 text-[var(--faint)]" />
                    <span className="text-[var(--faint)]">no location</span>
                  </>
                )}
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ================================================================== *
 * Detail
 * ================================================================== */

function DetailView({
  entry,
  onDelete,
  onMap,
}: {
  entry: Entry;
  onDelete: () => void;
  onMap: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const hasGeo = entry.lat != null && entry.lng != null;
  return (
    <div className="fade mx-auto w-full max-w-2xl p-3 md:p-4">
      {entry.photo ? (
        <img
          src={entry.photo}
          alt={entry.title || "Field photo"}
          className="aspect-[4/3] w-full rounded-2xl border border-[var(--line)] object-cover"
        />
      ) : (
        <div className="flex aspect-[4/3] w-full items-center justify-center rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface)] text-[var(--faint)]">
          <ImageOff className="h-8 w-8" />
        </div>
      )}

      <div className="mt-4">
        <h2 className="text-xl font-semibold leading-tight">{entry.title || "Untitled"}</h2>
        <p className="mono mt-1 text-[11px] text-[var(--faint)]">{absTime(entry.ts)}</p>
      </div>

      {entry.note && (
        <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed text-[var(--muted)]">{entry.note}</p>
      )}

      {/* Coordinate card */}
      <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3.5">
        <div className="flex items-center gap-2 text-[var(--accent)]">
          <Crosshair className="h-4 w-4" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Coordinates</span>
          {hasGeo && entry.accuracy != null && (
            <span className="mono ml-auto text-[10.5px] text-[var(--faint)]">{formatAccuracy(entry.accuracy)}</span>
          )}
        </div>
        {hasGeo ? (
          <>
            <div className="mono mt-2 grid grid-cols-2 gap-2 text-[13px]">
              <div>
                <div className="text-[9.5px] uppercase tracking-wide text-[var(--faint)]">Lat</div>
                <div>{entry.lat!.toFixed(6)}</div>
              </div>
              <div>
                <div className="text-[9.5px] uppercase tracking-wide text-[var(--faint)]">Lng</div>
                <div>{entry.lng!.toFixed(6)}</div>
              </div>
            </div>
            <button
              onClick={onMap}
              className="btn mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--surface-2)] py-2.5 text-sm font-medium hover:bg-[var(--line)]"
            >
              <MapIcon className="h-4 w-4 text-[var(--accent)]" /> Show on map
            </button>
          </>
        ) : (
          <p className="mt-2 text-[13px] text-[var(--faint)]">No location was attached to this entry.</p>
        )}
      </div>

      {/* Delete */}
      <div className="mt-4">
        {confirm ? (
          <div className="flex items-center gap-2 rounded-xl border border-[var(--danger)]/40 bg-[var(--danger)]/10 p-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--danger)]" />
            <span className="text-[13px] text-[var(--muted)]">Delete this entry?</span>
            <div className="ml-auto flex gap-1.5">
              <button
                onClick={() => setConfirm(false)}
                className="btn rounded-lg px-3 py-1.5 text-[13px] text-[var(--muted)] hover:bg-[var(--surface-2)]"
              >
                Cancel
              </button>
              <button
                onClick={onDelete}
                className="btn rounded-lg bg-[var(--danger)] px-3 py-1.5 text-[13px] font-semibold text-[#1a0d0d]"
              >
                Delete
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirm(true)}
            className="btn flex items-center gap-2 text-[13px] text-[var(--faint)] hover:text-[var(--danger)]"
          >
            <Trash2 className="h-4 w-4" /> Delete entry
          </button>
        )}
      </div>
    </div>
  );
}

/* ================================================================== *
 * Map (offline SVG)
 * ================================================================== */

function MapView({
  entries,
  activeId,
  onSelect,
}: {
  entries: Entry[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const SIZE = 1000;
  const projection = useMemo(
    () => projectPins(entries.map((e) => ({ id: e.id, lat: e.lat, lng: e.lng })), SIZE),
    [entries]
  );
  const located = useMemo(() => entries.filter((e) => e.lat != null && e.lng != null), [entries]);
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  if (located.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <LocateOff className="h-9 w-9 text-[var(--faint)]" />
        <h2 className="text-base font-semibold">Nothing to plot</h2>
        <p className="max-w-[16rem] text-sm text-[var(--muted)]">
          Entries with GPS coordinates will appear on this offline survey map.
        </p>
      </div>
    );
  }

  const gridLines = [0.2, 0.4, 0.6, 0.8];

  return (
    <div className="fade flex h-full flex-col p-3 md:p-4">
      <div className="relative flex-1 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--bg-2)]">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="h-full w-full"
          role="img"
          aria-label="Offline map of journal entries"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* faint coordinate grid */}
          <rect x={0} y={0} width={SIZE} height={SIZE} fill="var(--bg-2)" />
          {gridLines.map((g) => (
            <g key={g} stroke="var(--line)" strokeWidth={1}>
              <line x1={g * SIZE} y1={0} x2={g * SIZE} y2={SIZE} />
              <line x1={0} y1={g * SIZE} x2={SIZE} y2={g * SIZE} />
            </g>
          ))}
          <rect
            x={1}
            y={1}
            width={SIZE - 2}
            height={SIZE - 2}
            fill="none"
            stroke="var(--line)"
            strokeWidth={2}
          />

          {/* connect path (survey route) when multiple pins */}
          {projection.pins.length > 1 && (
            <polyline
              points={projection.pins.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="var(--accent)"
              strokeOpacity={0.28}
              strokeWidth={2}
              strokeDasharray="6 6"
            />
          )}

          {/* pins */}
          {projection.pins.map((p, i) => {
            const entry = byId.get(p.id);
            const isActive = p.id === activeId;
            return (
              <g
                key={p.id}
                className="pin-hit"
                role="button"
                tabIndex={0}
                aria-label={`Open ${entry?.title || "entry"}`}
                onClick={() => onSelect(p.id)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") onSelect(p.id);
                }}
              >
                <circle cx={p.x} cy={p.y} r={isActive ? 26 : 18} fill="var(--accent)" fillOpacity={0.16} />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isActive ? 12 : 9}
                  fill={isActive ? "var(--accent-2)" : "var(--accent)"}
                  stroke="#1a1207"
                  strokeWidth={2.5}
                />
                <text
                  x={p.x}
                  y={p.y - 26}
                  textAnchor="middle"
                  fontSize={26}
                  fontFamily="var(--font-mono)"
                  fill="var(--text)"
                >
                  {i + 1}
                </text>
              </g>
            );
          })}
        </svg>

        {/* corner readout */}
        <div className="mono pointer-events-none absolute bottom-2 left-2 rounded-md bg-[var(--bg)]/80 px-2 py-1 text-[10px] text-[var(--faint)]">
          {located.length} PIN{located.length === 1 ? "" : "S"} · AUTO-FIT
        </div>
      </div>

      {/* legend / list */}
      <div className="mt-3 max-h-40 shrink-0 overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-1.5">
        {located.map((e, i) => (
          <button
            key={e.id}
            onClick={() => onSelect(e.id)}
            className={`btn flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-[var(--surface-2)] ${
              e.id === activeId ? "bg-[var(--surface-2)]" : ""
            }`}
          >
            <span className="mono flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--accent)]/15 text-[11px] font-semibold text-[var(--accent)]">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{e.title || "Untitled"}</span>
              <span className="mono block truncate text-[10px] text-[var(--faint)]">{formatCoord(e.lat, e.lng)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ================================================================== *
 * Composer (new entry)
 * ================================================================== */

type GeoState =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "ok"; fix: Fix }
  | { kind: "error"; err: GeoErr };

function Composer({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (e: Entry) => void | Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [geo, setGeo] = useState<GeoState>({ kind: "idle" });
  const [manual, setManual] = useState(false);
  const [manLat, setManLat] = useState("");
  const [manLng, setManLng] = useState("");
  const [saving, setSaving] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const geoSupported = useMemo(hasGeolocation, []);

  /* Try to grab a GPS fix as soon as the composer opens (if supported). */
  useEffect(() => {
    if (!geoSupported) {
      setGeo({ kind: "error", err: "unsupported" });
      setManual(true);
      return;
    }
    let alive = true;
    setGeo({ kind: "locating" });
    getFix()
      .then((fix) => {
        if (alive) setGeo({ kind: "ok", fix });
      })
      .catch((err: GeoErr) => {
        if (!alive) return;
        setGeo({ kind: "error", err });
        setManual(true);
      });
    return () => {
      alive = false;
    };
  }, [geoSupported]);

  const retryLocate = useCallback(() => {
    setGeo({ kind: "locating" });
    getFix()
      .then((fix) => setGeo({ kind: "ok", fix }))
      .catch((err: GeoErr) => {
        setGeo({ kind: "error", err });
        setManual(true);
      });
  }, []);

  const onPhotoPick = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setPhotoBusy(true);
    try {
      const url = await readAndDownscale(file, 1280);
      setPhoto(url);
    } catch {
      /* ignore decode failure */
    } finally {
      setPhotoBusy(false);
    }
  }, []);

  const parsedManual = useMemo(() => {
    if (!manual) return null;
    const la = parseFloat(manLat);
    const lo = parseFloat(manLng);
    if (
      Number.isFinite(la) &&
      Number.isFinite(lo) &&
      la >= -90 &&
      la <= 90 &&
      lo >= -180 &&
      lo <= 180
    ) {
      return { lat: la, lng: lo };
    }
    return null;
  }, [manual, manLat, manLng]);

  const resolved = useMemo<{ lat: number | null; lng: number | null; accuracy: number | null }>(() => {
    if (manual) {
      return parsedManual
        ? { lat: parsedManual.lat, lng: parsedManual.lng, accuracy: null }
        : { lat: null, lng: null, accuracy: null };
    }
    if (geo.kind === "ok") return { lat: geo.fix.lat, lng: geo.fix.lng, accuracy: geo.fix.accuracy };
    return { lat: null, lng: null, accuracy: null };
  }, [manual, parsedManual, geo]);

  const manualInvalid = manual && (manLat.trim() !== "" || manLng.trim() !== "") && !parsedManual;

  const canSave = title.trim().length > 0 || note.trim().length > 0 || photo != null;

  const submit = useCallback(async () => {
    if (!canSave || saving) return;
    setSaving(true);
    const entry: Entry = {
      id: genId(),
      title: title.trim() || "Untitled",
      note: note.trim(),
      photo,
      lat: resolved.lat,
      lng: resolved.lng,
      accuracy: resolved.accuracy,
      ts: Date.now(),
    };
    await onSave(entry);
  }, [canSave, saving, title, note, photo, resolved, onSave]);

  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center md:items-center">
      <button aria-label="Cancel" className="fade absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="sheet relative flex max-h-[92%] w-full max-w-lg flex-col rounded-t-3xl border border-[var(--line)] bg-[var(--surface)] md:rounded-3xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" } as CSSProperties}
      >
        {/* header */}
        <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3">
          <Camera className="h-5 w-5 text-[var(--accent)]" />
          <h2 className="text-base font-semibold">New field entry</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="btn ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-2)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {/* Photo capture */}
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              aria-label="Capture photo"
              onChange={(e) => onPhotoPick(e.target.files?.[0])}
            />
            {photo ? (
              <div className="relative">
                <img
                  src={photo}
                  alt="Captured"
                  className="aspect-[4/3] w-full rounded-2xl border border-[var(--line)] object-cover"
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  className="btn absolute bottom-2 right-2 flex items-center gap-1.5 rounded-lg bg-[var(--bg)]/85 px-3 py-1.5 text-[12px] font-medium backdrop-blur"
                >
                  <Camera className="h-3.5 w-3.5" /> Retake
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                className="btn flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--bg-2)] text-[var(--muted)] hover:border-[var(--accent)]/40"
              >
                {photoBusy ? (
                  <Loader2 className="h-7 w-7 animate-spin text-[var(--accent)]" />
                ) : (
                  <>
                    <Camera className="h-8 w-8 text-[var(--accent)]" />
                    <span className="text-sm font-medium">Capture photo</span>
                    <span className="text-[11px] text-[var(--faint)]">camera or library</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* Location status */}
          <LocationBlock
            geo={geo}
            manual={manual}
            manLat={manLat}
            manLng={manLng}
            manualInvalid={manualInvalid}
            onRetry={retryLocate}
            onToggleManual={() => setManual((m) => !m)}
            onLat={setManLat}
            onLng={setManLng}
          />

          {/* Title */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">
              Title
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Trailhead marker"
              aria-label="Entry title"
              className="w-full rounded-xl border border-[var(--line)] bg-[var(--bg-2)] px-3 py-2.5 text-[15px] outline-none placeholder:text-[var(--faint)] focus:border-[var(--accent)]/60"
            />
          </div>

          {/* Note */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">
              Note
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Observations, conditions, context…"
              aria-label="Entry note"
              rows={3}
              className="w-full resize-none rounded-xl border border-[var(--line)] bg-[var(--bg-2)] px-3 py-2.5 text-[14px] leading-relaxed outline-none placeholder:text-[var(--faint)] focus:border-[var(--accent)]/60"
            />
          </div>
        </div>

        {/* footer */}
        <div className="border-t border-[var(--line)] p-3">
          <button
            onClick={submit}
            disabled={!canSave || saving}
            className="btn flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] py-3 text-[15px] font-semibold text-[#1a1207] disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" strokeWidth={2.5} />}
            Save entry
          </button>
        </div>
      </div>
    </div>
  );
}

function LocationBlock({
  geo,
  manual,
  manLat,
  manLng,
  manualInvalid,
  onRetry,
  onToggleManual,
  onLat,
  onLng,
}: {
  geo: GeoState;
  manual: boolean;
  manLat: string;
  manLng: string;
  manualInvalid: boolean;
  onRetry: () => void;
  onToggleManual: () => void;
  onLat: (v: string) => void;
  onLng: (v: string) => void;
}) {
  const errLabel: Record<GeoErr, string> = {
    denied: "Location permission denied",
    unavailable: "Location unavailable",
    timeout: "Location timed out",
    unsupported: "GPS not supported on this device",
  };

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-2)] p-3">
      <div className="flex items-center gap-2">
        <span className="text-[var(--accent)]">
          {geo.kind === "locating" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : geo.kind === "ok" && !manual ? (
            <LocateFixed className="h-4 w-4" />
          ) : (
            <LocateOff className="h-4 w-4 text-[var(--faint)]" />
          )}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">Location</span>

        {geo.kind === "ok" && !manual && (
          <span className="mono ml-auto flex items-center gap-1.5 text-[10.5px] text-[var(--muted)]">
            <span className="locate-dot h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            GPS LOCKED
          </span>
        )}
      </div>

      {/* GPS readout */}
      {geo.kind === "locating" && !manual && (
        <p className="mono mt-2 text-[12px] text-[var(--muted)]">Acquiring satellites…</p>
      )}

      {geo.kind === "ok" && !manual && (
        <div className="mono mt-2 text-[13px]">
          <div className="text-[var(--text)]">{formatCoord(geo.fix.lat, geo.fix.lng)}</div>
          <div className="mt-0.5 text-[10.5px] text-[var(--faint)]">accuracy {formatAccuracy(geo.fix.accuracy)}</div>
        </div>
      )}

      {geo.kind === "error" && !manual && (
        <div className="mt-2 flex items-start gap-2 text-[12.5px] text-[var(--muted)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
          <span>{errLabel[geo.err]}. Enter coordinates manually instead.</span>
        </div>
      )}

      {/* Manual entry */}
      {manual && (
        <div className="mt-2">
          {geo.kind === "error" && (
            <p className="mb-2 text-[11.5px] text-[var(--faint)]">
              {errLabel[geo.err]} — enter coordinates manually.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <input
              value={manLat}
              onChange={(e) => onLat(e.target.value)}
              inputMode="decimal"
              placeholder="lat (-90..90)"
              aria-label="Manual latitude"
              className="mono w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-2 text-[13px] outline-none placeholder:text-[var(--faint)] focus:border-[var(--accent)]/60"
            />
            <input
              value={manLng}
              onChange={(e) => onLng(e.target.value)}
              inputMode="decimal"
              placeholder="lng (-180..180)"
              aria-label="Manual longitude"
              className="mono w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-2 text-[13px] outline-none placeholder:text-[var(--faint)] focus:border-[var(--accent)]/60"
            />
          </div>
          {manualInvalid && (
            <p className="mt-1.5 text-[11px] text-[var(--danger)]">Enter valid coordinates, or leave blank for none.</p>
          )}
        </div>
      )}

      {/* Toggle controls */}
      <div className="mt-2.5 flex items-center gap-2">
        {geo.kind === "error" && !manual && (
          <button
            onClick={onRetry}
            className="btn flex items-center gap-1.5 rounded-lg bg-[var(--surface-2)] px-2.5 py-1.5 text-[12px] font-medium hover:bg-[var(--line)]"
          >
            <LocateFixed className="h-3.5 w-3.5 text-[var(--accent)]" /> Retry GPS
          </button>
        )}
        <button
          onClick={onToggleManual}
          className="btn ml-auto text-[12px] font-medium text-[var(--accent)] hover:underline"
        >
          {manual ? "Use GPS" : "Enter manually"}
        </button>
      </div>
    </div>
  );
}

/* ================================================================== *
 * Small bits
 * ================================================================== */

function Thumb({ photo, className }: { photo: string | null; className?: string }) {
  if (!photo) {
    return (
      <div
        className={`flex items-center justify-center border border-[var(--line)] bg-[var(--bg-2)] text-[var(--faint)] ${className ?? ""}`}
      >
        <ImageOff className="h-5 w-5" />
      </div>
    );
  }
  return <img src={photo} alt="" className={`border border-[var(--line)] object-cover ${className ?? ""}`} />;
}

function TabButton({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`tab btn flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10.5px] font-medium ${
        active ? "active" : "text-[var(--faint)]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
