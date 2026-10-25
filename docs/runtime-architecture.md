# Runtime Architecture

## Active entrypoints

These are the only runtime entrypoints that matter now:

- `electron-main.cjs`: authoritative Electron main process entry.
- `preload.js`: authoritative Electron preload bridge.
- `src/platform/web/index-boot.js`: dashboard web bootstrap.
- `src/platform/web/study-boot.js`: study page bootstrap.
- `src/platform/web/auth0-boot.js`: Auth0 web client bootstrap.
- `src/platform/web/auth-page-boot.js`: auth placeholder page bootstrap.

`main.js` is now a legacy shim that delegates straight to `electron-main.cjs`. It exists only so old entry commands do not explode.

## Page ownership

### `index.html`

- Loads `src/platform/web/index-boot.js`
- Does not load page controllers directly anymore

`index-boot.js` owns:
- Auth0 web bootstrapping
- theme initialisation
- analytics bootstrap
- analytics compatibility globals
- dashboard application bootstrap

The dashboard bootstrap imports the following modules, then explicitly awaits dashboard initialisation:
- `js/pages/bridge.js`
- `js/core/keyboard.js`
- `js/pages/dashboard.js`
- `js/pages/exam-mode-ui.js`

### `study.html`

- Loads `src/platform/web/study-boot.js`
- Study runtime still uses `js/pages/study.js`, but only through the bootstrap module

### `auth.html`

- Loads `src/platform/web/auth-page-boot.js`
- Remains a placeholder page for Electron-driven auth flow

## Runtime contracts

### App runtime

`src/app/runtime/app-runtime.js` is now the canonical shared runtime assembly for:

- platform services
- auth session helpers
- DB helpers
- AI helpers
- FSRS helpers
- mode adapters
- compatibility data exposed through `window.lagiote`

### Platform services

`src/platform/shared/platform-services.js` provides the client-facing runtime contract:

- `platformServices.runtime`
- `platformServices.auth`
- `platformServices.storage`
- `platformServices.ai`
- `platformServices.sync`
- `platformServices.shell`

New feature code should depend on this contract, not rummage around `window`.

## Legacy compatibility shims still present

These remain temporary:

- `src/legacy/compat-globals.js`
- `window.lagiote`
- `window.generateDeckAdapter`
- DB global getters exposed by `js/pages/bridge.js`
- the large set of inline-handler globals exposed by `js/pages/dashboard.js`

### Current owners

- `src/platform/web/index-boot.js` owns `compat-globals`
- `js/pages/bridge.js` owns `window.lagiote` and DB global getters
- `js/pages/dashboard.js` owns inline handler globals during the migration

### Removal conditions

- Remove `compat-globals` when `index.html` no longer depends on legacy analytics/CDN globals.
- Remove `window.lagiote` once dashboard and exam UI consume the app runtime directly.
- Remove DB global getters once no page or test reaches DB methods through `window`.
- Remove inline handler globals when `index.html` no longer uses inline event attributes.

## Vendor dependencies

PDF.js, Mammoth, Chart.js and Sortable are npm dependencies imported by the dashboard module. PDF.js uses a bundled local worker. The previous vendored files in `assets/js` and the startup CDN scripts have been removed. FSRS uses the bundled `ts-fsrs` engine on both platforms and in tests.

The standalone study bootstrap explicitly calls its controller after importing it. Neither page depends on receiving `load` or `DOMContentLoaded` after a dynamic import.
