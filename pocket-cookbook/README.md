# Pocket Cookbook

Save recipes once, then read them **offline in the kitchen** — with a Cook Mode
that uses **Wake Lock** to keep the screen awake while you're cooking. Hero:
offline + Wake Lock.

The whole app is one self-contained file — [`src/pocket-cookbook.tsx`](./src/pocket-cookbook.tsx) —
that imports only `react` and `lucide-react`, styles with Tailwind classes, and
default-exports the component. Upload that file to the PWA Store; the Store adds
the manifest + service worker.

## What the app does

- **Offline recipe library** — recipes live in a hand-rolled IndexedDB store, so
  everything works with no network. Seeds a couple of sample recipes on first run.
- **Add / edit recipes** — title, description, servings, time, ingredients and
  steps (one per line), tags, and a photo (captured/picked and downscaled with a
  canvas before storing).
- **Cook Mode** — a big, readable reading view with checkable ingredients and
  numbered steps; **Wake Lock** keeps the screen awake while it's open (re-acquired
  when you return to the app). Toggle it off any time.
- **Search**, delete (with confirm), and a light/dark theme (persisted).

## Commands

```bash
# from the repo root, once:
npm install

cd pocket-cookbook
npm run dev        # local preview with HMR
npm run test       # recipe CRUD + persistence + cook-view interactions
npm run verify     # typecheck + tests + contract check + preview build
```

`npm run build` / `npm run verify` produce the upload artifact at
[`dist/pocket-cookbook.tsx`](./dist).
