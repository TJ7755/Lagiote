# Lagiote Revise

Lagiote Revise is an offline-capable flashcard application designed to help you master any subject through intelligent study modes and AI-powered features.

## Access

You can access Lagiote Revise in two ways:
- **Web**: Visit [lagiote-revise.netlify.app](https://lagiote-revise.netlify.app)
- **Desktop**: Download the latest release from the [GitHub Releases](https://github.com/TJ7755/Lagiote/releases/) page.

## Features

- **Offline Capability**: Study anywhere, anytime, without an internet connection.
- **AI-Powered Deck Generation**: Create comprehensive flashcard decks from a simple topic or text using AI.
- **Smart Study Modes**: 4 different modes of learning.
- **Cross-Platform**: Available as a web app and a desktop application.

## Algorithms

Lagiote Revise employs distinct algorithms for different purposes:

## Learn Mode
Learn Mode uses a queue-based progression system designed to efficiently move cards from "New" to "Mastered".
**Prioritisation**: Cards are prioritised based on their current mastery score. If an exam date is set, the algorithm also calculates projected retention to prioritise cards you are most likely to forget before the exam.
**Spaced Repetition**: This is different from other flashcard apps. It uses spaced repetition in a new, innovative, way. When the user inputs an exam date, the algorithm uses an adapted version of SM-2 algorithm to work out predicted retention on the day of the exam provided.
**Mastery Tracking**: Cards are considered mastered when their mastery score exceeds a specific threshold (typically 90%), ensuring you focus on what you don't know.

## Review Mode
Review Mode is a simple flashcard-based learning mode.
**Binary Sorting**: Cards are sorted into two piles: "Still Learning" and "Correct".
**Immediate Feedback**: You get immediate feedback on your answers.
**Round-Based**: You continue reviewing the "Still Learning" pile in subsequent rounds until all cards are answered correctly.

## Practice Test Mode
Practice Test Mode simulates a real exam environment. You will have many different options
**No Immediate Feedback**: Unlike other modes, you won't see if you are correct or incorrect immediately after answering.
**Assessment**: This mode is ideal for accessing exam rediness.

## Sequence Mode
Sequence mode is a new learning mode. This learn mode helps with learning sequences - like the periodic table, or the order of the US presidents.
**Chunked learning**: All the flashcards are chunked into groups of 5.
**Forwards-chaining and Backwards-chaining**: The algorithm first shows the card in the normal order, and then backwards to reinforce learning.

## Development

Use Node.js **26.12.1** and npm **12.2.1**. `.node-version` and `.nvmrc` pin the Node release. The supported older Node lines must include the October 2026 security patches; see `package.json` for minimum versions.

```bash
npm ci
npm start
```

`npm start` runs the web app at `http://127.0.0.1:5173`. For the desktop app:

```bash
npm run start:electron
```

Electron starts its own Vite server in development. Build and preview the production web app with `npm run build:web` and `npm run preview:web`. Create a desktop package with `npm run package`; `npm run make` builds distributable installers/archives. macOS distribution uses ZIP archives. The old DMG maker was removed because its image parser dependency has an unresolved security advisory.

### Verification

```bash
npm run check:structure
npm run test:unit
npm run test:install
npm run test:e2e:web
npm run test:e2e:electron
npm run smoke:web
npm audit
```

The browser suite owns port 4187 and refuses to reuse another application's server. Browser and Electron tests use isolated test data and mock hosted services; passing them does not verify live accounts, AI services or cloud synchronisation.

### Backup recovery

In Settings, use **Export full backup** to download decks, learning progress, exam data and settings. **Restore full backup** merges a previous Lagiote JSON export into local data after confirmation. Matching decks/settings are overwritten; unrelated decks remain, and versioned exam records retain newer local versions. A failed import rolls back the entire import transaction.

### Runtime repairs

Dashboard and standalone study pages now initialise explicitly after their modules load. FSRS is bundled locally and used by both production and tests, including offline sessions. PDF, Word, chart and sorting dependencies are installed through npm rather than stale vendored scripts or runtime CDN downloads. Netlify builds and publishes `dist`.

## Environment

Local study does not require an account or environment file. Copy `.env.example` to `.env.local` only when configuring optional development services. Keep it private: it is ignored by Git and excluded from desktop packages. Configure hosted secrets in the deployment environment rather than shipping them to users.

Existing secrets in Git history are not removed by ignoring the file; rotate any real credentials previously committed.

## Remaining security limit

As checked on 25 October 2026, Electron 45.0.0 is the latest stable release but embeds Node 24.22.0 and Brotli 1.2.0. Those predate the October Node/Brotli fix. Updating the system Node does not patch Electron's embedded runtime. Do not treat a clean npm audit as proof that the desktop runtime is fully patched. Follow the [Node security advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) and [Electron releases](https://releases.electronjs.org/) before distributing the desktop build.

## License

This project is licensed under the GPL-3.0 License; see the [LICENSE](LICENSE) file for details. GPL-3.0 requires derivative works to remain GPL-licensed.
