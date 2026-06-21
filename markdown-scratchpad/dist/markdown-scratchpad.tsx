import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  Feather,
  Plus,
  Search,
  ChevronLeft,
  Trash2,
  Sun,
  Moon,
  PenLine,
  BookOpen,
  Bold,
  Italic,
  Heading1,
  Heading2,
  List,
  Quote,
  Code,
  Link2,
  Check,
  Loader2,
  WifiOff,
} from "lucide-react";

/* ------------------------------------------------------------------ *
 * Data model
 * ------------------------------------------------------------------ */

interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

/* ------------------------------------------------------------------ *
 * IndexedDB layer (hand-rolled, zero-dependency) — fully offline.
 * ------------------------------------------------------------------ */

const DB_NAME = "markdown-scratchpad";
const DB_VERSION = 1;
const STORE = "notes";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
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

async function getAllNotes(): Promise<Note[]> {
  const db = await openDB();
  try {
    const notes = await reqToPromise(store(db, "readonly").getAll() as IDBRequest<Note[]>);
    return notes.sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    db.close();
  }
}

async function putNote(note: Note): Promise<void> {
  const db = await openDB();
  try {
    await reqToPromise(store(db, "readwrite").put(note));
  } finally {
    db.close();
  }
}

async function deleteNote(id: string): Promise<void> {
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

function deriveTitle(body: string): string {
  const firstLine = body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return "Untitled";
  return firstLine.replace(/^#{1,6}\s*/, "").slice(0, 80) || "Untitled";
}

function snippet(body: string): string {
  const text = body
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/[*_`>#-]/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(1)
    .join(" ");
  return text.trim();
}

function countWords(body: string): number {
  const m = body.trim().match(/\S+/g);
  return m ? m.length : 0;
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
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function newNote(body = ""): Note {
  const now = Date.now();
  return { id: genId(), title: deriveTitle(body), body, createdAt: now, updatedAt: now };
}

const WELCOME = `# Welcome to your Scratchpad

A calm place to write that works **100% offline**. Everything you type is
saved to this device via IndexedDB — no account, no network, no fuss.

## A few things to try

- Edits **autosave** as you type
- Press the *Read* toggle to render Markdown
- Use the toolbar — or ⌘B, ⌘I, ⌘K

> Reload the page and your notes are still here.

\`\`\`
The best ideas arrive when nothing is in the way.
\`\`\`
`;

/* ------------------------------------------------------------------ *
 * Minimal, safe Markdown -> HTML renderer.
 * Input is HTML-escaped FIRST, so user content can never inject markup.
 * ------------------------------------------------------------------ */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(url: string): string | null {
  if (/^(https?:\/\/|mailto:|\/|#)/i.test(url)) return url;
  return null;
}

function renderInline(text: string): string {
  let out = text; // already HTML-escaped
  out = out.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const safe = safeUrl(url);
    if (!safe) return m;
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  return out;
}

function renderMarkdown(md: string): string {
  const lines = escapeHtml(md).split("\n");
  const html: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  let listBuf: string[] = [];

  const flushList = () => {
    if (listBuf.length) {
      html.push(`<ul>${listBuf.join("")}</ul>`);
      listBuf = [];
    }
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        html.push(`<pre><code>${codeBuf.join("\n")}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      listBuf.push(`<li>${renderInline(li[1])}</li>`);
      continue;
    }

    // `>` was turned into `&gt;` by escapeHtml above, so match the entity.
    const quote = line.match(/^&gt;\s?(.*)$/);
    if (quote) {
      flushList();
      html.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
      continue;
    }

    if (line.trim() === "") {
      flushList();
      continue;
    }

    flushList();
    html.push(`<p>${renderInline(line)}</p>`);
  }

  if (inCode) html.push(`<pre><code>${codeBuf.join("\n")}</code></pre>`);
  flushList();
  return html.join("\n");
}

/* ------------------------------------------------------------------ *
 * Scoped styles — theme tokens, typography, prose, texture.
 * Self-contained (no external CSS / fonts), so the deliverable stays
 * a single portable .tsx.
 * ------------------------------------------------------------------ */

const STYLES = `
.app {
  --font-ui: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
  --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;

  --bg: #f3ece0;
  --paper: #fbf7ef;
  --surface: #fffdf8;
  --surface-2: #efe6d6;
  --ink: #2a2620;
  --muted: #8a8073;
  --faint: #b6a991;
  --accent: #b3502d;
  --accent-soft: rgba(179, 80, 45, 0.12);
  --border: #e5dac6;
  --shadow: rgba(60, 45, 25, 0.10);

  font-family: var(--font-ui);
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
}
.app[data-theme="dark"] {
  --bg: #18150f;
  --paper: #201c15;
  --surface: #262119;
  --surface-2: #322b20;
  --ink: #ece2cf;
  --muted: #9b9180;
  --faint: #6d6453;
  --accent: #e08a5c;
  --accent-soft: rgba(224, 138, 92, 0.16);
  --border: #353026;
  --shadow: rgba(0, 0, 0, 0.4);
}

.grain {
  position: absolute; inset: 0; pointer-events: none; z-index: 50;
  opacity: 0.035; mix-blend-mode: multiply;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
.app[data-theme="dark"] .grain { mix-blend-mode: screen; opacity: 0.05; }

.serif { font-family: var(--font-serif); }

.scroll::-webkit-scrollbar { width: 10px; height: 10px; }
.scroll::-webkit-scrollbar-thumb {
  background: var(--border); border-radius: 9999px;
  border: 3px solid transparent; background-clip: padding-box;
}
.scroll:hover::-webkit-scrollbar-thumb { background: var(--faint); }
.scroll { scrollbar-width: thin; scrollbar-color: var(--border) transparent; }

.note-card { transition: background .15s ease, transform .12s ease, box-shadow .15s ease; }
.note-card:hover { background: var(--surface); }
.note-card[data-active="true"] {
  background: var(--surface);
  box-shadow: 0 1px 0 var(--border), 0 6px 16px -10px var(--shadow);
}
.snippet {
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}

.tool-btn { transition: background .14s ease, color .14s ease, transform .08s ease; }
.tool-btn:hover { background: var(--surface-2); color: var(--accent); }
.tool-btn:active { transform: translateY(1px); }

.seg { transition: color .18s ease; }
.seg[data-on="true"] {
  background: var(--surface);
  box-shadow: 0 1px 2px var(--shadow), 0 0 0 1px var(--border);
  color: var(--accent);
}

.write-surface {
  font-family: var(--font-serif);
  color: var(--ink);
  caret-color: var(--accent);
  font-size: 1.18rem; line-height: 1.75; letter-spacing: 0.003em;
}
.write-surface::placeholder { color: var(--faint); font-style: italic; }
.write-surface::selection,
.markdown-preview ::selection { background: var(--accent-soft); }

.markdown-preview {
  font-family: var(--font-serif);
  color: var(--ink);
  font-size: 1.18rem; line-height: 1.78;
}
.markdown-preview > :first-child { margin-top: 0; }
.markdown-preview h1, .markdown-preview h2, .markdown-preview h3,
.markdown-preview h4, .markdown-preview h5, .markdown-preview h6 {
  font-weight: 600; letter-spacing: -0.01em; line-height: 1.25;
  margin: 1.6rem 0 .6rem;
}
.markdown-preview h1 { font-size: 1.95rem; }
.markdown-preview h2 { font-size: 1.5rem; }
.markdown-preview h3 { font-size: 1.25rem; }
.markdown-preview p { margin: .75rem 0; }
.markdown-preview ul { margin: .6rem 0; padding-left: 1.4rem; list-style: disc; }
.markdown-preview li { margin: .25rem 0; }
.markdown-preview li::marker { color: var(--accent); }
.markdown-preview a { color: var(--accent); text-underline-offset: 3px; }
.markdown-preview strong { font-weight: 700; }
.markdown-preview em { font-style: italic; }
.markdown-preview blockquote {
  margin: 1rem 0; padding: .2rem 0 .2rem 1.1rem;
  border-left: 3px solid var(--accent); color: var(--muted); font-style: italic;
}
.markdown-preview code {
  font-family: var(--font-mono); font-size: .86em;
  background: var(--surface-2); padding: .12em .38em; border-radius: 5px;
}
.markdown-preview pre {
  margin: 1rem 0; padding: 1rem 1.1rem; border-radius: 12px;
  background: var(--ink); color: var(--paper); overflow-x: auto;
  font-size: .92rem; line-height: 1.6;
}
.markdown-preview pre code { background: transparent; padding: 0; font-size: inherit; color: inherit; }

@keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.rise { animation: rise .55s cubic-bezier(.2,.7,.2,1) both; }
`;

/* ------------------------------------------------------------------ *
 * App
 * ------------------------------------------------------------------ */

type SaveStatus = "idle" | "saving" | "saved";
type View = "edit" | "preview";
type Theme = "light" | "dark";
const AUTOSAVE_MS = 400;

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<View>("edit");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  // On small screens only one pane is visible at a time (list <-> editor).
  // On md+ both are always shown, so this is a no-op there.
  const [pane, setPane] = useState<"list" | "editor">("list");
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem("scratchpad-theme") === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });
  const now = Date.now();

  const didInit = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Note | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeNote = useMemo(
    () => notes.find((n) => n.id === activeId) ?? null,
    [notes, activeId]
  );

  const visibleNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)
    );
  }, [notes, query]);

  useEffect(() => {
    try {
      localStorage.setItem("scratchpad-theme", theme);
    } catch {
      /* offline / unavailable — non-fatal */
    }
  }, [theme]);

  /* Initial load (offline). Seed a starter note if the store is empty. */
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    (async () => {
      try {
        let loaded = await getAllNotes();
        if (loaded.length === 0) {
          const starter = newNote(WELCOME);
          await putNote(starter);
          loaded = [starter];
        }
        setNotes(loaded);
        setActiveId(loaded[0].id);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const flush = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const note = pending.current;
    if (!note) return;
    pending.current = null;
    await putNote(note);
    setStatus("saved");
  }, []);

  useEffect(() => {
    const onHide = () => {
      if (pending.current) void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onHide);
    };
  }, [flush]);

  const scheduleSave = useCallback(
    (note: Note) => {
      pending.current = note;
      setStatus("saving");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
    },
    [flush]
  );

  const autoSize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, []);

  // Re-fit the writing surface when the note or mode changes.
  useEffect(() => {
    if (view === "edit") autoSize();
  }, [activeId, view, loading, autoSize, activeNote?.body]);

  const handleChange = useCallback(
    (body: string) => {
      if (!activeId) return;
      const base = notes.find((n) => n.id === activeId);
      if (!base) return;
      const updated: Note = { ...base, body, title: deriveTitle(body), updatedAt: Date.now() };
      setNotes((prev) =>
        prev.map((n) => (n.id === activeId ? updated : n)).sort((a, b) => b.updatedAt - a.updatedAt)
      );
      scheduleSave(updated);
    },
    [activeId, notes, scheduleSave]
  );

  /* Selection-aware formatting for the toolbar + shortcuts. */
  const surround = useCallback(
    (before: string, after: string) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const { selectionStart: s, selectionEnd: e, value } = ta;
      const sel = value.slice(s, e);
      const next = value.slice(0, s) + before + sel + after + value.slice(e);
      handleChange(next);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(s + before.length, s + before.length + sel.length);
        autoSize();
      });
    },
    [handleChange, autoSize]
  );

  const prefixLine = useCallback(
    (prefix: string) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const { selectionStart: s, selectionEnd: e, value } = ta;
      const lineStart = value.lastIndexOf("\n", s - 1) + 1;
      const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
      handleChange(next);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(s + prefix.length, e + prefix.length);
        autoSize();
      });
    },
    [handleChange, autoSize]
  );

  const tools = useMemo(
    () => [
      { key: "h1", icon: Heading1, label: "Heading 1", run: () => prefixLine("# ") },
      { key: "h2", icon: Heading2, label: "Heading 2", run: () => prefixLine("## ") },
      { key: "bold", icon: Bold, label: "Bold  ⌘B", run: () => surround("**", "**") },
      { key: "italic", icon: Italic, label: "Italic  ⌘I", run: () => surround("*", "*") },
      { key: "list", icon: List, label: "List", run: () => prefixLine("- ") },
      { key: "quote", icon: Quote, label: "Quote", run: () => prefixLine("> ") },
      { key: "code", icon: Code, label: "Code", run: () => surround("`", "`") },
      { key: "link", icon: Link2, label: "Link  ⌘K", run: () => surround("[", "](https://)") },
    ],
    [surround, prefixLine]
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "b") {
        e.preventDefault();
        surround("**", "**");
      } else if (k === "i") {
        e.preventDefault();
        surround("*", "*");
      } else if (k === "k") {
        e.preventDefault();
        surround("[", "](https://)");
      }
    },
    [surround]
  );

  const handleNew = useCallback(async () => {
    await flush();
    const note = newNote("");
    await putNote(note);
    setNotes((prev) => [note, ...prev]);
    setActiveId(note.id);
    setView("edit");
    setStatus("saved");
    setPane("editor");
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [flush]);

  const handleSelect = useCallback(
    async (id: string) => {
      // Always reveal the editor pane on mobile — even when re-tapping the
      // currently-active note (otherwise it'd be unreachable on small screens).
      setPane("editor");
      if (id === activeId) return;
      await flush();
      setActiveId(id);
      setView("edit");
      setStatus("idle");
    },
    [activeId, flush]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteNote(id);
      const remaining = notes.filter((n) => n.id !== id);
      if (remaining.length === 0) {
        const note = newNote("");
        await putNote(note);
        setNotes([note]);
        setActiveId(note.id);
      } else {
        setNotes(remaining);
        if (activeId === id) setActiveId(remaining[0].id);
      }
    },
    [notes, activeId]
  );

  const previewHtml = useMemo(
    () => (activeNote ? renderMarkdown(activeNote.body) : ""),
    [activeNote]
  );
  const words = activeNote ? countWords(activeNote.body) : 0;
  const readMin = Math.max(1, Math.round(words / 200));

  return (
    <div data-theme={theme} className="app relative flex h-[100dvh] w-full overflow-hidden bg-[var(--bg)]">
      <style>{STYLES}</style>
      <div className="grain" />

      {/* ---------------- Sidebar ---------------- */}
      <aside
        className={`${
          pane === "editor" ? "hidden md:flex" : "flex"
        } z-10 w-full shrink-0 flex-col border-r border-[var(--border)] bg-[var(--paper)] md:w-72`}
      >
        <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
            <Feather className="h-[18px] w-[18px]" />
          </span>
          <span className="serif text-[17px] font-semibold tracking-tight">Scratchpad</span>
          <button
            onClick={handleNew}
            aria-label="New note"
            title="New note"
            className="tool-btn ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)]"
          >
            <Plus className="h-[18px] w-[18px]" />
          </button>
        </div>

        <div className="px-4 pb-3">
          <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
            <Search className="h-4 w-4 text-[var(--faint)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search notes"
              placeholder="Search"
              className="w-full bg-transparent text-sm text-[var(--ink)] placeholder:text-[var(--faint)] outline-none"
            />
          </div>
        </div>

        <ul className="scroll flex-1 overflow-y-auto px-3 pb-3">
          {visibleNotes.length === 0 && (
            <li className="px-3 py-10 text-center text-sm text-[var(--faint)]">
              {query ? "No matching notes" : "No notes yet"}
            </li>
          )}
          {visibleNotes.map((note) => {
            const isActive = note.id === activeId;
            const preview = snippet(note.body);
            return (
              <li key={note.id}>
                <div
                  className="note-card group mb-1 cursor-pointer rounded-xl px-3 py-2.5"
                  data-active={isActive}
                  onClick={() => handleSelect(note.id)}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        isActive ? "bg-[var(--accent)]" : "bg-transparent"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="serif truncate text-[15px] font-medium leading-snug">
                        {note.title}
                      </div>
                      <div className="snippet mt-0.5 text-[12.5px] leading-snug text-[var(--muted)]">
                        {preview || "Empty note"}
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--faint)]">
                        <span>{relativeTime(note.updatedAt, now)}</span>
                        <span>·</span>
                        <span>{countWords(note.body)} words</span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(note.id);
                      }}
                      aria-label={`Delete ${note.title}`}
                      title="Delete note"
                      className="tool-btn -mr-1 mt-0.5 rounded-md p-1 text-[var(--faint)] opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-1.5 border-t border-[var(--border)] px-5 py-3 text-[12px] text-[var(--muted)]">
          <WifiOff className="h-3.5 w-3.5 text-[var(--accent)]" />
          <span>Works offline</span>
        </div>
      </aside>

      {/* ---------------- Main ---------------- */}
      <main
        className={`${
          pane === "list" ? "hidden md:flex" : "flex"
        } z-10 w-full flex-1 flex-col bg-[var(--bg)]`}
      >
        <header className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-3 md:gap-3 md:px-6">
          <button
            onClick={() => setPane("list")}
            aria-label="Back to notes"
            title="Back to notes"
            className="tool-btn -ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] md:hidden"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h2 className="serif min-w-0 flex-1 truncate text-[15px] font-medium text-[var(--ink)] md:flex-none">
            {activeNote ? activeNote.title : "—"}
          </h2>

          <div className="ml-auto flex shrink-0 items-center gap-2 md:gap-3">
            <SaveIndicator status={status} />

            <div className="flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
              <button
                onClick={() => setView("edit")}
                data-on={view === "edit"}
                aria-label="Write mode"
                className="seg flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] text-[var(--muted)]"
              >
                <PenLine className="h-3.5 w-3.5" /> Write
              </button>
              <button
                onClick={() => setView("preview")}
                data-on={view === "preview"}
                aria-label="Preview mode"
                className="seg flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] text-[var(--muted)]"
              >
                <BookOpen className="h-3.5 w-3.5" /> Read
              </button>
            </div>

            <button
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              aria-label="Toggle theme"
              title="Toggle theme"
              className="tool-btn flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)]"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </header>

        {/* Formatting toolbar */}
        {view === "edit" && (
          <div className="scroll flex items-center gap-0.5 overflow-x-auto border-b border-[var(--border)] px-3 py-1.5 md:px-5">
            {tools.map((t, i) => (
              <span key={t.key} className="flex shrink-0 items-center">
                <button
                  onClick={t.run}
                  aria-label={t.label}
                  title={t.label}
                  className="tool-btn flex h-9 w-9 items-center justify-center rounded-md text-[var(--muted)] md:h-8 md:w-8"
                >
                  <t.icon className="h-[17px] w-[17px]" />
                </button>
                {(i === 1 || i === 3 || i === 5) && (
                  <span className="mx-1 h-4 w-px bg-[var(--border)]" />
                )}
              </span>
            ))}
          </div>
        )}

        {/* Writing surface */}
        <div className="scroll relative flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex h-full items-center justify-center text-[var(--faint)]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <div key={`${activeId}-${view}`} className="rise mx-auto w-full max-w-[720px] px-5 py-8 md:px-10 md:py-12">
              {view === "edit" ? (
                <textarea
                  ref={textareaRef}
                  aria-label="Note editor"
                  placeholder="Start writing…"
                  value={activeNote?.body ?? ""}
                  onChange={(e) => handleChange(e.target.value)}
                  onInput={autoSize}
                  onKeyDown={onKeyDown}
                  spellCheck
                  className="write-surface block min-h-[60vh] w-full resize-none bg-transparent outline-none"
                />
              ) : (
                <div
                  className="markdown-preview"
                  // input is HTML-escaped before rendering — see renderMarkdown
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              )}
            </div>
          )}
        </div>

        {/* Status bar */}
        <footer className="flex items-center gap-3 border-t border-[var(--border)] px-6 py-2 text-[12px] text-[var(--muted)]">
          <span>{words} words</span>
          <span className="text-[var(--faint)]">·</span>
          <span>{readMin} min read</span>
          <span className="ml-auto flex items-center gap-1.5 text-[var(--accent)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            Saved locally
          </span>
        </footer>
      </main>
    </div>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-[var(--muted)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span className="hidden sm:inline">Saving…</span>
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-[var(--accent)]">
        <Check className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Saved</span>
      </span>
    );
  }
  return null;
}
