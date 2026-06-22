# Offline Expense Tracker

Log expenses **fully offline**; they queue locally in IndexedDB and flush when
you're back online. Hero feature: **Background Sync**.

The whole app is one self-contained file —
[`src/offline-expense-tracker.tsx`](./src/offline-expense-tracker.tsx) — that
imports only `react` and `lucide-react`, styles with Tailwind classes, and
default-exports the component. That file is the artifact you upload to the PWA
Store; the Store adds the manifest + service worker.

## Features

- **Offline-first**: every expense is written to IndexedDB (DB
  `offline-expense-tracker`, store `expenses`) before anything else. No network
  is needed to log an expense. Expense shape:
  `{ id, amount, category, note, ts, synced }`.
- **Background Sync (hero)**: on add, the app queues the expense locally and —
  when `SyncManager` is supported — registers a background sync via
  `navigator.serviceWorker.ready.then(reg => reg.sync.register('flush-expenses'))`.
  This is fully feature-detected and wrapped in `try/catch`; there may be no
  service worker in the preview, which is fine.
- **Foreground flush fallback**: online/offline is tracked via `navigator.onLine`
  plus the window `online`/`offline` events. When online, pending expenses are
  flushed — since there's no real backend here, the upload is **simulated**
  (mark pending → synced after a brief delay; a real POST is attempted when
  `fetch` is available). If the device goes offline mid-flush, the remaining
  rows stay pending.
- **Clear status**: an Online / Offline / Syncing pill, counts of pending vs
  synced, a per-item sync badge, and a "Sync now" button.
- **Totals**: a big running total plus a per-category breakdown with percentages.
- **Mobile-first**: `h-[100dvh]` with safe-area insets, a keypad-friendly amount
  field, a horizontally scrolling category picker, and a docked add-expense form.

## Commands

```bash
# from the repo root, once:
npm install

cd offline-expense-tracker
npm run dev        # local preview with HMR
npm run test       # offline / sync behavior (fake-indexeddb)
npm run verify     # typecheck + tests + contract check + preview build
```

`npm run build` / `npm run verify` produce the upload artifact at
[`dist/offline-expense-tracker.tsx`](./dist).

## Note on real cross-device sync

This app registers a Background Sync and provides a foreground flush fallback,
but true cross-device sync requires the **Store's service worker** to handle the
`sync` event named `flush-expenses` and POST the queued rows to a **server
endpoint**. Here the upload is simulated locally.

### Verifying offline manually

1. `npm run dev`, add a few expenses.
2. In DevTools → Network, set **Offline** — new expenses show a **Pending** badge
   and the status pill reads **Offline**.
3. Switch back **Online** — pending rows flip to **Synced** automatically.
4. Reload — every expense persists (IndexedDB).
