# Geo Field Journal

An offline-first journal of geotagged photo notes. Capture a photo, read your GPS
position, add a title + note, and browse your survey log — all on-device, no
network.

Hero device APIs: **camera** (file capture, downscaled on a canvas) + **GPS**
(`navigator.geolocation`) + **offline storage** (hand-rolled IndexedDB).

## Deliverable

`src/geo-field-journal.tsx` — a single, self-contained React component
(`export default`), importing only `react` + `lucide-react`, styled with
Tailwind utility classes plus one scoped `<style>` block. Builds to
`dist/geo-field-journal.tsx` for the PWA Store.

## Features

- **New entry** — capture a photo via `<input type="file" accept="image/*"
  capture="environment">`, read with `FileReader`, and downscale to ~1280px on
  the longest edge through a `<canvas>` (falls back to the raw dataURL where
  canvas isn't available). GPS is read with
  `getCurrentPosition({ enableHighAccuracy: true })`.
- **Graceful degradation** — every device API is feature-detected. When GPS is
  denied / unavailable / unsupported (e.g. desktop, jsdom), the composer shows
  clear permission states and a **manual coordinate** fallback.
- **Library** — list of entries with photo thumb, title, note, monospace
  lat/lng, and relative time.
- **Entry detail** — full photo, note, coordinate card (lat/lng/accuracy).
- **Offline SVG map** — no external tiles or map libraries (forbidden by the
  contract and would break offline). Pins are auto-fit to the bounding box of
  all entries' coordinates and normalized into an SVG `viewBox` over a faint
  coordinate grid; latitude is flipped so north is up. Pins (and a legend list)
  are selectable to open the entry.

## Design

"Field survey / topographic": dark slate/charcoal, amber/orange accent,
monospace coordinates, a faint topo-grid texture. Mobile-first (~390px), scales
up with `md:`. Full-screen via `h-[100dvh]` + `env(safe-area-inset-*)`.

## Scripts

- `npm run dev` — Vite preview host with HMR.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run test` — Vitest (jsdom + `fake-indexeddb`).
- `npm run check` — Store-contract gate.
- `npm run build` — typecheck + test + check, then copy `src → dist`.
- `npm run verify` — `build` + a preview `vite build` smoke test.

Run inside this folder; dependencies resolve from the repo root `node_modules`.
