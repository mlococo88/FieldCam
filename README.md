# Field Cam

Field inspection app: photos with a GPS/date/weather overlay, sketches, notes,
Note Pad pages and PDF plan markup, with PDF/ZIP/CSV reports. Data is stored in
Firebase (anonymous sign-in).

The app is the single file `index.html`; libraries load from CDNs.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The whole app |
| `sw.js` | Service worker: caches the page and its libraries so the app starts offline |
| `manifest.webmanifest`, `icon*.{svg,png}` | Home-screen install |
| `firestore.rules`, `storage.rules` | **Draft** security rules, not deployed (see the comments in each file) |
| `tests/smoke.mjs` | Smoke test that opens every tool and fails on any JS error |

## Testing

```sh
npm install
npx playwright install chromium
npm test
```

The test runs against a stub of Firebase (`tests/firebase-stub.js`), so it never
touches real data. GitHub Actions runs it on every push (`.github/workflows/smoke.yml`).

## Offline

After the first visit over HTTPS, the service worker serves the app and its
libraries from cache. Captures made offline go to the in-app outbox
(IndexedDB) and sync when the connection returns. Firestore keeps a local
cache, so the log is still visible offline.

## Deploying the rules

Review `firestore.rules` and `storage.rules`, then paste them into the Firebase
console (Firestore → Rules, Storage → Rules), or run
`firebase deploy --only firestore:rules,storage`. Afterwards, test one photo
upload, one note and one plan upload.
