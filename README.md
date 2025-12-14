# Lagiote Revise

Lagiote Revise is an **offline-first flashcard + study system** that runs as:
- a **desktop app** (Electron), and
- a **web app** (static site + serverless functions)

It mixes “classic” spaced repetition (FSRS) with a more opinionated “Learn mode” engine (“Cortex”) that scores what to show next using **expected retention gain per unit time**, plus session/user signals.

If you want a toy app, this repo is not that. If you want an app that tries to take learning seriously while still working on a train with no signal, welcome.

---

## Table of contents

- Core goals
- What you get
- How it works
  - Runtime variants: Web vs Electron
  - Data model & persistence
  - Scheduling & scoring
  - Study modes
  - AI generation pipeline
  - Authentication
  - Sync
  - Analytics & telemetry
  - Auto-updates (Electron)
- Project structure (coming soon)
- Build & run
  - Desktop (Electron)
  - Web
- Environment variables
- Security & privacy notes
- Debugging
- Licence

---

## Core goals

1. Offline-first: the app is usable without internet; online only unlocks AI/sync.
2. Low-friction studying: minimal setup to get into a study session.
3. Better-than-Leitner scheduling: FSRS plus a learn system that can prioritise by exam date and expected gain.
4. Same app, two shells: Electron and web share behaviour; only backend bridges differ.

---

## What you get

### Deck types
- Flashcard decks (Q → A)
- Sequence decks (ordered steps)
- Vocab decks (language-biased question selection)

### Study question types
- Type (free response with typing metrics)
- Multiple choice (optionally AI-generated distractors)
- Cloze
- Plain flashcard reveal

### Storage
- Decks and learning state stored locally in IndexedDB.
- All study interactions stored as interaction logs.

### AI (optional)
- Deck generation from documents or text
- Distractor generation
- Autocomplete helpers

---

## How it works

### Runtime variants: Web vs Electron

Web and Electron share the UI but differ in backend plumbing.

Web:
- AI via serverless functions
- Auth via Auth0 SPA redirect
- No auto-update

Electron:
- AI via IPC to main process
- Auth via dedicated login window and local callback server
- Auto-updates via electron-updater

Electron exposes a constrained API to the renderer via contextBridge.

---

## Data model & persistence

IndexedDB with migration-tolerant schema.

### Stores
- decks
- userKnowledgeState
- interactionLogs
- appData
- analyticsQueue
- examPlans
- concepts

### Knowledge state (conceptual)
Each record includes:
- identity fields
- serialised FSRS state
- derived scheduling fields
- Cortex inference metadata
- lightweight recall history

Numeric fields and timestamps are normalised defensively.

---

## Scheduling & scoring

### FSRS
Used for:
- stability and difficulty
- retrievability estimation
- rating transitions

Uses ts-fsrs with per-card serialised state.

### Cortex
Wraps FSRS with:
- inference from interaction signals
- expected retention gain computation
- time cost estimation
- optional neural gating

Expected gain is computed by simulating FSRS transitions and measuring improvement at a target horizon (often exam date).

Typing behaviour, latency, corrections, and hesitation feed into inference.

---

## Study modes

### Learn mode
- Builds an active learning pool
- Filters mastered/safe cards
- Sorts by projected retention
- Respects exam date and limits
- Biases question types by deck context

### Review mode
- Spaced repetition focus
- Retry loop for incorrect cards

### Practice test / Exam mode
- Stricter correctness
- Heavier weighting on typed answers

### Sequence mode
- Ordered-step decks
- Reordering and recall-based practice

---

## AI generation pipeline

Optional and online-only.

### Input sources
- Uploaded documents
- Pasted text

### Payload schema (conceptual)
{
  documents: [...],
  cardType: auto | flashcard | sequence | vocab,
  cardCount: auto | number,
  language: auto | language label
}

### Output normalisation
The UI:
- accepts messy model output
- normalises legacy array responses
- supports cards or sequences
- preserves metadata when present

### Where it runs
Web:
- Netlify serverless function returns JSON

Electron:
- Renderer calls window.electronAPI.generateDeck(payload)
- IPC to main process

### Distractor generation
- Uses cached distractors when available
- Otherwise generates online and caches results
- Pre-generation phase batches distractors to reduce UI stalls

---

## Authentication

### Web
- Auth0 SPA redirect flow
- Config from meta tags
- Tokens stored in web storage

### Electron
- Dedicated login window
- Local callback server
- Token exchange in main process
- Renderer receives { user, token } via IPC

### Guest mode
- Persistent (localStorage) or session-only
- No auth required

---

## Sync

Sync reconciles:
- decks
- knowledge states
- exam plans
- settings

Rules:
- Newest lastModified wins
- Decks reloaded post-sync
- Knowledge states normalised before persistence

---

## Analytics & telemetry

Two layers:
- Interaction logs (per-study event)
- Aggregated analytics blobs in appData

analyticsQueue stores failed flush payloads for retry.
Flush-on-unload behaviour is used where possible.

---

## Auto-updates (Electron)

Uses:
- electron-forge
- electron-updater
- GitHub publisher (often prereleases)

Renderer can:
- request update checks
- receive status events
- trigger quit-and-install

---

## Build & run

### Desktop (Electron)

Prereqs:
- Node.js (LTS)
- npm

Install:
npm install

Run:
npm run start

Package:
npm run make

---

## Web

Static frontend plus serverless functions.
Offline works without functions; AI does not.

Functions expected at:
 /.netlify/functions/...

---

## Environment variables

Electron:
- loaded from .env.local
- packaged as extra resources

Common:
- ELECTRON_AUTH0_DOMAIN
- ELECTRON_AUTH0_CLIENT_ID
- ELECTRON_AUTH0_AUDIENCE

AI:
- provider keys required
- do not commit real keys unless you enjoy pain

Use .env.example for documentation.

---

## Security & privacy notes

- Offline-first: data lives locally in IndexedDB
- Auth tokens stored in web storage; XSS is catastrophic
- AI requires sending content to external models
- Electron bridge limits renderer access

Privacy-first users should use guest mode and disable AI.

---

## Debugging

Enable dev logging to inspect:
- FSRS computations
- Cortex scoring
- Sync decisions
- AI normalisation output

Common failures:
- IndexedDB key-path errors
- AI response shape drift
- Web vs Electron divergence at IPC / API boundaries

## License

This repo is licensed under GPL-3.0. For more, see [LICENSE](LICENSE) for more details.
