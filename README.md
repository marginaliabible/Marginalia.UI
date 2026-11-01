# Marginalia

Marginalia is a browser-only React application for exploring and searching Scripture. The default King James Version is bundled locally and additional translations are fetched on demand. Translations are cached in IndexedDB for offline reuse, and your last location, search term, and theme preference are stored in `localStorage`.

## Features

- Quick verse jump using natural references such as `Gen 1`, `John 3:16`, or `1Th 4:13`
- Full-text search with the top 100 matches surfaced instantly
- Translation selector with remote downloads cached locally for subsequent sessions
- File Sync for **Subscriptions**: connect a `library.json` URL (public GitHub, a church library, or hosted markup packages)
- PDF.js and markup (pdf2htmlEX) document viewers
- Mobile-first layout with responsive book/chapter selectors
- Light and dark themes with a single-toggle switch

Cloud Drive/OneDrive sync, account billing, and Cloud Control Service are a separate private overlay (`Marginalia.UI.Sanctum`), not part of this repository.

## Tech Stack

- **React 19** — hooks
- **TypeScript** — type-safe development
- **Redux Toolkit** — state management
- **Vite** — development server and production builds
- **SCSS** — Bootstrap 5
- **IndexedDB** — offline-first data via idb
- **Jest & React Testing Library** — unit testing

## Getting Started

1. Install dependencies:

	```bash
	npm install
	```

2. Start the development server:

	```bash
	npm start
	```

	The app runs at [http://localhost:3000](http://localhost:3000).

Optional environment variables are documented in `.env.example`. Copy that file to `.env.local` if you need GitHub OAuth for private library URLs.

## Subscriptions

Open **File Sync** in the header and use **Subscriptions → Connect** to paste a `library.json` URL. Public catalogs work with no account. Private GitHub libraries need `VITE_GITHUB_CLIENT_ID` and a callback service URL (`VITE_AUTH_SERVICE_URL`).

Markup libraries (including hosted document packages) open in the built-in markup viewer. Conversion of Office/PDF files to that format is not part of this repository.

## Usage Tips

- The quick search bar recognizes many standard book abbreviations. If a reference is recognized, a preview card appears before you press **Go**.
- When the query is not a reference, pressing **Go** performs a full-text search within the active translation.
- Translation downloads are stored in IndexedDB for 30 days. You can force a fresh copy by clearing browser storage or using devtools to delete the `marginalia-db` database.
- Theme preference, last translation, and the most recent verse location persist across browser sessions.

## Build and Test

- Development: `npm start` or `npm run dev`
- Production build: `npm run build`
- Preview build: `npm run preview`
- Unit tests: `npm test`
- Watch tests: `npm run test:watch`

## License

MIT. Each translation retains the license defined by its source.
