# mini-apps

A monorepo of small, self-contained web apps ("mini-apps"). Each mini-app builds
to a **single `.tsx` file** that our **PWA Store** ingests — the Store adds the
PWA layer (web app manifest + service worker) on top. The deliverable is the same
shape the Claude web interface produces: a default-exported React component using
Tailwind utility classes and `lucide-react` icons.

## Apps

All apps live under [`apps/`](./apps).

| App | Folder | Description |
| --- | --- | --- |
| Markdown Scratchpad | [`apps/markdown-scratchpad`](./apps/markdown-scratchpad) | Fast notes editor, 100% offline via IndexedDB, autosave. Hero: offline/caching. |
| Focus Timer | [`apps/focus-timer`](./apps/focus-timer) | Installable Pomodoro timer with notifications and screen Wake Lock. Hero: install + standalone. |
| QR / Barcode Scanner | [`apps/qr-scanner`](./apps/qr-scanner) | Camera scanner using the BarcodeDetector API, with a saved scan history. Hero: device API (camera). |
| Pocket Cookbook | [`apps/pocket-cookbook`](./apps/pocket-cookbook) | Offline recipe book with a Cook Mode that holds a screen Wake Lock. Hero: offline + Wake Lock. |
| Geo Field Journal | [`apps/geo-field-journal`](./apps/geo-field-journal) | Geotagged photo notes (GPS + camera), stored offline, on an offline map. Hero: GPS + camera + offline. |
| Pocket Level & Compass | [`apps/pocket-level-compass`](./apps/pocket-level-compass) | Spirit level + compass from DeviceOrientation sensors. Hero: motion/orientation sensors. |
| Offline Expense Tracker | [`apps/offline-expense-tracker`](./apps/offline-expense-tracker) | Log expenses offline; Background Sync flushes when back online. Hero: background sync. |
| Read-It-Later | [`apps/read-it-later`](./apps/read-it-later) | Web Share Target reading list, cached for offline. Hero: Web Share Target + offline. |
| Interval Workout Coach | [`apps/interval-workout-coach`](./apps/interval-workout-coach) | HIIT timer with audio cues, vibration, and Wake Lock. Hero: install + vibration + wake lock. |
| Soundboard / Sampler | [`apps/soundboard-sampler`](./apps/soundboard-sampler) | Web Audio pads with synthesized voices, instant and offline. Hero: install + offline audio. |
| Weather-at-a-Glance | [`apps/weather-at-a-glance`](./apps/weather-at-a-glance) | Geolocation conditions with a cached offline fallback. Hero: geolocation + offline fallback. |
| HIIT Timer | [`apps/hiit-timer`](./apps/hiit-timer) | Build and run interval workouts in a fullscreen player + Wake Lock. Hero: offline + fullscreen. |
| Metronome | [`apps/metronome`](./apps/metronome) | Metronome with workouts, an incremental trainer, and per-day practice tracking. Hero: offline + precise Web Audio. |

## The Store contract

Each deliverable `.tsx` must:

- import **only** from `react` and `lucide-react` (no other packages),
- have **no relative imports** (it is one self-contained file),
- **`export default`** the component,
- use Tailwind utility classes for styling.

`scripts/check-contract.mjs` enforces this and gates every app's build. The
allowed-import list lives at the top of that script (single source of truth).

```bash
node scripts/check-contract.mjs apps/markdown-scratchpad/src/markdown-scratchpad.tsx
```

You can also build/verify/test every app at once from the repo root:

```bash
npm run build      # typecheck + tests + contract check, all apps
npm run verify     # the above + each app's preview production build
```

## Working on an app

```bash
npm install                       # once, at the repo root (npm workspaces)
cd apps/markdown-scratchpad
npm run dev        # local preview with HMR — see it work in the browser
npm run test       # offline/autosave behavior (fake-indexeddb, no browser)
npm run verify     # typecheck + tests + contract check + preview build
```

`npm run verify` (or `npm run build`) produces the upload artifact at
`apps/<app>/dist/<app>.tsx`. Upload that file to the PWA Store.

## Adding a new mini-app

Copy `apps/markdown-scratchpad/` as a template:

1. Create `apps/<your-app>/` with the same structure
   (`src/<your-app>.tsx`, `preview/`, `test/`, `package.json`, `tsconfig.json`,
   `vite.config.ts`). Any folder under `apps/` is auto-included by the root
   `workspaces: ["apps/*"]` glob — no manual registration needed.
2. Point the app's `tsconfig.json` at `../../tsconfig.base.json` and its `check`
   script at `../../scripts/check-contract.mjs`.
3. Author the app as a single `src/<your-app>.tsx` (default export; only
   `react` + `lucide-react`; Tailwind classes).
4. `npm install` at the root, then `npm run verify` in the app folder.

The harness files (`preview/`, `vite.config.ts`, tests) are dev-only — they never
become part of the deliverable `.tsx`.
# mini-apps
