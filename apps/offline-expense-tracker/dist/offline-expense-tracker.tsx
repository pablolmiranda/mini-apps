import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Wallet,
  Plus,
  Cloud,
  CloudOff,
  Wifi,
  WifiOff,
  RefreshCw,
  Check,
  Clock,
  Trash2,
  Utensils,
  Car,
  ShoppingBag,
  Home,
  Coffee,
  Gamepad2,
  HeartPulse,
  Receipt,
  CircleDollarSign,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/* ------------------------------------------------------------------ *
 * Data model
 * ------------------------------------------------------------------ */

interface Expense {
  id: string;
  amount: number; // in major currency units (e.g. dollars)
  category: string;
  note: string;
  ts: number;
  synced: boolean;
}

/* ------------------------------------------------------------------ *
 * IndexedDB layer (hand-rolled, zero-dependency) — fully offline.
 * ------------------------------------------------------------------ */

const DB_NAME = "offline-expense-tracker";
const DB_VERSION = 1;
const STORE = "expenses";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: "id" });
        s.createIndex("ts", "ts");
        s.createIndex("synced", "synced");
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

async function getAllExpenses(): Promise<Expense[]> {
  const db = await openDB();
  try {
    const all = await reqToPromise(
      tx(db, "readonly").getAll() as IDBRequest<Expense[]>
    );
    return all.sort((a, b) => b.ts - a.ts);
  } finally {
    db.close();
  }
}

async function putExpense(e: Expense): Promise<void> {
  const db = await openDB();
  try {
    await reqToPromise(tx(db, "readwrite").put(e));
  } finally {
    db.close();
  }
}

async function deleteExpense(id: string): Promise<void> {
  const db = await openDB();
  try {
    await reqToPromise(tx(db, "readwrite").delete(id));
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

const CATEGORIES: { key: string; label: string; icon: LucideIcon }[] = [
  { key: "food", label: "Food", icon: Utensils },
  { key: "coffee", label: "Coffee", icon: Coffee },
  { key: "transport", label: "Transport", icon: Car },
  { key: "shopping", label: "Shopping", icon: ShoppingBag },
  { key: "home", label: "Home", icon: Home },
  { key: "fun", label: "Fun", icon: Gamepad2 },
  { key: "health", label: "Health", icon: HeartPulse },
  { key: "other", label: "Other", icon: CircleDollarSign },
];

function categoryMeta(key: string) {
  return CATEGORIES.find((c) => c.key === key) ?? CATEGORIES[CATEGORIES.length - 1];
}

function fmtMoney(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function relTime(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ------------------------------------------------------------------ *
 * Network / sync feature detection
 * ------------------------------------------------------------------ */

function readOnline(): boolean {
  try {
    if (typeof navigator !== "undefined" && "onLine" in navigator) {
      return navigator.onLine;
    }
  } catch {
    /* ignore */
  }
  return true; // assume online if we can't tell
}

// Register a background sync if the platform supports SyncManager. This is the
// HERO path: the Store's service worker would own a 'sync' event named
// 'flush-expenses' that POSTs queued rows to a server. There may be no SW in
// this preview/test — all of it is feature-detected and wrapped in try/catch.
function registerBackgroundSync(): void {
  try {
    if (
      typeof navigator === "undefined" ||
      !("serviceWorker" in navigator) ||
      typeof window === "undefined" ||
      !("SyncManager" in window)
    ) {
      return;
    }
    const sw = navigator.serviceWorker;
    if (!sw || !sw.ready || typeof sw.ready.then !== "function") return;
    sw.ready
      .then((reg) => {
        const anyReg = reg as unknown as {
          sync?: { register: (tag: string) => Promise<void> };
        };
        if (anyReg.sync && typeof anyReg.sync.register === "function") {
          return anyReg.sync.register("flush-expenses");
        }
        return undefined;
      })
      .catch(() => {
        /* no SW controlling this page — foreground fallback handles it */
      });
  } catch {
    /* SyncManager unavailable — foreground fallback handles it */
  }
}

// Foreground flush fallback. There is no real backend here, so we SIMULATE the
// network round-trip: pending rows are marked synced after a brief delay. A
// real deployment would POST each row and only mark it synced on a 2xx.
const FLUSH_PLACEHOLDER_URL = "https://example.invalid/expenses";

async function simulateUpload(_e: Expense): Promise<boolean> {
  // Try a real POST when fetch exists; treat any resolved fetch OR our
  // simulated delay as success. Network errors (offline) -> keep pending.
  try {
    if (typeof fetch === "function" && readOnline()) {
      // Fire-and-forget style probe; we don't depend on a live server.
      await Promise.race([
        fetch(FLUSH_PLACEHOLDER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(_e),
        }).catch(() => undefined),
        new Promise((r) => setTimeout(r, 250)),
      ]);
    } else {
      await new Promise((r) => setTimeout(r, 250));
    }
    // Simulated success path.
    return readOnline();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Scoped styles — fintech "ledger" theme, emerald accent, tabular nums.
 * ------------------------------------------------------------------ */

const STYLES = `
.app {
  --font-ui: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;

  --bg: #0b0f14;
  --bg-2: #0e141b;
  --surface: #131b24;
  --surface-2: #1a2530;
  --line: #223040;
  --ink: #eaf2f8;
  --muted: #8da3b5;
  --faint: #5c7488;
  --accent: #10b981;
  --accent-ink: #052e22;
  --accent-soft: rgba(16, 185, 129, 0.14);
  --warn: #f5a524;
  --warn-soft: rgba(245, 165, 36, 0.14);
  --danger: #f04438;
  --shadow: rgba(0, 0, 0, 0.45);

  font-family: var(--font-ui);
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
}

.num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }
.mono { font-family: var(--font-mono); }

.scroll::-webkit-scrollbar { width: 9px; height: 9px; }
.scroll::-webkit-scrollbar-thumb {
  background: var(--line); border-radius: 9999px;
  border: 2px solid transparent; background-clip: padding-box;
}
.scroll:hover::-webkit-scrollbar-thumb { background: var(--faint); }
.scroll { scrollbar-width: thin; scrollbar-color: var(--line) transparent; }

.cat-btn { transition: background .14s ease, color .14s ease, border-color .14s ease, transform .08s ease; }
.cat-btn:active { transform: scale(.96); }
.cat-btn[data-on="true"] {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

.key { transition: background .12s ease, transform .06s ease; }
.key:active { transform: scale(.95); background: var(--surface-2); }

.row { transition: background .14s ease; }
.row:hover { background: var(--surface-2); }

.badge-pulse { position: relative; }
.badge-pulse::after {
  content: ""; position: absolute; inset: 0; border-radius: 9999px;
  box-shadow: 0 0 0 0 var(--warn-soft); animation: pulse 1.8s ease-out infinite;
}
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(245,165,36,0.35); }
  70% { box-shadow: 0 0 0 7px rgba(245,165,36,0); }
  100% { box-shadow: 0 0 0 0 rgba(245,165,36,0); }
}

@keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.rise { animation: rise .4s cubic-bezier(.2,.7,.2,1) both; }

.tot { letter-spacing: -0.02em; }
`;

/* ------------------------------------------------------------------ *
 * App
 * ------------------------------------------------------------------ */

type Flushing = "idle" | "flushing";

export default function App() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState<boolean>(() => readOnline());
  const [flushing, setFlushing] = useState<Flushing>("idle");
  const [now, setNow] = useState(() => Date.now());

  // form state
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string>(CATEGORIES[0].key);
  const [note, setNote] = useState("");

  const didInit = useRef(false);
  const flushingRef = useRef(false);

  /* Keep relative timestamps fresh. */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  /* Initial offline load. */
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    (async () => {
      try {
        const loaded = await getAllExpenses();
        setExpenses(loaded);
      } catch {
        setExpenses([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* Pending rows = not yet synced. */
  const pending = useMemo(() => expenses.filter((e) => !e.synced), [expenses]);
  const syncedCount = expenses.length - pending.length;

  /* Foreground flush fallback: mark pending -> synced when online. */
  const flushPending = useCallback(async () => {
    if (flushingRef.current) return;
    if (!readOnline()) return;

    // Read the freshest pending set straight from the store so we don't race
    // with stale React state after rapid adds.
    let toFlush: Expense[];
    try {
      const all = await getAllExpenses();
      toFlush = all.filter((e) => !e.synced);
    } catch {
      return;
    }
    if (toFlush.length === 0) return;

    flushingRef.current = true;
    setFlushing("flushing");
    try {
      for (const e of toFlush) {
        if (!readOnline()) break; // went offline mid-flush -> keep remainder pending
        const ok = await simulateUpload(e);
        if (ok) {
          const updated = { ...e, synced: true };
          await putExpense(updated);
          setExpenses((prev) =>
            prev.map((p) => (p.id === e.id ? { ...p, synced: true } : p))
          );
        }
      }
    } finally {
      flushingRef.current = false;
      setFlushing("idle");
    }
  }, []);

  /* Online/offline tracking + auto-flush on reconnect. */
  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      registerBackgroundSync();
      void flushPending();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [flushPending]);

  /* Try an initial flush once data is loaded and we're online. */
  useEffect(() => {
    if (!loading && online) void flushPending();
  }, [loading, online, flushPending]);

  const addExpense = useCallback(
    async (raw: string, cat: string, noteText: string) => {
      const value = Math.round(parseFloat(raw) * 100) / 100;
      if (!isFinite(value) || value <= 0) return false;
      const e: Expense = {
        id: genId(),
        amount: value,
        category: cat,
        note: noteText.trim(),
        ts: Date.now(),
        synced: false,
      };
      // Queue locally first — works fully offline.
      await putExpense(e);
      setExpenses((prev) => [e, ...prev]);

      // HERO: ask the platform to flush in the background when possible.
      registerBackgroundSync();
      // Foreground fallback if we happen to be online right now.
      if (readOnline()) void flushPending();
      return true;
    },
    [flushPending]
  );

  const onSubmit = useCallback(
    (ev: FormEvent) => {
      ev.preventDefault();
      void (async () => {
        const ok = await addExpense(amount, category, note);
        if (ok) {
          setAmount("");
          setNote("");
        }
      })();
    },
    [amount, category, note, addExpense]
  );

  const handleDelete = useCallback(async (id: string) => {
    await deleteExpense(id);
    setExpenses((prev) => prev.filter((e) => e.id !== id));
  }, []);

  /* Totals. */
  const total = useMemo(
    () => expenses.reduce((sum, e) => sum + e.amount, 0),
    [expenses]
  );
  const pendingTotal = useMemo(
    () => pending.reduce((sum, e) => sum + e.amount, 0),
    [pending]
  );
  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of expenses) map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
    return [...map.entries()]
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value);
  }, [expenses]);

  const amountNum = parseFloat(amount);
  const canSubmit = isFinite(amountNum) && amountNum > 0;

  return (
    <div className="app relative flex h-[100dvh] w-full flex-col overflow-hidden bg-[var(--bg)]">
      <style>{STYLES}</style>

      {/* ---------------- Header / status ---------------- */}
      <header
        className="z-10 shrink-0 border-b border-[var(--line)] bg-[var(--bg-2)] px-5 pb-4"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)" }}
      >
        <div className="mx-auto flex w-full max-w-[760px] items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <Wallet className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tracking-tight">Ledger</div>
            <div className="text-[11.5px] text-[var(--muted)]">Offline expense tracker</div>
          </div>
          <div className="ml-auto">
            <StatusPill online={online} flushing={flushing} />
          </div>
        </div>
      </header>

      {/* ---------------- Scroll body ---------------- */}
      <div className="scroll relative z-10 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-5 pb-32 pt-5">
          {/* Running total */}
          <section className="rise rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_10px_30px_-18px_var(--shadow)]">
            <div className="flex items-center gap-2 text-[12px] uppercase tracking-wide text-[var(--muted)]">
              <Receipt className="h-3.5 w-3.5" /> Total spent
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="num tot text-[18px] font-medium text-[var(--muted)]">$</span>
              <span
                className="num tot text-[40px] font-semibold leading-none text-[var(--ink)]"
                aria-label="Total spent"
              >
                {fmtMoney(total)}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[var(--accent)]">
                <Cloud className="h-3.5 w-3.5" />
                <span className="num">{syncedCount}</span> synced
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
                  pending.length
                    ? "bg-[var(--warn-soft)] text-[var(--warn)]"
                    : "bg-[var(--surface-2)] text-[var(--muted)]"
                }`}
              >
                <Clock className="h-3.5 w-3.5" />
                <span className="num">{pending.length}</span> pending
                {pending.length > 0 && (
                  <span className="num">· ${fmtMoney(pendingTotal)}</span>
                )}
              </span>
              {pending.length > 0 && (
                <button
                  onClick={() => void flushPending()}
                  disabled={!online || flushing === "flushing"}
                  className="key ml-auto inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1 text-[var(--ink)] disabled:opacity-40"
                  aria-label="Sync now"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${flushing === "flushing" ? "animate-spin" : ""}`}
                  />
                  Sync now
                </button>
              )}
            </div>
            {!online && (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--warn-soft)] bg-[var(--warn-soft)] px-3 py-2 text-[12.5px] text-[var(--warn)]">
                <WifiOff className="h-4 w-4 shrink-0" />
                You're offline — expenses are saved on this device and will sync
                automatically when you're back online.
              </div>
            )}
          </section>

          {/* By category */}
          {byCategory.length > 0 && (
            <section className="mt-4">
              <h2 className="mb-2 px-1 text-[12px] uppercase tracking-wide text-[var(--muted)]">
                By category
              </h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {byCategory.map(({ key, value }) => {
                  const meta = categoryMeta(key);
                  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
                  const Icon = meta.icon;
                  return (
                    <div
                      key={key}
                      className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3"
                    >
                      <div className="flex items-center gap-2 text-[12.5px] text-[var(--muted)]">
                        <Icon className="h-4 w-4 text-[var(--accent)]" />
                        <span className="truncate">{meta.label}</span>
                        <span className="num ml-auto text-[var(--faint)]">{pct}%</span>
                      </div>
                      <div className="num mt-1.5 text-[16px] font-semibold text-[var(--ink)]">
                        ${fmtMoney(value)}
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
                        <div
                          className="h-full rounded-full bg-[var(--accent)]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Receipt list */}
          <section className="mt-5">
            <h2 className="mb-2 px-1 text-[12px] uppercase tracking-wide text-[var(--muted)]">
              Recent
            </h2>
            {loading ? (
              <div className="flex items-center justify-center py-12 text-[var(--faint)]">
                <RefreshCw className="h-5 w-5 animate-spin" />
              </div>
            ) : expenses.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface)] px-4 py-12 text-center">
                <Receipt className="mx-auto h-7 w-7 text-[var(--faint)]" />
                <p className="mt-3 text-[14px] text-[var(--muted)]">No expenses yet</p>
                <p className="mt-1 text-[12.5px] text-[var(--faint)]">
                  Add one below — it works fully offline.
                </p>
              </div>
            ) : (
              <ul className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
                {expenses.map((e) => {
                  const meta = categoryMeta(e.category);
                  const Icon = meta.icon;
                  return (
                    <li
                      key={e.id}
                      className="row group flex items-center gap-3 border-b border-[var(--line)] px-4 py-3 last:border-b-0"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-2)] text-[var(--accent)]">
                        <Icon className="h-[18px] w-[18px]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[14px] font-medium text-[var(--ink)]">
                            {e.note || meta.label}
                          </span>
                          <SyncBadge synced={e.synced} />
                        </div>
                        <div className="mt-0.5 text-[12px] text-[var(--faint)]">
                          {meta.label} · {relTime(e.ts, now)}
                        </div>
                      </div>
                      <span className="num shrink-0 text-[15px] font-semibold text-[var(--ink)]">
                        ${fmtMoney(e.amount)}
                      </span>
                      <button
                        onClick={() => void handleDelete(e.id)}
                        aria-label={`Delete ${e.note || meta.label}`}
                        title="Delete"
                        className="key -mr-1 rounded-md p-1.5 text-[var(--faint)] opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* ---------------- Add form (docked) ---------------- */}
      <form
        onSubmit={onSubmit}
        className="z-20 shrink-0 border-t border-[var(--line)] bg-[var(--bg-2)] px-5 pt-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
      >
        <div className="mx-auto w-full max-w-[760px]">
          {/* Amount */}
          <div className="flex items-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5">
            <span className="num text-[22px] font-semibold text-[var(--muted)]">$</span>
            <input
              value={amount}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9.]/g, "");
                if ((v.match(/\./g) || []).length > 1) return;
                const [, dec] = v.split(".");
                if (dec && dec.length > 2) return;
                setAmount(v);
              }}
              inputMode="decimal"
              pattern="[0-9]*"
              placeholder="0.00"
              aria-label="Amount"
              className="num w-full bg-transparent text-[26px] font-semibold text-[var(--ink)] outline-none placeholder:text-[var(--faint)]"
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional)"
              aria-label="Note"
              className="hidden w-40 bg-transparent text-[13px] text-[var(--muted)] outline-none placeholder:text-[var(--faint)] sm:block"
            />
          </div>

          {/* Note on mobile */}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            aria-label="Note mobile"
            className="mt-2 block w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--ink)] outline-none placeholder:text-[var(--faint)] sm:hidden"
          />

          {/* Category picker */}
          <div className="scroll mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
            {CATEGORIES.map((c) => {
              const Icon = c.icon;
              const on = c.key === category;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCategory(c.key)}
                  data-on={on}
                  aria-label={c.label}
                  aria-pressed={on}
                  className="cat-btn flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-[12.5px] text-[var(--muted)]"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {c.label}
                </button>
              );
            })}
          </div>

          {/* Add button */}
          <button
            type="submit"
            disabled={!canSubmit}
            className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-3 text-[15px] font-semibold text-[var(--accent-ink)] transition-opacity disabled:opacity-40"
          >
            <Plus className="h-5 w-5" />
            Add expense
          </button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Small presentational pieces
 * ------------------------------------------------------------------ */

function StatusPill({ online, flushing }: { online: boolean; flushing: Flushing }) {
  if (online) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent-soft)] bg-[var(--accent-soft)] px-2.5 py-1 text-[12px] font-medium text-[var(--accent)]">
        {flushing === "flushing" ? (
          <Cloud className="h-3.5 w-3.5 animate-pulse" />
        ) : (
          <Wifi className="h-3.5 w-3.5" />
        )}
        {flushing === "flushing" ? "Syncing…" : "Online"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--warn-soft)] bg-[var(--warn-soft)] px-2.5 py-1 text-[12px] font-medium text-[var(--warn)]">
      <CloudOff className="h-3.5 w-3.5" />
      Offline
    </span>
  );
}

function SyncBadge({ synced }: { synced: boolean }) {
  if (synced) {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--accent)]"
        aria-label="Synced"
      >
        <Check className="h-3 w-3" />
        Synced
      </span>
    );
  }
  return (
    <span
      className="badge-pulse inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--warn-soft)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--warn)]"
      aria-label="Pending sync"
    >
      <Clock className="h-3 w-3" />
      Pending
    </span>
  );
}
