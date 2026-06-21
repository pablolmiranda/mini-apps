# mini-apps

A monorepo of small, self-contained web apps ("mini-apps"). Each mini-app builds
to a **single `.tsx` file** that our **PWA Store** ingests — the Store adds the
PWA layer (web app manifest + service worker) on top. The deliverable is the same
shape the Claude web interface produces: a default-exported React component using
Tailwind utility classes and `lucide-react` icons.

## Apps

| App | Folder | Description |
| --- | --- | --- |
| Markdown Scratchpad | [`markdown-scratchpad/`](./markdown-scratchpad) | Fast notes editor, 100% offline via IndexedDB, autosave. Hero: offline/caching. |
| Focus Timer | [`focus-timer/`](./focus-timer) | Installable Pomodoro timer with notifications and screen Wake Lock. Hero: install + standalone. |
| QR / Barcode Scanner | [`qr-scanner/`](./qr-scanner) | Camera scanner using the BarcodeDetector API, with a saved scan history. Hero: device API (camera). |

## The Store contract

Each deliverable `.tsx` must:

- import **only** from `react` and `lucide-react` (no other packages),
- have **no relative imports** (it is one self-contained file),
- **`export default`** the component,
- use Tailwind utility classes for styling.

`scripts/check-contract.mjs` enforces this and gates every app's build. The
allowed-import list lives at the top of that script (single source of truth).

```bash
node scripts/check-contract.mjs markdown-scratchpad/src/markdown-scratchpad.tsx
```

## Working on an app

```bash
npm install                       # once, at the repo root (npm workspaces)
cd markdown-scratchpad
npm run dev        # local preview with HMR — see it work in the browser
npm run test       # offline/autosave behavior (fake-indexeddb, no browser)
npm run verify     # typecheck + tests + contract check + preview build
```

`npm run verify` (or `npm run build`) produces the upload artifact at
`<app>/dist/<app>.tsx`. Upload that file to the PWA Store.

## Adding a new mini-app

Copy `markdown-scratchpad/` as a template:

1. Create `mini-apps/<your-app>/` with the same structure
   (`src/<your-app>.tsx`, `preview/`, `test/`, `package.json`, `tsconfig.json`,
   `vite.config.ts`).
2. Add the folder to the `workspaces` array in the root `package.json`.
3. Author the app as a single `src/<your-app>.tsx` (default export; only
   `react` + `lucide-react`; Tailwind classes).
4. `npm install` at the root, then `npm run verify` in the app folder.

The harness files (`preview/`, `vite.config.ts`, tests) are dev-only — they never
become part of the deliverable `.tsx`.
# mini-apps
