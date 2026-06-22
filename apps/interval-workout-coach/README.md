# Interval Workout Coach

An installable, full-screen **HIIT interval timer**. Hero: **install +
vibration + wake lock** — built to live on your home screen and coach you
through a workout hands-free, with the screen kept awake and haptic cues on
every transition.

The whole app is one self-contained file —
[`src/interval-workout-coach.tsx`](./src/interval-workout-coach.tsx) — that
imports only `react` and `lucide-react`, styles with Tailwind classes, and
default-exports the component. That file is the artifact you upload to the PWA
Store; the Store adds the manifest + service worker that make it installable and
launchable standalone.

## What the app does (runtime capabilities)

- **Configurable HIIT sequence** — prepare, work, rest, rounds, and optional
  multiple sets/cycles with a longer **set break** between them. Auto-advances
  through the whole timeline: `PREPARE → (WORK → REST) × rounds → SET BREAK → …`.
- **Big phase display** — `PREPARE / WORK / REST / SET BREAK / DONE` with a
  dual phase-color scheme (amber prepare, hot magenta work, cyan rest), heavy
  bold numerals, current round X of N, and the active set.
- **Accurate, drift-free timing** — every phase counts down against a wall-clock
  target, so it stays correct even when the tab is backgrounded or throttled.
- **Audio cues** (zero-dependency Web Audio) — a tick on the last 3 seconds of
  each phase and a distinct tone on every phase change (a bright "GO" into work,
  a soft tone into rest, a fanfare on finish).
- **Vibration cues** (`navigator.vibrate`) — a short buzz into REST, a stronger
  double buzz into WORK, light ticks on the final countdown.
- **Screen Wake Lock** — keeps the screen awake while running, re-acquired
  automatically when you return to the app.
- **Controls** — start/pause, reset, skip; Space toggles start/pause.
- **Offline** and **persistent** — settings are saved locally (`localStorage`);
  no network at any point. Audio / vibration / Wake Lock are feature-detected and
  degrade gracefully where unsupported (e.g. desktop, jsdom).

## Commands

```bash
# from the repo root, once:
npm install

cd interval-workout-coach
npm run dev        # local preview with HMR
npm run test       # sequence transitions + round counting + persistence
npm run verify     # typecheck + tests + contract check + preview build
```

`npm run build` / `npm run verify` produce the upload artifact at
[`dist/interval-workout-coach.tsx`](./dist).
