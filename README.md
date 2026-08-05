# Marginalia

Marginalia is a browser-only React application for exploring and searching Scripture. The default King James Version is bundled locally and additional translations are fetched directly from the [scrollmapper/bible_databases](https://github.com/scrollmapper/bible_databases/tree/master/formats/json) repository on demand. Translations are cached in IndexedDB for offline reuse, and your last location, search term, and theme preference are stored in `localStorage`.

## Features

- Quick verse jump using natural references such as `Gen 1`, `John 3:16`, or `1Th 4:13`
- Full-text search with the top 100 matches surfaced instantly
- Translation selector with remote downloads cached locally for subsequent sessions
- Mobile-first layout with responsive book/chapter selectors
- Light and dark themes with a single-toggle switch
- State management with Redux Toolkit
- Built with Vite for fast development and optimized production builds

## Tech Stack

- **React 18** - Modern React with hooks
- **TypeScript** - Type-safe development
- **Redux Toolkit** - Simplified Redux state management
- **Vite** - Next-generation frontend tooling
- **SCSS** - Enhanced styling with Bootstrap 5
- **IndexedDB** - Offline-first data persistence via idb
- **Jest & React Testing Library** - Unit testing

## Getting Started

1. Install dependencies:

	```bash
	npm install
	```

2. Start the development server:

	```bash
	npm start
	```

	The app runs at [http://localhost:3000](http://localhost:3000) with hot module replacement.

## AWS Integration

Marginalia uses one AWS Lambda URL for GitHub OAuth callback handling, PDF proxying, and federated token exchange (Google + Microsoft).

Set this in your local environment file:

```dotenv
VITE_AUTH_SERVICE_URL=https://your-lambda-function-url.lambda-url.us-east-1.on.aws/
```

Notes:

- This single URL is used when starting GitHub authorization.
- The PDF viewer also builds its proxy URL from the same base.
- Google and Microsoft sign-in token exchange is always brokered through this Lambda.
- If you change the Lambda URL, update this value and restart Vite.

## Account Sync Configuration

Marginalia supports federated account login for configuration sync with Google and Microsoft.

Add provider client IDs to your local frontend environment file:

```dotenv
VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id
VITE_MICROSOFT_CLIENT_ID=your-microsoft-oauth-client-id
```

Notes:

- These IDs are required for the header account icon sign-in flow.
- Client secrets are not stored in the browser app.
- The Lambda service must be configured with provider secrets/server credentials.

Lambda environment variables required for brokered exchange:

```dotenv
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
MICROSOFT_CLIENT_ID=your-microsoft-app-client-id
MICROSOFT_CLIENT_SECRET=your-microsoft-app-client-secret
MICROSOFT_TENANT=common
```
- Configuration sync currently targets Google and Microsoft only.

## Usage Tips

- The quick search bar recognizes many standard book abbreviations. If a reference is recognized, a preview card appears before you press **Go**.
- When the query is not a reference, pressing **Go** performs a full-text search within the active translation.
- Translation downloads are stored in IndexedDB for 30 days. You can force a fresh copy by clearing browser storage or using devtools to delete the `marginalia-db` database.
- Theme preference, last translation, and the most recent verse location persist across browser sessions.

## Performance Monitoring

Marginalia includes built-in cache diagnostics for development and tuning:

**View Cache Statistics:**
Open your browser DevTools console and run:
```javascript
__MARGINALIA_CACHE_STATS__()
```

This returns an object with:
- `chapterHits` / `chapterMisses` - Chapter cache access patterns
- `verseHits` / `verseMisses` - Verse cache access patterns
- `translationHits` / `translationMisses` - Full translation cache access patterns
- `chapterEvictions` / `verseEvictions` - LRU eviction counts (indicates cache churn)
- `chapterCacheSize` / `verseCacheSize` / `translationCacheSize` - Current in-memory usage

Use this to monitor cache efficiency while navigating, searching, and jumping between verses. High eviction counts suggest cache sizes may be too small; low hit ratios suggest the cache isn't being effectively reused.

## Build and Test

- Development: `npm start` or `npm run dev`
- Production build: `npm run build`
- Preview build: `npm run preview`
- Unit tests: `npm test`
- Watch tests: `npm run test:watch`

## Project Structure

```
src/
├── App.tsx              # Main application component
├── App.scss             # Component-specific styles
├── main.tsx             # Application entry point
├── styles.scss          # Global styles and Bootstrap imports
├── models/              # TypeScript interfaces and types
│   └── bible.ts
├── services/            # Business logic services
│   └── bibleService.ts
├── store/               # Redux store configuration
│   ├── store.ts         # Store setup
│   ├── hooks.ts         # Typed Redux hooks
│   └── slices/          # Redux slices
│       ├── bibleSlice.ts
│       └── uiSlice.ts
└── utils/               # Utility functions
    ├── reference-parser.ts
    └── book-aliases.ts
```

## Adding New Data Sources

- Place additional bundled translations in `public/data/bibles/` to ship them with the app.
- Remote translations must be accessible via raw JSON URLs. Add them to the Marginalia dropdown by uploading to GitHub (or any CORS-enabled host) following the same structure as the Scrollmapper data set.
- Update `public/data/bibles/_settings.json` to register new translations.

## License Notes

Each translation retains the license defined by its source. Review the metadata in the Scrollmapper repository before distributing additional texts.
