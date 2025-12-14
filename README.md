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

To set up the project locally:

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/TJ7755/Lagiote-revise.git
    ```
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Start the application**:
    ```bash
    npm start
    ```

## Environment

Copy `.env.example` to `.env.local` and fill in the values for your setup. The Electron main process loads `.env.local` in development and the file is packaged as an extra resource for desktop builds. Typical keys:

- `PROXY_URL`
- `ELECTRON_AUTH0_DOMAIN`, `ELECTRON_AUTH0_CLIENT_ID`, `ELECTRON_AUTH0_AUDIENCE`, `ELECTRON_AUTH0_REDIRECT_URI`
- `GEMINI_API_KEY`
- `DATABASE_URL`

Keep `.env.local` out of version control.

## License

This project is licensed under the GPL-3.0 License; see the [LICENSE](LICENSE) file for details. GPL-3.0 requires derivative works to remain GPL-licensed.
