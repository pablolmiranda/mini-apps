# Weather at a Glance

At-a-glance **current conditions** for wherever you are. Hero: **geolocation +
an offline cached fallback** — open it and it shows the latest reading for your
location; lose connectivity and it gracefully shows the last reading it saved,
with a clear "Offline" banner.

The whole app is one self-contained file —
[`src/weather-at-a-glance.tsx`](./src/weather-at-a-glance.tsx) — that imports
only `react` and `lucide-react`, styles with Tailwind classes, and
default-exports the component. That file is the artifact you upload to the PWA
Store; the Store adds the manifest + service worker.

## What the app does (runtime capabilities)

- **Geolocation** — feature-detects `navigator.geolocation`, gets your position,
  and fetches current weather from the **keyless, CORS-enabled Open-Meteo API**
  (a runtime `fetch()`, not an import). A reverse-geocode resolves a place name
  when available.
- **At-a-glance readout** — a big temperature, the condition label, feels-like,
  humidity, and wind, with a WMO-code-driven lucide icon.
- **Atmospheric design** — a full-screen background gradient that reflects the
  sky and day/night (clear-day vs clear-night vs rain vs snow vs cloud vs fog vs
  thunder).
- **Offline fallback (hero)** — every successful fetch is cached in
  `localStorage` (conditions + timestamp + coords/place + units). If you're
  offline (`navigator.onLine === false`), or geolocation/fetch fails, the app
  renders the **cached** reading with an "Offline — last updated {relative
  time}" banner. It auto-refreshes when connectivity returns.
- **°C / °F toggle** — persisted; wind switches between km/h and mph to match.
- **Manual refresh** and **mobile-first** layout (`h-[100dvh]` + safe-area
  insets).

> Network note: the only network use is the runtime `fetch()` to Open-Meteo for
> live conditions. With no connection (or denied location) the app is fully
> usable on its last cached reading.

## Commands

```bash
# from the repo root, once:
npm install

cd weather-at-a-glance
npm run dev        # local preview with HMR
npm run test       # WMO mapping, cache/offline fallback, unit conversion
npm run verify     # typecheck + tests + contract check + preview build
```

`npm run build` / `npm run verify` produce the upload artifact at
[`dist/weather-at-a-glance.tsx`](./dist).
