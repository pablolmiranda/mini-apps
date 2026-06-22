# HIIT Timer

Build, save, and run High-Intensity Interval Training workouts — **offline-first**
and **100% client-side** (no backend, no network). Configure a set of exercises
with durations, a global rest, and how many times the set repeats; then run it in
an immersive fullscreen player.

The whole app is one self-contained file — [`src/hiit-timer.tsx`](./src/hiit-timer.tsx) —
that imports only `react` and `lucide-react`, styles with Tailwind classes, and
default-exports the component. Upload that file to the PWA Store; the Store adds
the manifest + service worker (PWA packaging is intentionally out of scope here).

## What the app does

- **Session builder** — name a session; add/name exercises with durations;
  reorder and remove them; set how many times the whole set repeats; set one
  global rest applied before each exercise.
- **Session management** — saved sessions are listed in IndexedDB; each can be
  **edited**, **started**, or **deleted**.
- **Immersive player** — requests Fullscreen (CSS fallback where blocked) and a
  screen **Wake Lock**; 10-second lead-in countdown; shows the current exercise
  with a **"Set X · Exercise Y of T"** indicator and a large countdown; automatic
  exercise → rest → next progression across all set repetitions (with a rest
  between sets); **pause/resume** and **Exit** always available; a big **"DONE"**
  on completion with a back arrow to the list.
- **Drift-free timing** — countdowns run off wall-clock timestamps, so they stay
  accurate even when the tab is backgrounded; the wake lock is released when
  hidden/paused and re-acquired on resume.

## Commands

```bash
# from the repo root, once:
npm install

cd hiit-timer
npm run dev        # local preview with HMR
npm run test       # CRUD + persistence + full player phase progression
npm run verify     # typecheck + tests + contract check + preview build
```

`npm run build` / `npm run verify` produce the upload artifact at
[`dist/hiit-timer.tsx`](./dist).
