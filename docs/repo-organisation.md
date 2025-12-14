## Root Inventory (pre-reorg)

| File | Type | Referenced? | Notes/Action |
| --- | --- | --- | --- |
| README.md | Doc | Yes | Keep at root for project overview |
| LICENSE | License | Yes | Linked from README |
| package.json | Config/runtime entry | Yes | Electron `main` points to `electron-main.cjs` |
| package-lock.json | Lockfile | Yes | Used by npm |
| netlify.toml | Deploy config | Yes | Netlify expects it at repo root |
| vite.config.js | Build config | Yes | Multi-page entry config for Vite |
| forge.config.js | Packaging config | Yes | Consumed by electron-forge |
| electron-main.cjs | Electron entry | Yes | Loaded via `package.json#main` and `npm start` |
| main.js | Electron entry (legacy) | Implicit | Left at root to avoid changing shell wiring |
| menu.js | Electron menu stub | Implicit | Unreferenced currently; kept alongside Electron files |
| preload.js | Electron preload | Yes | Loaded by Electron main process |
| preload-auth.js | Electron preload (auth) | No | Not currently wired; left in place |
| index.html | Web entry | Yes | Vite/Electron renderer entry |
| study.html | Web entry | Yes | Vite multi-page entry |
| auth.html | Web entry | Yes | Auth flow entry |
| CODE_OF_CONDUCT.md | Doc | No | Standard community doc kept at root |
| CONTRIBUTING.md | Doc | No | Standard contributor doc kept at root |
| AGENTS.md | Doc | No | Local agent instructions; kept at root |
| AUTO_UPDATE_GUIDE.md | Doc | No | Moved to `docs/` |
| BUGS_FIXED.md | Doc | No | Moved to `docs/` |
| GEMINI.md | Doc | No | Moved to `docs/` |
| List of Bugs.md | Doc | No | Moved to `docs/` |
| Lagiote-Redesign.pdf | Design asset | No | Moved to `design/` |
| Lagiote-Redesign.png | Design asset | No | Moved to `design/` |
| check-syntax.js | Tool script | No | Moved to `scripts/` |
| check-pattern-syntax.js | Tool script | No | Moved to `scripts/` |
| run-electron.bat | Windows helper | No | Moved to `scripts/windows/` |
| setup-run.bat | Windows helper | No | Moved to `scripts/windows/` |
| .env.local | Env config | Yes | Tracked; should live locally and stay untracked |
| .gitignore / .gitattributes | Repo hygiene | Yes | Git metadata |
| .DS_Store | OS artifact | No | Removed from root |

## What moved

- Design artefacts relocated to `design/` for mockups and screenshots.
- Project docs that are not core community files moved into `docs/`.
- Helper scripts collected under `scripts/` with Windows-specific batch files under `scripts/windows/`.

## Deferred/kept in place

- Electron entry/preload files remain at the root to avoid touching runtime wiring (`electron-main.cjs`, `main.js`, `menu.js`, `preload.js`, `preload-auth.js`).
- Build/deploy configs stay at root where tooling expects them (`vite.config.js`, `netlify.toml`, `forge.config.js`).
- HTML entrypoints remain at root per Vite multi-page config and Electron fallbacks.
- `.env.local` stays in the working tree for now; untrack it with `git rm --cached .env.local` when Git metadata writes are permitted.

## Adding new assets without clutter

- Put design files (mockups, PDFs, PNG/JPG) in `design/`.
- Place documentation in `docs/` unless it is a canonical community file (README, LICENSE, CONTRIBUTING, CODE_OF_CONDUCT).
- Drop helper scripts into `scripts/`, using `scripts/windows/` for `.bat` helpers.
- Keep root reserved for build configs, package manifests, Electron entrypoints, and Vite HTML entry files only.
