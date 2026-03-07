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

- Loads vendor browser assets still required by the legacy dashboard:
  - `assets/js/pdf.min.js`
  - `assets/js/mammoth.browser.min.js`
  - `assets/js/chart.js`
- Loads `src/platform/web/index-boot.js`
- Does not load page controllers directly anymore

`index-boot.js` owns:
- Auth0 web bootstrapping
- theme initialisation
- analytics bootstrap
- CDN dependency loading for legacy dashboard behaviour
- dashboard application bootstrap

The dashboard bootstrap then imports:
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

## `assets/js` audit

Retained:

- `chart.js`
- `mammoth.browser.min.js`
- `pdf.min.js`

Removed as dead first-party files:

- `auth0-auth.js`
- `card-editor.js`
- `db.js`
- `main.js`
- `prm.js`
- `sequence-test.js`
- `state.js`
- `study.js`
- `ui.js`
- `utils.js`

If someone reintroduces first-party runtime code into `assets/js`, they are rebuilding the mess on purpose.
