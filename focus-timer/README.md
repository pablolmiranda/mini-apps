# Focus Timer

An installable, full-screen **Pomodoro** focus timer. Hero: **install +
standalone** — it's built to live on your home screen and run like a native app.

The whole app is one self-contained file — [`src/focus-timer.tsx`](./src/focus-timer.tsx) —
that imports only `react` and `lucide-react`, styles with Tailwind classes, and
default-exports the component. That file is the artifact you upload to the PWA
Store; the Store adds the manifest + service worker that make it installable and
launchable standalone.

## What the app does (runtime capabilities)

- **Focus / Short break / Long break** cycle (classic 25 / 5 / 15, configurable),
  with a long break every N focus sessions.
- **Accurate, drift-free timing** — counts down against a wall-clock target, so it
  stays correct even when the tab is backgrounded or throttled.
- **Notification on session end** — requests permission and fires a system
  notification when a focus/break completes (works great when installed).
- **Screen Wake Lock** — keeps the screen awake while a session runs (re-acquired
  automatically when you return to the app).
- **Audio chime** at session end (zero-dependency Web Audio).
- **Standalone-aware & safe-area-aware** — adapts to notches/home indicators via
  `env(safe-area-inset-*)` and reflects when it's running installed.
- **Offline** and **persistent** — settings, theme, and progress are saved locally
  (`localStorage`); no network at any point.

> Installability and `display: standalone` themselves come from the **Store's**
> manifest/service-worker wrapper — this file provides the great standalone
> *experience* and the platform integrations above.

## Commands

```bash
# from the repo root, once:
npm install

cd focus-timer
npm run dev        # local preview with HMR
npm run test       # timer logic + transitions + persistence
npm run verify     # typecheck + tests + contract check + preview build
```

`npm run build` / `npm run verify` produce the upload artifact at
[`dist/focus-timer.tsx`](./dist).
