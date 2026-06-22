# Read-It-Later

A reading list that doubles as a **Web Share Target** and works **100% offline**.
Hero feature: share a page into the app, save it for later, read your notes
without a network.

The whole app is one self-contained file — [`src/read-it-later.tsx`](./src/read-it-later.tsx) —
that imports only `react` and `lucide-react`, styles with Tailwind classes, and
default-exports the component. That file is the artifact you upload to the PWA
Store; the Store adds the manifest + service worker.

## Features

- **Web Share Target (GET)**: when the Store's manifest routes a share to the app
  as `?title=&text=&url=`, the app parses `window.location.search` on mount, adds
  the shared link to your list, then cleans the URL with `history.replaceState`
  so a reload won't re-add it. If only free `text` is shared, the first URL in it
  is extracted and the rest is kept as a note.
- **Manual add**: paste a URL (scheme optional) plus an optional title and a
  note/snippet to keep offline.
- **Offline-first**: every item `{id,url,title,note,addedAt,read,archived}` lives
  in IndexedDB (DB `read-it-later`, store `items`). No network at any point.
- **Filters**: Unread / Read / Archived / All, plus search across title/url/note.
- **Actions**: mark read/unread, archive/restore, delete, open link
  (`window.open`), and **Share out** via `navigator.share` (only shown when the
  API exists).
- **Reading modes**: warm sepia light mode and a calm dark mode (toggle persisted
  in `localStorage`). Mobile-first, `100dvh`, safe-area aware.

### Honest "offline reading"

True cross-origin article extraction needs a backend or a CORS proxy, so this app
does what is possible purely on-device: it stores the URL, title and your own
notes/snippet, and remains fully functional with no network. Full article caching
would require Store/backend support.

## Commands

```bash
# from the repo root, once:
npm install

cd read-it-later
npm run dev        # local preview with HMR
npm run test       # share-ingest + IndexedDB CRUD + filters (fake-indexeddb)
npm run verify     # typecheck + tests + contract check + preview build
```

`npm run build` / `npm run verify` produce the upload artifact at
[`dist/read-it-later.tsx`](./dist).

### Store wiring note

The Share Target itself is configured in the **Store's web app manifest**
(`share_target` with `method: "GET"` mapping `title`/`text`/`url` to query
params). This app only consumes those params at runtime.
