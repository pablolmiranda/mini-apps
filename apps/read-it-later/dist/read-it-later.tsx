import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  BookOpen,
  Plus,
  Check,
  Circle,
  Archive,
  ArchiveRestore,
  Trash2,
  ExternalLink,
  Share2,
  Sun,
  Moon,
  WifiOff,
  Inbox,
  Link2,
  StickyNote,
  Search,
} from "lucide-react";

/* ------------------------------------------------------------------ *
 * Data model
 * ------------------------------------------------------------------ */

interface Item {
  id: string;
  url: string;
  title: string;
  note: string;
  addedAt: number;
  read: boolean;
  archived: boolean;
}

type Filter = "unread" | "read" | "archived" | "all";

/* ------------------------------------------------------------------ *
 * IndexedDB layer (hand-rolled, zero-dependency) — fully offline.
 * ------------------------------------------------------------------ */

const DB_NAME = "read-it-later";
const DB_VERSION = 1;
const STORE = "items";

function hasIDB(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: "id" });
        s.createIndex("addedAt", "addedAt");
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

async function getAllItems(): Promise<Item[]> {
  if (!hasIDB()) return [];
  const db = await openDB();
  try {
    const items = await reqToPromise(
      store(db, "readonly").getAll() as IDBRequest<Item[]>
    );
    return items.sort((a, b) => b.addedAt - a.addedAt);
  } finally {
    db.close();
  }
}

async function putItem(item: Item): Promise<void> {
  if (!hasIDB()) return;
  const db = await openDB();
  try {
    await reqToPromise(store(db, "readwrite").put(item));
  } finally {
    db.close();
  }
}

async function deleteItem(id: string): Promise<void> {
  if (!hasIDB()) return;
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

/** Accept only http/https URLs; tolerate a missing scheme by adding https. */
function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Pull the first http(s) URL out of an arbitrary text blob (shared "text"). */
function firstUrlInText(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s]+/i);
  return m ? m[0] : null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function relativeTime(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.round(d / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

interface SharedPayload {
  url: string;
  title: string;
  note: string;
}

/**
 * Parse a Web Share Target GET payload from a search string. The Store's
 * manifest maps share_target params to ?title=&text=&url= on load. We accept
 * a url directly, or fall back to extracting one from the shared text.
 */
function parseSharedPayload(search: string): SharedPayload | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search || "");
  } catch {
    return null;
  }
  const rawUrl = params.get("url") || "";
  const text = params.get("text") || "";
  const title = (params.get("title") || "").trim();

  const url = normalizeUrl(rawUrl) || (text ? normalizeUrl(firstUrlInText(text) || "") : null);
  if (!url) return null;

  // If the shared text wasn't itself the URL, keep it as the note.
  const textUrl = firstUrlInText(text);
  const note = text && (!textUrl || text.trim() !== textUrl) ? text.trim() : "";

  return { url, title, note };
}

function makeItem(p: { url: string; title?: string; note?: string }): Item {
  return {
    id: genId(),
    url: p.url,
    title: (p.title || "").trim() || hostOf(p.url),
    note: (p.note || "").trim(),
    addedAt: Date.now(),
    read: false,
    archived: false,
  };
}

const THEME_KEY = "read-it-later:theme";

function loadTheme(): "light" | "dark" {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* ignore */
  }
  try {
    if (
      typeof matchMedia === "function" &&
      matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      return "dark";
    }
  } catch {
    /* ignore */
  }
  return "light";
}

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

const FILTERS: { key: Filter; label: string }[] = [
  { key: "unread", label: "Unread" },
  { key: "read", label: "Read" },
  { key: "archived", label: "Archived" },
  { key: "all", label: "All" },
];

export default function ReadItLater() {
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>("unread");
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">(loadTheme);
  const [online, setOnline] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draftUrl, setDraftUrl] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState("");
  const initRef = useRef(false);
  const now = Date.now();

  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  /* ---- persist theme ---- */
  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  /* ---- online/offline indicator (feature-detected) ---- */
  useEffect(() => {
    if (typeof navigator !== "undefined" && "onLine" in navigator) {
      setOnline(navigator.onLine);
    }
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("online", up);
      window.addEventListener("offline", down);
      return () => {
        window.removeEventListener("online", up);
        window.removeEventListener("offline", down);
      };
    }
  }, []);

  /* ---- toast auto-dismiss ---- */
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const showToast = useCallback((msg: string) => setToast(msg), []);

  /* ---- initial load + ingest incoming Web Share Target payload ---- */
  useEffect(() => {
    if (initRef.current) return; // StrictMode double-invoke guard
    initRef.current = true;

    let cancelled = false;
    (async () => {
      const existing = await getAllItems().catch(() => [] as Item[]);

      // Web Share Target (GET): incoming share arrives as query params.
      let shared: SharedPayload | null = null;
      try {
        const search =
          typeof window !== "undefined" && window.location
            ? window.location.search
            : "";
        shared = parseSharedPayload(search);
      } catch {
        shared = null;
      }

      let next = existing;
      if (shared) {
        // Avoid duplicating the exact same URL if it's already unarchived.
        const dupe = existing.find(
          (it) => it.url === shared!.url && !it.archived
        );
        if (!dupe) {
          const item = makeItem(shared);
          next = [item, ...existing];
          await putItem(item).catch(() => {});
        }
        // Clean the URL so a reload doesn't re-add the share.
        try {
          if (
            typeof window !== "undefined" &&
            window.history &&
            typeof window.history.replaceState === "function"
          ) {
            const base =
              window.location.pathname + (window.location.hash || "");
            window.history.replaceState({}, "", base || "/");
          }
        } catch {
          /* ignore */
        }
      }

      if (!cancelled) {
        setItems(next);
        setLoaded(true);
        if (shared) {
          setFilter("unread");
          showToast("Saved from share");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showToast]);

  /* ---- mutations ---- */
  const upsert = useCallback((item: Item) => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === item.id);
      const next = idx === -1 ? [item, ...prev] : prev.map((i) => (i.id === item.id ? item : i));
      return next;
    });
    putItem(item).catch(() => {});
  }, []);

  const addManual = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const url = normalizeUrl(draftUrl);
      if (!url) {
        setFormError("Enter a valid http(s) link.");
        return;
      }
      const item = makeItem({ url, title: draftTitle, note: draftNote });
      upsert(item);
      setDraftUrl("");
      setDraftTitle("");
      setDraftNote("");
      setFormError("");
      setAdding(false);
      setFilter("unread");
      showToast("Link added");
    },
    [draftUrl, draftTitle, draftNote, upsert, showToast]
  );

  const toggleRead = useCallback(
    (it: Item) => upsert({ ...it, read: !it.read }),
    [upsert]
  );

  const toggleArchive = useCallback(
    (it: Item) => upsert({ ...it, archived: !it.archived }),
    [upsert]
  );

  const remove = useCallback(
    (it: Item) => {
      setItems((prev) => prev.filter((i) => i.id !== it.id));
      deleteItem(it.id).catch(() => {});
      showToast("Deleted");
    },
    [showToast]
  );

  const openLink = useCallback((it: Item) => {
    try {
      if (typeof window !== "undefined" && typeof window.open === "function") {
        window.open(it.url, "_blank", "noopener,noreferrer");
      }
    } catch {
      /* ignore */
    }
  }, []);

  const shareOut = useCallback(
    async (it: Item) => {
      if (!canShare) return;
      try {
        await navigator.share({ title: it.title, text: it.note, url: it.url });
      } catch {
        /* user cancelled or unsupported */
      }
    },
    [canShare]
  );

  /* ---- derived list ---- */
  const counts = useMemo(() => {
    let unread = 0,
      read = 0,
      archived = 0;
    for (const it of items) {
      if (it.archived) archived++;
      else if (it.read) read++;
      else unread++;
    }
    return { unread, read, archived, all: items.length };
  }, [items]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      const matchFilter =
        filter === "all"
          ? true
          : filter === "archived"
            ? it.archived
            : filter === "read"
              ? it.read && !it.archived
              : !it.read && !it.archived; // unread
      if (!matchFilter) return false;
      if (!q) return true;
      return (
        it.title.toLowerCase().includes(q) ||
        it.url.toLowerCase().includes(q) ||
        it.note.toLowerCase().includes(q)
      );
    });
  }, [items, filter, query]);

  const onDraftUrl = (e: ChangeEvent<HTMLInputElement>) => {
    setDraftUrl(e.target.value);
    if (formError) setFormError("");
  };

  return (
    <div
      className="app h-[100dvh] w-full overflow-hidden flex flex-col"
      data-theme={theme}
    >
      <style>{`
        .app {
          --bg: #f3eee3;
          --bg-soft: #ece4d4;
          --surface: #fbf7ee;
          --surface-2: #f6efe1;
          --border: #e0d6c2;
          --text: #2c2a26;
          --muted: #7c7361;
          --faint: #a99e88;
          --accent: #0f766e;
          --accent-soft: #0f766e22;
          --accent-text: #0b5d57;
          --danger: #b4452f;
          font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          background: var(--bg);
          color: var(--text);
          -webkit-font-smoothing: antialiased;
        }
        .app[data-theme="dark"] {
          --bg: #15171c;
          --bg-soft: #1b1e25;
          --surface: #1f232b;
          --surface-2: #252a33;
          --border: #2f3540;
          --text: #e7e4dc;
          --muted: #9aa0ab;
          --faint: #6b7280;
          --accent: #2dd4bf;
          --accent-soft: #2dd4bf1f;
          --accent-text: #5eead4;
          --danger: #f0917c;
        }
        .surf { background: var(--surface); border-color: var(--border); }
        .surf2 { background: var(--surface-2); }
        .muted { color: var(--muted); }
        .faint { color: var(--faint); }
        .accent-text { color: var(--accent-text); }
        .ring-accent:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .card {
          background: var(--surface);
          border: 1px solid var(--border);
          transition: border-color .15s ease, transform .12s ease, box-shadow .15s ease;
        }
        .card:hover { border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); }
        .pill {
          background: transparent; color: var(--muted);
          border: 1px solid transparent;
        }
        .pill[data-on="true"] {
          background: var(--accent-soft); color: var(--accent-text);
          border-color: color-mix(in srgb, var(--accent) 35%, transparent);
        }
        .field {
          background: var(--surface-2); border: 1px solid var(--border); color: var(--text);
        }
        .field::placeholder { color: var(--faint); }
        .field:focus { outline: 2px solid var(--accent); outline-offset: 1px; border-color: transparent; }
        .btn-accent { background: var(--accent); color: #fff; }
        .btn-accent:hover { filter: brightness(1.06); }
        .iconbtn { color: var(--muted); }
        .iconbtn:hover { color: var(--text); background: var(--surface-2); }
        .danger { color: var(--danger); }
        .grain {
          background-image: radial-gradient(color-mix(in srgb, var(--text) 5%, transparent) 0.5px, transparent 0.5px);
          background-size: 4px 4px;
        }
      `}</style>

      {/* Header */}
      <header className="surf border-b shrink-0">
        <div
          className="mx-auto w-full max-w-2xl px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 flex items-center gap-3"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="grid place-items-center h-9 w-9 rounded-xl shrink-0"
              style={{ background: "var(--accent-soft)" }}
            >
              <BookOpen className="h-5 w-5 accent-text" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="text-[15px] font-semibold leading-tight truncate">
                Read-It-Later
              </h1>
              <p className="text-[11px] muted leading-tight">
                {online ? "Saved offline on this device" : "Offline — fully usable"}
              </p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            {!online && (
              <span
                className="hidden sm:inline-flex items-center gap-1 text-[11px] muted mr-1"
                aria-label="Offline"
              >
                <WifiOff className="h-3.5 w-3.5" aria-hidden="true" /> offline
              </span>
            )}
            <button
              type="button"
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              className="iconbtn ring-accent grid place-items-center h-9 w-9 rounded-lg"
              aria-label={theme === "dark" ? "Switch to light reading mode" : "Switch to dark reading mode"}
            >
              {theme === "dark" ? (
                <Sun className="h-[18px] w-[18px]" aria-hidden="true" />
              ) : (
                <Moon className="h-[18px] w-[18px]" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding((v) => !v);
                setFormError("");
              }}
              className="btn-accent ring-accent inline-flex items-center gap-1.5 h-9 pl-2.5 pr-3 rounded-lg text-sm font-medium"
              aria-label="Add link"
              aria-expanded={adding}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="hidden xs:inline sm:inline">Add</span>
            </button>
          </div>
        </div>

        {/* Add form */}
        {adding && (
          <div className="border-t" style={{ borderColor: "var(--border)" }}>
            <form
              onSubmit={addManual}
              className="mx-auto w-full max-w-2xl px-4 py-3 space-y-2"
              aria-label="Add link form"
            >
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 faint shrink-0" aria-hidden="true" />
                <input
                  className="field ring-accent flex-1 h-10 rounded-lg px-3 text-sm min-w-0"
                  placeholder="https://example.com/article"
                  value={draftUrl}
                  onChange={onDraftUrl}
                  inputMode="url"
                  autoComplete="off"
                  aria-label="Link URL"
                  autoFocus
                />
              </div>
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 faint shrink-0" aria-hidden="true" />
                <input
                  className="field flex-1 h-10 rounded-lg px-3 text-sm min-w-0"
                  placeholder="Title (optional)"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  aria-label="Title"
                />
              </div>
              <div className="flex items-start gap-2">
                <StickyNote className="h-4 w-4 faint shrink-0 mt-2.5" aria-hidden="true" />
                <textarea
                  className="field flex-1 rounded-lg px-3 py-2 text-sm min-w-0 resize-none"
                  placeholder="Note or snippet to keep offline (optional)"
                  rows={2}
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                  aria-label="Note"
                />
              </div>
              {formError && (
                <p className="text-xs danger" role="alert">
                  {formError}
                </p>
              )}
              <div className="flex items-center justify-end gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    setFormError("");
                  }}
                  className="iconbtn ring-accent h-9 px-3 rounded-lg text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-accent ring-accent h-9 px-4 rounded-lg text-sm font-medium"
                >
                  Save link
                </button>
              </div>
            </form>
          </div>
        )}
      </header>

      {/* Filters + search */}
      <div className="surf2 shrink-0 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="mx-auto w-full max-w-2xl px-4 py-2.5 flex flex-col gap-2.5">
          <div
            className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1"
            role="tablist"
            aria-label="Filter reading list"
          >
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                data-on={filter === f.key}
                onClick={() => setFilter(f.key)}
                className="pill ring-accent shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-medium"
              >
                {f.label}
                <span className="faint text-[11px] tabular-nums" data-on={filter === f.key}>
                  {counts[f.key]}
                </span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 faint shrink-0" aria-hidden="true" />
            <input
              className="field ring-accent flex-1 h-9 rounded-lg px-3 text-sm min-w-0"
              placeholder="Search title, link or note"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search reading list"
              type="search"
            />
          </div>
        </div>
      </div>

      {/* List */}
      <main className="flex-1 overflow-y-auto grain">
        <div className="mx-auto w-full max-w-2xl px-4 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {!loaded ? (
            <p className="muted text-sm py-10 text-center">Loading your list…</p>
          ) : visible.length === 0 ? (
            <EmptyState filter={filter} hasAny={items.length > 0} />
          ) : (
            <ul className="space-y-3" aria-label="Saved links">
              {visible.map((it) => (
                <li key={it.id}>
                  <ItemCard
                    item={it}
                    now={now}
                    canShare={canShare}
                    onOpen={() => openLink(it)}
                    onToggleRead={() => toggleRead(it)}
                    onToggleArchive={() => toggleArchive(it)}
                    onShare={() => shareOut(it)}
                    onDelete={() => remove(it)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      {/* Toast */}
      {toast && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] flex justify-center px-4 z-20"
          role="status"
          aria-live="polite"
        >
          <span
            className="surf border rounded-full px-4 py-2 text-sm shadow-lg flex items-center gap-2"
            style={{ boxShadow: "0 8px 30px rgba(0,0,0,.18)" }}
          >
            <Check className="h-4 w-4 accent-text" aria-hidden="true" />
            {toast}
          </span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Subcomponents
 * ------------------------------------------------------------------ */

function EmptyState({ filter, hasAny }: { filter: Filter; hasAny: boolean }) {
  const copy: Record<Filter, { title: string; sub: string }> = {
    unread: {
      title: hasAny ? "All caught up" : "Nothing saved yet",
      sub: hasAny
        ? "No unread links right now."
        : "Share a page to this app, or tap Add to save your first link.",
    },
    read: { title: "No read items", sub: "Links you mark as read show up here." },
    archived: { title: "Archive is empty", sub: "Archived links are tucked away here." },
    all: { title: "Nothing here yet", sub: "Your saved links will appear here." },
  };
  const c = copy[filter];
  return (
    <div className="text-center py-16 px-6">
      <span
        className="mx-auto grid place-items-center h-14 w-14 rounded-2xl mb-4"
        style={{ background: "var(--accent-soft)" }}
      >
        <Inbox className="h-7 w-7 accent-text" aria-hidden="true" />
      </span>
      <p className="font-semibold">{c.title}</p>
      <p className="muted text-sm mt-1 max-w-xs mx-auto">{c.sub}</p>
    </div>
  );
}

interface CardProps {
  item: Item;
  now: number;
  canShare: boolean;
  onOpen: () => void;
  onToggleRead: () => void;
  onToggleArchive: () => void;
  onShare: () => void;
  onDelete: () => void;
}

function ItemCard({
  item,
  now,
  canShare,
  onOpen,
  onToggleRead,
  onToggleArchive,
  onShare,
  onDelete,
}: CardProps) {
  const host = hostOf(item.url);
  return (
    <article
      className="card rounded-2xl p-3.5 sm:p-4"
      style={item.read ? { opacity: 0.78 } : undefined}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onToggleRead}
          className="ring-accent shrink-0 grid place-items-center h-6 w-6 rounded-full mt-0.5 border"
          style={{
            borderColor: item.read ? "var(--accent)" : "var(--border)",
            background: item.read ? "var(--accent)" : "transparent",
          }}
          aria-label={item.read ? "Mark as unread" : "Mark as read"}
          aria-pressed={item.read}
        >
          {item.read ? (
            <Check className="h-3.5 w-3.5 text-white" aria-hidden="true" />
          ) : (
            <Circle className="h-3 w-3 faint" aria-hidden="true" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onOpen}
            className="ring-accent text-left block w-full group"
            aria-label={`Open ${item.title}`}
          >
            <h2
              className="text-[15px] font-semibold leading-snug break-words"
              style={item.read ? { textDecoration: "line-through" } : undefined}
            >
              {item.title}
            </h2>
            <span className="mt-0.5 inline-flex items-center gap-1 text-[12px] accent-text break-all">
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
              {host}
            </span>
          </button>

          {item.note && (
            <p className="muted text-[13px] mt-2 leading-relaxed whitespace-pre-wrap break-words">
              {item.note}
            </p>
          )}

          <div className="mt-2.5 flex items-center gap-1 flex-wrap">
            <span className="faint text-[11px] mr-auto">
              {relativeTime(item.addedAt, now)}
              {item.archived && " · archived"}
            </span>

            {canShare && (
              <button
                type="button"
                onClick={onShare}
                className="iconbtn ring-accent grid place-items-center h-8 w-8 rounded-lg"
                aria-label="Share out"
              >
                <Share2 className="h-[17px] w-[17px]" aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={onToggleArchive}
              className="iconbtn ring-accent grid place-items-center h-8 w-8 rounded-lg"
              aria-label={item.archived ? "Restore from archive" : "Archive"}
            >
              {item.archived ? (
                <ArchiveRestore className="h-[17px] w-[17px]" aria-hidden="true" />
              ) : (
                <Archive className="h-[17px] w-[17px]" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="iconbtn ring-accent danger grid place-items-center h-8 w-8 rounded-lg"
              aria-label={`Delete ${item.title}`}
            >
              <Trash2 className="h-[17px] w-[17px]" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
