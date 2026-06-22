# Markdown Scratchpad

A fast notes editor that works **100% offline** via IndexedDB, with autosave.
Hero feature: offline / caching.

The whole app is one self-contained file — [`src/markdown-scratchpad.tsx`](./src/markdown-scratchpad.tsx) —
that imports only `react` and `lucide-react`, styles with Tailwind classes, and
default-exports the component. That file is the artifact you upload to the PWA
Store; the Store adds the manifest + service worker.

## Features

- **Offline-first**: all data lives in IndexedDB (DB `markdown-scratchpad`, store
  `notes`). No network needed at any point.
- **Autosave**: edits are debounced and written to IndexedDB; a status indicator
  shows `Saving…` → `Saved`. Pending edits also flush on tab hide / unload.
- Notes sidebar: create, select, delete; titles derive from the first line.
- **Markdown preview**: toggle edit / preview. Rendering uses a small inlined,
  zero-dependency markdown→HTML converter that HTML-escapes input first (no
  `marked` / `react-markdown`, no XSS).

## Commands

```bash
# from the repo root, once:
npm install

cd markdown-scratchpad
npm run dev        # local preview with HMR
npm run test       # offline/autosave behavior (fake-indexeddb)
npm run verify     # typecheck + tests + contract check + preview build
```

`npm run build` / `npm run verify` produce the upload artifact at
[`dist/markdown-scratchpad.tsx`](./dist).

### Verifying offline manually

1. `npm run dev`, open the preview, create and edit notes.
2. Reload — notes persist (IndexedDB).
3. In DevTools → Network, set **Offline**, reload — the app still loads and your
   notes are intact.
