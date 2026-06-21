# AGENT.md — building mini-apps

Context for AI agents (and humans) working in this repo. Read this before
creating or modifying a mini-app. The first app, `markdown-scratchpad/`, is the
**reference implementation** — copy its structure.

## What this repo is

A monorepo of small, self-contained web apps. Each mini-app builds to **one
`.tsx` file** that an **existing external PWA Store** ingests. The Store wraps the
file with the PWA layer (web app manifest + service worker); we do **not** build
the Store, a bundler, or the PWA wrapper here. Our job is the **authoring +
local-verify pipeline** that reliably produces a Store-compatible `.tsx`.

The deliverable is the same shape the **Claude web interface** produces: a single
default-exported React component using Tailwind classes and `lucide-react` icons.

## The Store contract (NON-NEGOTIABLE)

Every deliverable `src/<app>.tsx` must:

- import **only** from `react` and `lucide-react` — no other packages, **no
  relative imports** (it must be one self-contained file);
- **`export default`** the root component (the Store mounts the default export);
- style with **Tailwind utility classes**;
- be fully functional **offline** (no network calls at runtime).

`scripts/check-contract.mjs` enforces all of this and gates the build. The
allowed-import allowlist is the array at the top of that script — **the single
source of truth**. Update it there if the Store's allowed imports ever change.

Assumptions still unconfirmed with the Store owner (flagged, non-blocking):
- allowlist is exactly `react` + `lucide-react`;
- the Store reads only the default export (so we avoid extra named exports;
  tests drive the component, not internal helpers);
- the Store's HTML wrapper provides Tailwind at runtime **and** a
  `<meta name="viewport" content="width=device-width, initial-scale=1">`.

## Repo layout

```
mini-apps/
  package.json            npm workspaces + root script
  tsconfig.base.json      shared strict TS (jsx: react-jsx)
  scripts/check-contract.mjs   the build gate (allowlist lives here)
  README.md / AGENT.md
  <app>/                  one folder per mini-app
    src/<app>.tsx         THE deliverable (single file)
    preview/              local dev host — NOT part of the deliverable
      index.html, main.tsx, styles.css
    test/                 vitest + fake-indexeddb
    vite.config.ts        dev/preview host (root: preview)
    vitest.config.ts      separate so tests run from app root
    tsconfig.json
    dist/<app>.tsx        build output = upload artifact
```

## Per-app scripts (in `<app>/package.json`)

- `dev` — Vite preview host with HMR (see it in a browser)
- `typecheck` — `tsc --noEmit`
- `test` — `vitest run` (jsdom + `fake-indexeddb/auto`)
- `check` — runs `scripts/check-contract.mjs` against `src/<app>.tsx`
- `build` — typecheck + test + check, then copy `src → dist`
- `verify` — `build` + `vite build` of the preview (compile/render smoke test)

`npm install` once at the repo root; run the scripts inside the app folder.

## How to add a new mini-app

1. Copy `markdown-scratchpad/` to `mini-apps/<new-app>/`; rename `src/<new-app>.tsx`.
2. Add `<new-app>` to `workspaces` in the root `package.json`.
3. In `<new-app>/preview/styles.css` keep the `@source` lines pointing at
   `../src/**/*.tsx` (see Gotcha #1).
4. Author the app as one `src/<new-app>.tsx` (default export; only react +
   lucide-react; Tailwind classes).
5. `npm install` at root, then `npm run verify` in the app folder.
6. Upload `dist/<new-app>.tsx` to the PWA Store.

## Conventions worth reusing (from the reference app)

- **Hand-rolled, zero-dep IndexedDB** layer inlined at the top of the file
  (`openDB` / `getAll` / `put` / `delete` via promise-wrapped `IDBRequest`). No
  `idb`/`dexie` — keeps the file self-contained and offline-safe.
- **Autosave**: debounce (~400ms) → write; show a `Saving… → Saved` indicator;
  also flush on `visibilitychange` + `beforeunload` so no edit is lost.
- **Scoped `<style>` block** rendered inside the component for things Tailwind
  can't/shouldn't own: CSS-variable theming (light/dark via `data-theme`),
  prose typography, custom scrollbars, selection/caret colors, grain texture,
  keyframes. This is allowed by the contract (it's just JSX) and makes the app's
  look **independent of the Store's Tailwind version** — only layout utilities
  depend on the Store's Tailwind.
- **Theme**: tokens as CSS vars on a root `.app` class; `data-theme="dark"`
  overrides; persist choice in `localStorage` (wrapped in try/catch).
- **Aesthetic bar is high** — invoke the `frontend-design` skill for any new UI.
  The reference app's direction is "Ink & Paper" (warm paper, serif writing
  surface, terracotta accent). Pick a *distinct* direction per app; don't reuse.
- **Mobile web first.** Design for the phone viewport (~390px) first, then scale
  up to desktop with `md:`+ breakpoints — not the other way around. These are
  PWAs people install and open on their phones, so the mobile experience is the
  primary one. Start every layout single-column/one-pane and add desktop
  affordances on top (see Gotcha #3). Always verify at ~390px before calling a
  design done.

## GOTCHAS (hard-won this session — don't relearn these)

1. **Tailwind v4 doesn't scan `../src`.** The preview's Vite `root` is `preview/`,
   the deliverable lives in `../src`, and there's no git repo to anchor v4's
   auto content-detection → the built CSS shipped with **zero utilities** and the
   app looked completely unstyled. Fix: explicit `@source` directives in
   `preview/styles.css`:
   ```css
   @import "tailwindcss";
   @source "../src/**/*.tsx";
   @source "./**/*.{tsx,html}";
   ```
   Verify after building: `grep -c '\.flex' dist-preview/assets/*.css` should be > 0.

2. **Escape-before-parse breaks `>` blockquotes.** If you HTML-escape the whole
   markdown string *before* block parsing, `>` becomes `&gt;` and the blockquote
   regex never matches. Either parse block structure pre-escape, or match the
   entity: `/^&gt;\s?(.*)$/`. (Markdown rendering must stay XSS-safe: escape
   first, then apply a small set of safe inline/block rules; validate link URLs
   to `https?:`/`mailto:`/`/`/`#` only. `dangerouslySetInnerHTML` is acceptable
   *only* because input is escaped first — the contract checker warns on it.)

3. **Mobile needs a one-pane-at-a-time layout.** A fixed two-column flex
   (`w-72` sidebar + main) shoves the editor off-screen on phones. Pattern: a
   `pane: 'list' | 'editor'` state toggles visibility under the `md` breakpoint
   (`hidden md:flex`); desktop shows both. Provide a back button (`md:hidden`),
   make toolbars `overflow-x-auto`, use `h-[100dvh]`, and shrink padding on
   mobile. Always test at ~390px width.

4. **`handleSelect` early-return hid the editor on mobile.** Returning early when
   `id === activeId` meant tapping the already-active note never switched panes,
   so its editor was unreachable on mobile. Do navigation side-effects (e.g.
   `setPane('editor')`) **before** any `id === activeId` guard.

5. **StrictMode double-invokes effects.** Guard one-time init (e.g. seeding a
   starter note) with a `useRef(false)` flag so you don't create duplicates.

## Verifying a build actually works (visual)

Tests + typecheck + contract check pass ≠ it looks right. Two of this session's
worst bugs (no Tailwind, broken blockquote) were invisible to the build. Always
screenshot the **production** preview, not the dev server:

- Build first: `npm run verify` (produces `dist-preview/`).
- Serve it: `python3 -m http.server 8088 --directory dist-preview`.
- Drive it with Playwright — chromium is already cached at
  `~/Library/Caches/ms-playwright/chromium_headless_shell-1217/.../chrome-headless-shell`
  (install `playwright-core` to a temp dir, point `executablePath` at it).
- **Do NOT use Chrome `--virtual-time-budget` for IndexedDB apps** — it
  fast-forwards timers but pauses real async I/O, so init never resolves and you
  screenshot a spinner. Use Playwright with real `waitForSelector` waits.
- Capture light + dark + each view, and a ~390px mobile viewport.

Clean up `dist-preview/` (it's gitignored) when done; keep `dist/<app>.tsx`.

## Tooling

npm workspaces · Vite 5 · React 18 · TypeScript 5 (strict) · Tailwind v4
(`@tailwindcss/vite`, preview only) · Vitest + jsdom + `@testing-library/react`
+ `fake-indexeddb`. Node ≥ 18 (session used v23). Swap to pnpm/bun if preferred.
