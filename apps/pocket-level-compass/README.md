# Pocket Level & Compass

A full-screen, install-as-PWA pocket instrument: a precision **spirit level**
and a magnetic **compass**, both driven by the device's orientation sensors.
One self-contained `src/pocket-level-compass.tsx` (default export, Tailwind +
`lucide-react` only) per the Store contract.

## What it does

- **Spirit level** — reads `DeviceOrientationEvent` `beta`/`gamma` and floats a
  bubble inside a circular target vial, with per-axis tilt degrees (roll · X,
  pitch · Y) and a **LEVEL** indicator when both axes sit within `±1°`.
- **Compass** — rotates an engraved dial to the live heading using
  `webkitCompassHeading` when present, else the `deviceorientationabsolute` /
  `alpha` channel (converted to clockwise). Shows degrees + an 8-point cardinal
  (N · NE · E …).
- **Enable sensors** — a user-gesture button that calls
  `DeviceOrientationEvent.requestPermission()` on iOS 13+ and starts listening.
- **Graceful fallback** — every sensor API is feature-detected. Desktop/jsdom
  show a clear unsupported notice and a gentle idle demo so the dials stay
  presentable.

## Design

Precision analog instrument: deep navy/graphite bezels, engraved tick rings,
brass/amber accent, technical monospace numerals, subtle blueprint grid.

## Sensor notes & caveats

- **iOS 13+** gates motion behind a permission prompt that must be triggered by
  a real tap — hence the explicit "Enable sensors" button.
- **Desktop browsers** generally expose no orientation data; the app detects
  this and shows the idle demo + unsupported notice.
- Heading accuracy depends on the device magnetometer and calibration; the
  absolute channel is preferred for true magnetic-north readings.

## Develop

```
npm run dev       # Vite preview host (open on a phone for live sensors)
npm run test      # vitest (pure tilt/heading math + render states)
npm run verify    # typecheck + test + contract check + preview build
```

The deliverable is `dist/pocket-level-compass.tsx`. `dist-preview/` is a local
build artifact only.
