# GitBible

GitBible is a browser-only Angular application for exploring and searching Scripture. The default King James Version is bundled locally and additional translations are fetched directly from the [scrollmapper/bible_databases](https://github.com/scrollmapper/bible_databases/tree/master/formats/json) repository on demand. Translations are cached in IndexedDB for offline reuse, and your last location, search term, and theme preference are stored in `localStorage`.

## Features

- Quick verse jump using natural references such as `Gen 1`, `John 3:16`, or `1Th 4:13`
- Full-text search with the top 100 matches surfaced instantly
- Translation selector with remote downloads cached locally for subsequent sessions
- Mobile-first layout with responsive book/chapter selectors
- Light and dark themes with a single-toggle switch

## Getting Started

1. Install dependencies:

	```bash
	npm install
	```

2. Start the development server:

	```bash
	npm start
	```

	The app runs at [http://localhost:4200](http://localhost:4200) and reloads on file changes.

## Usage Tips

- The quick search bar recognizes many standard book abbreviations. If a reference is recognized, a preview card appears before you press **Go**.
- When the query is not a reference, pressing **Go** performs a full-text search within the active translation.
- Translation downloads are stored in IndexedDB for 30 days. You can force a fresh copy by clearing browser storage or using devtools to delete the `gitbible-db` database.
- Theme preference, last translation, and the most recent verse location persist across browser sessions.

## Build and Test

- Production build: `npm run build`
- Unit tests (Karma): `npm test`

## Adding New Data Sources

- Place additional bundled translations in `public/data/` to ship them with the app.
<!-- TODO: Auto-load translations from that folder.  -->
- Remote translations must be accessible via raw JSON URLs. Add them to the GitBible dropdown by uploading to GitHub (or any CORS-enabled host) following the same structure as the Scrollmapper data set.

## License Notes

Each translation retains the license defined by its source. Review the metadata in the Scrollmapper repository before distributing additional texts.
