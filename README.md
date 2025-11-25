# Lagiote Revise

Lagiote Revise is an offline-capable flashcard application designed to help you master any subject through intelligent study modes and AI-powered features.

## Access

You can access Lagiote Revise in two ways:
- **Web**: Visit [lagiote-revise.netlify.app](https://lagiote-revise.netlify.app)
- **Desktop**: Download the latest release from the [GitHub Releases](https://github.com/TJ7755/Lagiote/releases/) page.

## Features

- **Offline Capability**: Study anywhere, anytime, without an internet connection.
- **AI-Powered Deck Generation**: Create comprehensive flashcard decks from a simple topic or text using advanced AI.
- **Smart Study Modes**: Tailored algorithms to maximize your learning efficiency.
- **Cross-Platform**: Available as a web app and a desktop application.

## Algorithms

Lagiote Revise employs distinct algorithms to cater to different learning stages:

### Learn Mode
Learn Mode uses a **queue-based progression system** designed to efficiently move cards from "New" to "Mastered".
- **Prioritization**: Cards are prioritized based on their current mastery score. If an exam date is set, the algorithm also calculates projected retention to prioritize cards you are most likely to forget before the exam.
- **Dynamic Session Sizing**: The system automatically adjusts the number of cards in a session based on your settings and the number of due cards.
- **Mastery Tracking**: Cards are considered mastered when their mastery score exceeds a specific threshold (typically 90%), ensuring you focus on what you don't know.

### Review Mode
Review Mode is optimized for quick, active recall sessions.
- **Binary Sorting**: Cards are sorted into two piles: "Still Learning" and "Correct".
- **Immediate Feedback**: You get immediate feedback on your answers, allowing you to quickly identify weak spots.
- **Round-Based**: You continue reviewing the "Still Learning" pile in subsequent rounds until all cards are answered correctly.

### Practice Test Mode
Practice Test Mode simulates a real exam environment.
- **No Immediate Feedback**: Unlike other modes, you won't see if you are correct or incorrect immediately after answering.
- **Assessment**: This mode is ideal for assessing your overall knowledge and readiness for an exam without the crutch of instant validation.

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

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
