# Lagiote Revise

Lagiote Revise is a powerful, offline-first flashcard application designed to help you study more effectively and retain information longer. Built with Electron, it combines a modern user interface with a scientifically-backed learning algorithm to optimize your study sessions.

## Key Features

- **Offline-First:** Study anytime, anywhere, without needing an internet connection.
- **Spaced Repetition:** Utilizes the **SM2 algorithm** to schedule card reviews at optimal intervals, maximizing memory retention.
- **AI-Powered Card Creation:** Automatically generate flashcards from your notes, PDFs, or plain text with the integrated AI generator.
- **Cross-Platform:** Available for Windows, macOS, and Linux.
- **Web Version:** Access your flashcards on the go at [lagiote-revise.netlify.app](https://lagiote-revise.netlify.app).
- **Customizable Study Modes:** Choose between traditional flashcard reviews, typing answers, and multiple-choice questions.
- **Progress Tracking:** Visualize your learning progress with insightful analytics and track your study habits.

## The SM2 Algorithm

Lagiote Revise uses the SM2 algorithm, a popular spaced repetition system (SRS), to enhance learning. Here’s how it works:

1.  **First Look:** When you see a card for the first time, you rate how well you knew the answer.
2.  **Interval Scheduling:** Based on your rating, the algorithm calculates the optimal time to show you the card again.
    -   **Easy cards** are shown less frequently.
    -   **Difficult cards** appear more often.
3.  **Dynamic Adjustments:** Each time you review a card, the interval is adjusted based on your performance, ensuring you focus on material you haven't mastered yet.

This method is scientifically proven to move information into your long-term memory more efficiently than traditional study methods.

## Getting Started

### Prerequisites

-   [Node.js](https://nodejs.org/) (v16 or later)
-   [Git](https://git-scm.com/)

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/TJ7755/Lagiote-revise.git
    cd Lagiote-revise
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Run the application:**
    ```bash
    npm start
    ```

## How to Use

1.  **Create a Deck:** Start by creating a new flashcard deck for the topic you want to study.
2.  **Add Cards:** Add cards manually, import them from a file, or use the AI generator to create them from your notes.
3.  **Study:** Choose a study mode and begin your session. The app will automatically schedule reviews for you.
4.  **Track Progress:** Visit the analytics dashboard to see your progress and study history.
