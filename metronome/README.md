# Metronome

A practice-focused, **offline-first** metronome. Beyond a basic click it has
saved **workouts**, an **incremental tempo trainer**, and **per-day practice
tracking** that's always visible. One self-contained file —
[`src/metronome.tsx`](./src/metronome.tsx) — importing only `react` and
`lucide-react`; upload it to the PWA Store, which adds the manifest + service
worker.

## Modes (switch from the top-left menu)

- **Metronome** — set speed (slider, ±, **tap tempo**, tempo marking), time
  signature (numerator/denominator presets, accent on beat 1), subdivision, and
  an optional exercise duration (time or bars). A pendulum + beat dots stay
  locked to the click.
- **Workout** — build and save sequences of exercises (each with its own
  speed / time signature / subdivision / duration) plus a rest between them, then
  run the plan with automatic progression.
- **Incremental Trainer** — set a start BPM, increment, interval, and target;
  the tempo steps up over time until it reaches the target.

## Practice tracking

Every time the metronome runs, today's practice time accumulates (per-day) and is
shown live in the top-right pill; it stops when you stop. History is kept locally.

## Timing

Clicks are scheduled on the Web Audio clock with a lookahead scheduler, so the
tempo never drifts and the pendulum stays in sync. The screen Wake Lock is held
while playing.

## Commands

```bash
# from the repo root, once:
npm install

cd metronome
npm run dev        # local preview with HMR
npm run test       # helpers, workout CRUD, practice tracking, engine/segments
npm run verify     # typecheck + tests + contract check + preview build
```

`npm run build` / `npm run verify` produce the upload artifact at
[`dist/metronome.tsx`](./dist).
