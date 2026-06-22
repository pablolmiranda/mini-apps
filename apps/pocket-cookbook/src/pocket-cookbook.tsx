import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ChefHat,
  Plus,
  Search,
  ArrowLeft,
  Pencil,
  Trash2,
  Clock,
  Users,
  Eye,
  EyeOff,
  ImagePlus,
  X,
  Check,
  Sun,
  Moon,
  Utensils,
} from "lucide-react";

/* ------------------------------------------------------------------ *
 * Model
 * ------------------------------------------------------------------ */

interface Recipe {
  id: string;
  title: string;
  description: string;
  servings: string;
  time: string;
  ingredients: string[];
  steps: string[];
  tags: string[];
  image?: string; // data URL
  createdAt: number;
  updatedAt: number;
}

type Theme = "light" | "dark";
type Route =
  | { name: "library" }
  | { name: "view"; id: string }
  | { name: "edit"; id: string | null };

/* ------------------------------------------------------------------ *
 * IndexedDB (hand-rolled, zero-dependency) — fully offline.
 * ------------------------------------------------------------------ */

const DB_NAME = "pocket-cookbook";
const DB_VERSION = 1;
const STORE = "recipes";

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

async function getAllRecipes(): Promise<Recipe[]> {
  const db = await openDB();
  try {
    const all = await reqToPromise(store(db, "readonly").getAll() as IDBRequest<Recipe[]>);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    db.close();
  }
}

async function putRecipe(r: Recipe): Promise<void> {
  const db = await openDB();
  try {
    await reqToPromise(store(db, "readwrite").put(r));
  } finally {
    db.close();
  }
}

async function deleteRecipe(id: string): Promise<void> {
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

function parseLines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

function parseTags(text: string): string[] {
  return text.split(",").map((t) => t.trim()).filter(Boolean);
}

const WAKE_KEY = "pocket-cookbook:keep-awake";
const THEME_KEY = "pocket-cookbook:theme";

interface WakeLockSentinelLike {
  release(): Promise<void>;
}
interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}
function getWakeLock(): WakeLockLike | undefined {
  return (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
}

/** Read a File and downscale it to a JPEG data URL (keeps IndexedDB small). */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onload = () => {
        try {
          const max = 1280;
          let { width, height } = img;
          if (width > max || height > max) {
            const r = Math.min(max / width, max / height);
            width = Math.round(width * r);
            height = Math.round(height * r);
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) return resolve(src);
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        } catch {
          resolve(src);
        }
      };
      img.onerror = () => resolve(src);
      img.src = src;
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const SAMPLES: Recipe[] = [
  {
    id: "sample-pasta",
    title: "Weeknight Tomato Pasta",
    description: "A 20-minute pantry pasta that tastes like you tried much harder.",
    servings: "2",
    time: "20 min",
    ingredients: [
      "200g spaghetti",
      "1 can (400g) whole tomatoes",
      "3 garlic cloves, sliced",
      "3 tbsp olive oil",
      "Pinch of chilli flakes",
      "Handful of basil",
      "Parmesan, to serve",
    ],
    steps: [
      "Boil the spaghetti in well-salted water until al dente.",
      "Meanwhile, warm the olive oil and gently fry the garlic and chilli.",
      "Add the tomatoes, crushing them, and simmer 10 minutes.",
      "Toss the drained pasta through the sauce with a splash of pasta water.",
      "Finish with torn basil and plenty of parmesan.",
    ],
    tags: ["dinner", "vegetarian", "quick"],
    createdAt: 1,
    updatedAt: 3,
  },
  {
    id: "sample-pancakes",
    title: "Fluffy Buttermilk Pancakes",
    description: "Tall, tender, weekend-worthy pancakes.",
    servings: "4",
    time: "25 min",
    ingredients: [
      "200g plain flour",
      "2 tbsp sugar",
      "2 tsp baking powder",
      "1/2 tsp salt",
      "300ml buttermilk",
      "2 eggs",
      "50g melted butter",
    ],
    steps: [
      "Whisk the dry ingredients in one bowl, the wet in another.",
      "Fold together until just combined — lumps are fine.",
      "Rest the batter 5 minutes while a pan heats on medium.",
      "Cook until bubbles form, flip, and cook until golden.",
      "Stack and serve with butter and maple syrup.",
    ],
    tags: ["breakfast", "sweet"],
    createdAt: 1,
    updatedAt: 2,
  },
];

/* ------------------------------------------------------------------ *
 * Scoped styles
 * ------------------------------------------------------------------ */

const STYLES = `
.ck {
  --font-ui: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-display: "Hoefler Text", "Iowan Old Style", Palatino, "Palatino Linotype", Georgia, serif;
  font-family: var(--font-ui);
  -webkit-font-smoothing: antialiased;
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}
.ck[data-theme="light"] {
  --bg: #f7f2e8;
  --surface: #fffdf8;
  --surface-2: #efe7d6;
  --text: #2a2420;
  --muted: #837a6c;
  --faint: #b3a894;
  --border: #e7ddca;
  --accent: #c8442f;
  --accent-soft: rgba(200,68,47,.10);
  --shadow: rgba(80,50,20,.10);
}
.ck[data-theme="dark"] {
  --bg: #1a1613;
  --surface: #241f1a;
  --surface-2: #2e2820;
  --text: #efe7da;
  --muted: #a59b8b;
  --faint: #6f6557;
  --border: #352e26;
  --accent: #e85d44;
  --accent-soft: rgba(232,93,68,.16);
  --shadow: rgba(0,0,0,.45);
}
.display { font-family: var(--font-display); }

.card { transition: transform .14s ease, box-shadow .18s ease; }
.card:hover { transform: translateY(-2px); box-shadow: 0 14px 30px -18px var(--shadow); }
.btn { transition: transform .08s ease, background .15s ease, color .15s ease; }
.btn:active { transform: scale(.95); }

.check-line { transition: color .15s ease, opacity .15s ease; }
.checked { color: var(--faint); text-decoration: line-through; }

.scroll::-webkit-scrollbar { width: 9px; }
.scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 9999px; border: 2px solid transparent; background-clip: padding-box; }

@keyframes rise { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
.rise { animation: rise .45s cubic-bezier(.2,.7,.2,1) both; }
@keyframes slideUp { from { transform: translateY(100%) } to { transform: none } }
.sheet { animation: slideUp .26s cubic-bezier(.2,.8,.2,1) both; }
@media (prefers-reduced-motion: reduce) { .card, .btn, .rise, .sheet { transition: none; animation: none; } }
`;

/* ------------------------------------------------------------------ *
 * App
 * ------------------------------------------------------------------ */

export default function App() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [route, setRoute] = useState<Route>({ name: "library" });
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });
  const [keepAwake, setKeepAwake] = useState<boolean>(() => {
    try {
      return localStorage.getItem(WAKE_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [wakeActive, setWakeActive] = useState(false);
  const [checkedIng, setCheckedIng] = useState<Set<number>>(new Set());
  const [checkedStep, setCheckedStep] = useState<Set<number>>(new Set());

  const didInit = useRef(false);

  const activeRecipe = useMemo(() => {
    const id = route.name === "view" ? route.id : route.name === "edit" ? route.id : null;
    return id ? recipes.find((r) => r.id === id) ?? null : null;
  }, [route, recipes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recipes;
    return recipes.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q)) ||
        r.ingredients.some((i) => i.toLowerCase().includes(q))
    );
  }, [recipes, query]);

  /* Initial load (offline). Seed samples if empty. */
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    (async () => {
      try {
        let all = await getAllRecipes();
        if (all.length === 0) {
          for (const s of SAMPLES) await putRecipe(s);
          all = await getAllRecipes();
        }
        setRecipes(all);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  useEffect(() => {
    try {
      localStorage.setItem(WAKE_KEY, keepAwake ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [keepAwake]);

  /* Wake Lock while reading a recipe (the kitchen hero feature). */
  useEffect(() => {
    if (route.name !== "view" || !keepAwake) {
      setWakeActive(false);
      return;
    }
    const wl = getWakeLock();
    if (!wl) {
      setWakeActive(false);
      return;
    }
    let sentinel: WakeLockSentinelLike | null = null;
    let active = true;
    const acquire = async () => {
      try {
        sentinel = await wl.request("screen");
        if (active) setWakeActive(true);
      } catch {
        if (active) setWakeActive(false);
      }
    };
    void acquire();
    const onVis = () => {
      if (document.visibilityState === "visible" && active) void acquire();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      active = false;
      setWakeActive(false);
      document.removeEventListener("visibilitychange", onVis);
      if (sentinel) void sentinel.release().catch(() => {});
    };
  }, [route, keepAwake]);

  const openRecipe = useCallback((id: string) => {
    setCheckedIng(new Set());
    setCheckedStep(new Set());
    setRoute({ name: "view", id });
  }, []);

  const saveRecipe = useCallback(
    async (draft: EditorDraft) => {
      const now = Date.now();
      const base = draft.id ? recipes.find((r) => r.id === draft.id) : undefined;
      const recipe: Recipe = {
        id: draft.id ?? genId(),
        title: draft.title.trim() || "Untitled recipe",
        description: draft.description.trim(),
        servings: draft.servings.trim(),
        time: draft.time.trim(),
        ingredients: parseLines(draft.ingredientsText),
        steps: parseLines(draft.stepsText),
        tags: parseTags(draft.tagsText),
        image: draft.image,
        createdAt: base?.createdAt ?? now,
        updatedAt: now,
      };
      await putRecipe(recipe);
      setRecipes((prev) =>
        [recipe, ...prev.filter((r) => r.id !== recipe.id)].sort((a, b) => b.updatedAt - a.updatedAt)
      );
      openRecipe(recipe.id);
    },
    [recipes, openRecipe]
  );

  const removeRecipe = useCallback(async (id: string) => {
    await deleteRecipe(id);
    setRecipes((prev) => prev.filter((r) => r.id !== id));
    setRoute({ name: "library" });
  }, []);

  const toggleSet = (set: Set<number>, i: number): Set<number> => {
    const next = new Set(set);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    return next;
  };

  return (
    <div
      data-theme={theme}
      className="ck flex h-[100dvh] w-full flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)]"
    >
      <style>{STYLES}</style>

      {route.name === "library" && (
        <Library
          loading={loading}
          recipes={filtered}
          total={recipes.length}
          query={query}
          setQuery={setQuery}
          theme={theme}
          toggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          onOpen={openRecipe}
          onNew={() => setRoute({ name: "edit", id: null })}
        />
      )}

      {route.name === "view" && activeRecipe && (
        <CookView
          recipe={activeRecipe}
          keepAwake={keepAwake}
          wakeActive={wakeActive}
          wakeSupported={Boolean(getWakeLock())}
          onToggleAwake={() => setKeepAwake((v) => !v)}
          checkedIng={checkedIng}
          checkedStep={checkedStep}
          onToggleIng={(i) => setCheckedIng((s) => toggleSet(s, i))}
          onToggleStep={(i) => setCheckedStep((s) => toggleSet(s, i))}
          onBack={() => setRoute({ name: "library" })}
          onEdit={() => setRoute({ name: "edit", id: activeRecipe.id })}
          onDelete={() => removeRecipe(activeRecipe.id)}
        />
      )}

      {route.name === "edit" && (
        <Editor
          recipe={route.id ? activeRecipe : null}
          onCancel={() =>
            route.id && activeRecipe
              ? setRoute({ name: "view", id: activeRecipe.id })
              : setRoute({ name: "library" })
          }
          onSave={saveRecipe}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Library
 * ------------------------------------------------------------------ */

function Library({
  loading,
  recipes,
  total,
  query,
  setQuery,
  theme,
  toggleTheme,
  onOpen,
  onNew,
}: {
  loading: boolean;
  recipes: Recipe[];
  total: number;
  query: string;
  setQuery: (v: string) => void;
  theme: Theme;
  toggleTheme: () => void;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <>
      <header className="flex items-center gap-2 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
          <ChefHat className="h-5 w-5" />
        </span>
        <div>
          <h1 className="display text-[20px] font-semibold leading-none tracking-tight">Pocket Cookbook</h1>
          <p className="mt-0.5 text-[11px] text-[var(--faint)]">{total} recipes · works offline</p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={toggleTheme} aria-label="Toggle theme" className="btn flex h-9 w-9 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--surface)]">
            {theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          </button>
          <button onClick={onNew} aria-label="Add recipe" className="btn flex h-9 items-center gap-1.5 rounded-full bg-[var(--accent)] pl-2.5 pr-3.5 text-sm font-semibold text-white">
            <Plus className="h-4 w-4" /> New
          </button>
        </div>
      </header>

      <div className="px-5 pb-3">
        <div className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5">
          <Search className="h-4 w-4 text-[var(--faint)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search recipes"
            placeholder="Search recipes, tags, ingredients"
            className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--faint)]"
          />
        </div>
      </div>

      <div className="scroll flex-1 overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {loading ? (
          <p className="py-16 text-center text-sm text-[var(--faint)]">Loading your cookbook…</p>
        ) : recipes.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-20 text-center text-[var(--faint)]">
            <Utensils className="h-9 w-9" />
            <p className="text-sm">{query ? "No matching recipes" : "No recipes yet — add your first"}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            {recipes.map((r) => (
              <button
                key={r.id}
                onClick={() => onOpen(r.id)}
                aria-label={`Open ${r.title}`}
                className="card group overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-left"
              >
                <div className="relative aspect-[16/10] w-full overflow-hidden bg-[var(--surface-2)]">
                  {r.image ? (
                    <img src={r.image} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-[var(--accent-soft)] text-[var(--accent)]">
                      <Utensils className="h-8 w-8 opacity-70" />
                    </div>
                  )}
                </div>
                <div className="p-3.5">
                  <h3 className="display text-[17px] font-semibold leading-snug">{r.title}</h3>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--muted)]">
                    {r.time && (
                      <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{r.time}</span>
                    )}
                    {r.servings && (
                      <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{r.servings}</span>
                    )}
                  </div>
                  {r.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {r.tags.slice(0, 3).map((t) => (
                        <span key={t} className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[10.5px] text-[var(--muted)]">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Cook view
 * ------------------------------------------------------------------ */

function CookView({
  recipe,
  keepAwake,
  wakeActive,
  wakeSupported,
  onToggleAwake,
  checkedIng,
  checkedStep,
  onToggleIng,
  onToggleStep,
  onBack,
  onEdit,
  onDelete,
}: {
  recipe: Recipe;
  keepAwake: boolean;
  wakeActive: boolean;
  wakeSupported: boolean;
  onToggleAwake: () => void;
  checkedIng: Set<number>;
  checkedStep: Set<number>;
  onToggleIng: (i: number) => void;
  onToggleStep: (i: number) => void;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <header className="flex items-center gap-1 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <button onClick={onBack} aria-label="Back" className="btn flex h-9 w-9 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--surface)]">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <button
          onClick={onToggleAwake}
          aria-label="Keep screen awake"
          aria-pressed={keepAwake}
          className={`btn ml-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium ${
            keepAwake ? "bg-[var(--accent)] text-white" : "bg-[var(--surface)] text-[var(--muted)]"
          }`}
        >
          {keepAwake ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          {keepAwake ? "Awake" : "Screen off"}
        </button>
        <button onClick={onEdit} aria-label="Edit recipe" className="btn flex h-9 w-9 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--surface)]">
          <Pencil className="h-[18px] w-[18px]" />
        </button>
        <button onClick={() => setConfirming(true)} aria-label="Delete recipe" className="btn flex h-9 w-9 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--surface)] hover:text-rose-500">
          <Trash2 className="h-[18px] w-[18px]" />
        </button>
      </header>

      <div className="scroll flex-1 overflow-y-auto pb-[max(2rem,env(safe-area-inset-bottom))]">
        <div className="rise mx-auto w-full max-w-2xl px-5">
          {recipe.image && (
            <div className="mb-4 aspect-[16/9] w-full overflow-hidden rounded-2xl bg-[var(--surface-2)]">
              <img src={recipe.image} alt="" className="h-full w-full object-cover" />
            </div>
          )}

          <h1 className="display text-[30px] font-bold leading-tight tracking-tight">{recipe.title}</h1>
          {recipe.description && <p className="mt-1.5 text-[15px] leading-relaxed text-[var(--muted)]">{recipe.description}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-[var(--muted)]">
            {recipe.time && <span className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-[var(--accent)]" />{recipe.time}</span>}
            {recipe.servings && <span className="flex items-center gap-1.5"><Users className="h-4 w-4 text-[var(--accent)]" />Serves {recipe.servings}</span>}
          </div>

          {keepAwake && wakeSupported && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--accent-soft)] bg-[var(--accent-soft)] px-3 py-2 text-[12.5px] text-[var(--accent)]">
              <Eye className="h-4 w-4" />
              {wakeActive ? "Screen stays awake while you cook" : "Screen will stay awake while cooking"}
            </div>
          )}

          {recipe.ingredients.length > 0 && (
            <section className="mt-6">
              <h2 className="display mb-2 text-[19px] font-semibold">Ingredients</h2>
              <ul className="space-y-1">
                {recipe.ingredients.map((ing, i) => {
                  const on = checkedIng.has(i);
                  return (
                    <li key={i}>
                      <button onClick={() => onToggleIng(i)} role="checkbox" aria-checked={on} className="flex w-full items-start gap-3 rounded-lg px-1 py-1.5 text-left">
                        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${on ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--border)]"}`}>
                          {on && <Check className="h-3.5 w-3.5" />}
                        </span>
                        <span className={`check-line text-[15.5px] leading-snug ${on ? "checked" : ""}`}>{ing}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {recipe.steps.length > 0 && (
            <section className="mt-6">
              <h2 className="display mb-2 text-[19px] font-semibold">Method</h2>
              <ol className="space-y-2.5">
                {recipe.steps.map((step, i) => {
                  const on = checkedStep.has(i);
                  return (
                    <li key={i}>
                      <button onClick={() => onToggleStep(i)} role="checkbox" aria-checked={on} className="flex w-full items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left">
                        <span className={`display flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${on ? "bg-[var(--accent)] text-white" : "bg-[var(--surface-2)] text-[var(--accent)]"}`}>
                          {on ? <Check className="h-4 w-4" /> : i + 1}
                        </span>
                        <span className={`check-line text-[16px] leading-relaxed ${on ? "checked" : ""}`}>{step}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
        </div>
      </div>

      {confirming && (
        <div className="absolute inset-0 z-20 flex items-end justify-center sm:items-center">
          <button aria-label="Cancel" className="absolute inset-0 bg-black/50" onClick={() => setConfirming(false)} />
          <div className="sheet relative m-4 w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <h3 className="display text-lg font-semibold">Delete this recipe?</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">“{recipe.title}” will be removed from your cookbook.</p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setConfirming(false)} className="btn flex-1 rounded-xl bg-[var(--surface-2)] py-2.5 text-sm font-medium">Cancel</button>
              <button onClick={onDelete} aria-label="Confirm delete" className="btn flex-1 rounded-xl bg-rose-500 py-2.5 text-sm font-semibold text-white">Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Editor
 * ------------------------------------------------------------------ */

interface EditorDraft {
  id: string | null;
  title: string;
  description: string;
  servings: string;
  time: string;
  ingredientsText: string;
  stepsText: string;
  tagsText: string;
  image?: string;
}

function Editor({
  recipe,
  onCancel,
  onSave,
}: {
  recipe: Recipe | null;
  onCancel: () => void;
  onSave: (draft: EditorDraft) => void;
}) {
  const [draft, setDraft] = useState<EditorDraft>(() => ({
    id: recipe?.id ?? null,
    title: recipe?.title ?? "",
    description: recipe?.description ?? "",
    servings: recipe?.servings ?? "",
    time: recipe?.time ?? "",
    ingredientsText: recipe?.ingredients.join("\n") ?? "",
    stepsText: recipe?.steps.join("\n") ?? "",
    tagsText: recipe?.tags.join(", ") ?? "",
    image: recipe?.image,
  }));
  const fileRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof EditorDraft>(k: K, v: EditorDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const onPickImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      set("image", await fileToDataUrl(file));
    } catch {
      /* ignore bad image */
    }
  };

  return (
    <>
      <header className="flex items-center gap-2 border-b border-[var(--border)] px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2.5">
        <button onClick={onCancel} aria-label="Cancel" className="btn flex h-9 items-center gap-1 rounded-full px-2 text-sm text-[var(--muted)] hover:bg-[var(--surface)]">
          <X className="h-[18px] w-[18px]" /> Cancel
        </button>
        <h2 className="display ml-1 text-[16px] font-semibold">{recipe ? "Edit recipe" : "New recipe"}</h2>
        <button onClick={() => onSave(draft)} aria-label="Save recipe" className="btn ml-auto flex h-9 items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 text-sm font-semibold text-white">
          <Check className="h-4 w-4" /> Save
        </button>
      </header>

      <div className="scroll flex-1 overflow-y-auto px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4">
        <div className="mx-auto w-full max-w-2xl space-y-4">
          {/* Image */}
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              aria-label="Recipe photo"
              onChange={(e) => onPickImage(e.target.files?.[0])}
            />
            {draft.image ? (
              <div className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl bg-[var(--surface-2)]">
                <img src={draft.image} alt="" className="h-full w-full object-cover" />
                <button onClick={() => set("image", undefined)} aria-label="Remove photo" className="btn absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button onClick={() => fileRef.current?.click()} className="btn flex aspect-[16/9] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]">
                <ImagePlus className="h-7 w-7" />
                <span className="text-sm">Add a photo</span>
              </button>
            )}
          </div>

          <Field label="Title">
            <input value={draft.title} onChange={(e) => set("title", e.target.value)} aria-label="Title" placeholder="Grandma’s lasagna" className="w-full bg-transparent text-[17px] font-medium outline-none placeholder:text-[var(--faint)]" />
          </Field>

          <Field label="Description">
            <textarea value={draft.description} onChange={(e) => set("description", e.target.value)} aria-label="Description" placeholder="A short note about this dish" rows={2} className="w-full resize-none bg-transparent text-[15px] outline-none placeholder:text-[var(--faint)]" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Time">
              <input value={draft.time} onChange={(e) => set("time", e.target.value)} aria-label="Time" placeholder="45 min" className="w-full bg-transparent text-[15px] outline-none placeholder:text-[var(--faint)]" />
            </Field>
            <Field label="Servings">
              <input value={draft.servings} onChange={(e) => set("servings", e.target.value)} aria-label="Servings" placeholder="4" className="w-full bg-transparent text-[15px] outline-none placeholder:text-[var(--faint)]" />
            </Field>
          </div>

          <Field label="Ingredients" hint="one per line">
            <textarea value={draft.ingredientsText} onChange={(e) => set("ingredientsText", e.target.value)} aria-label="Ingredients" placeholder={"200g flour\n2 eggs\n…"} rows={6} className="w-full resize-none bg-transparent font-mono text-[14px] leading-relaxed outline-none placeholder:text-[var(--faint)]" />
          </Field>

          <Field label="Method" hint="one step per line">
            <textarea value={draft.stepsText} onChange={(e) => set("stepsText", e.target.value)} aria-label="Steps" placeholder={"Preheat the oven…\nMix the dry ingredients…"} rows={7} className="w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-[var(--faint)]" />
          </Field>

          <Field label="Tags" hint="comma separated">
            <input value={draft.tagsText} onChange={(e) => set("tagsText", e.target.value)} aria-label="Tags" placeholder="dinner, vegetarian" className="w-full bg-transparent text-[15px] outline-none placeholder:text-[var(--faint)]" />
          </Field>
        </div>
      </div>
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</span>
        {hint && <span className="text-[11px] text-[var(--faint)]">{hint}</span>}
      </div>
      {children}
    </label>
  );
}
