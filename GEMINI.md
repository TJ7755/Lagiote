# Gemini Code-Aware Context

## Project Overview

This project is **Lagiote Revise**, a sophisticated, cross-platform flashcard application built with Electron and vanilla JavaScript. It is available as both a desktop application and a web app. The application is designed for studying and learning, incorporating intelligent study modes, spaced repetition algorithms (SM-2), and AI-powered features.

The application uses **IndexedDB** for local storage of all user data, including decks, cards, and study progress, allowing for full offline capability. For AI features like deck generation and autocomplete, it makes API calls to a backend proxy server, which can be hosted on services like Hugging Face Spaces or Netlify.

User authentication is handled via **Auth0**, with separate implementations for the Electron and web environments. The application also features a detailed analytics system that tracks user interactions and learning patterns, sending batched data to a backend.

**Key Technologies:**
- **Framework:** Electron
- **Frontend:** Vanilla JavaScript (ES6 Modules), HTML5, CSS3
- **Local Database:** IndexedDB
- **Authentication:** Auth0
- **AI Features:** Google Generative AI (via a backend proxy)
- **Build Tooling:** Electron Forge

## Building and Running

The project is managed with npm. The key commands are defined in `package.json`.

-   **Install Dependencies:**
    ```bash
    npm install
    ```

-   **Run the Application (Development):**
    ```bash
    npm start
    ```
    This command starts the Electron application in development mode.

-   **Build the Application:**
    ```bash
    npm run make
    ```
    This command uses `electron-forge` to build and package the application for different platforms (Windows, macOS, Linux) as configured in `forge.config.js`.

## Development Conventions

-   **Modular JavaScript:** The frontend code is organized into modules located in `assets/js/`.
    -   `main.js`: The main entry point for the renderer process, containing the bulk of the application logic and event listeners.
    -   `state.js`: Defines and manages the application's in-memory state.
    -   `db.js`: A wrapper for all IndexedDB interactions.
    -   `ui.js`: Contains utility functions for manipulating the DOM (showing/hiding views, toasts, etc.).
-   **State Management:** A simple, centralized state object is exported from `state.js`. Functions in `main.js` mutate this state directly.
-   **Asynchronous Operations:** The application makes extensive use of `async/await` for database operations and API calls.
-   **Single Page Application (SPA):** The entire UI is managed within `index.html`. Different "views" are toggled by changing CSS classes.
-   **Styling:** CSS is written directly in `index.html` and uses CSS variables for theming (including a light and dark mode).
-   **Backend Interaction:** All interactions with external services (like the Gemini API or a database for synchronization) are routed through a proxy server defined by the `PROXY_URL` in the environment configuration. The Electron main process (`main.js`) handles these API calls on behalf of the renderer process via IPC.
