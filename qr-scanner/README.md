# QR / Barcode Scanner

Point your camera at a QR code or barcode and it's decoded instantly, then kept
in a searchable scan history. Hero: **device API (camera)**.

The whole app is one self-contained file — [`src/qr-scanner.tsx`](./src/qr-scanner.tsx) —
that imports only `react` and `lucide-react`, styles with Tailwind classes, and
default-exports the component. Upload that file to the PWA Store; the Store adds
the manifest + service worker.

## What the app does (runtime capabilities)

- **Live camera viewfinder** via `getUserMedia` (`facingMode: environment`), with
  a HUD scan frame and animated scan line.
- **Decoding** via the native **`BarcodeDetector`** API — QR plus many 1D/2D
  barcode formats, no libraries.
- **Scan history** persisted locally (`localStorage`): copy, open links, delete,
  clear all. Continuous re-scans of the same code are de-duplicated.
- **Torch / flashlight** toggle (when the camera track supports it) and
  **front/back camera** switch.
- **Haptic feedback** (`navigator.vibrate`) on a successful scan.
- **Graceful degradation**: clear states for permission denied, no camera, and
  browsers without `BarcodeDetector` (e.g. Safari) — the hero device APIs are
  feature-detected, never assumed.

> `BarcodeDetector` support varies by browser/OS (great on Android/Chrome OS and
> Chrome on macOS; absent on Safari/iOS today). The app detects this and tells
> the user instead of silently failing.

## Commands

```bash
# from the repo root, once:
npm install

cd qr-scanner
npm run dev        # local preview with HMR (camera needs https or localhost)
npm run test       # unsupported/permission states + history persistence
npm run verify     # typecheck + tests + contract check + preview build
```

`npm run build` / `npm run verify` produce the upload artifact at
[`dist/qr-scanner.tsx`](./dist).
