# Soundboard / Sampler

An installable, **fully offline** soundboard / sampler. Hero: **install + offline
audio** — the "samples" load instantly because there are no files to load. Every
sound is **synthesized in Web Audio** (oscillators + noise buffers + gain
envelopes), so the whole instrument is a single self-contained file that works
the moment it opens, with no network and nothing to cache.

The deliverable is one file — [`src/soundboard-sampler.tsx`](./src/soundboard-sampler.tsx) —
that imports only `react` and `lucide-react`, styles with Tailwind classes plus a
scoped `<style>` block, and default-exports the component. That file is the
artifact you upload to the PWA Store; the Store adds the manifest + service worker
that make it installable and launchable standalone.

## What the app does

- **Grid of large neon pads** — mobile-first, two columns on phones (four on
  larger screens), big satisfying touch targets, each pad its own hue with a
  glossy MPC-console look and an **active glow on every hit**.
- **Three kits** — **Drums** (kick, snare, clap, rim, closed/open hats, two toms),
  **Tones** (sub-bass, filtered plucks, soft triangle keys), and **FX** (zap,
  riser, drop, blip, noise sweep, chord stab, LFO wobble, bell ping). Switch kits
  from the selector; the choice persists.
- **Keyboard play** — each pad is bound to a key (`1 2 3 4 / q w e r`) so you can
  finger-drum from a laptop too.
- **Master volume + mute** — a single master gain feeds the speakers; the value
  persists across launches.
- **Lazy, gesture-unlocked audio** — the `AudioContext` is created on the first
  pad press and resumed, exactly as mobile browsers require. The header shows
  `TAP TO ARM → LIVE`.
- **Graceful fallback** — Web Audio is feature-detected; if it's unavailable the
  pads still flash and the UI stays fully usable (the header reads `NO AUDIO`).
- **Offline & self-contained** — no network at any point; nothing to download.

### Why synthesized, not sampled files?

A single `.tsx` can't bundle audio assets, so shipping real sample files would
break the one-file Store contract (or require network fetches, killing the
offline story). Synthesizing the voices is the honest way to deliver "cached
samples load instantly offline": there is literally nothing to fetch.

## Commands

```bash
# from the repo root, once:
npm install

cd soundboard-sampler
npm run dev        # local preview with HMR
npm run test       # pad/kit config, keyboard mapping, volume, no-audio safety
npm run verify     # typecheck + tests + contract check + preview build
```

`npm run build` / `npm run verify` produce the upload artifact at
[`dist/soundboard-sampler.tsx`](./dist).
