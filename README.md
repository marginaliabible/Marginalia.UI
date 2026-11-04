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

## Hosting and CI/CD

The SPA is hosted on **Cloudflare Pages** via GitHub Actions (direct upload with Wrangler), not the Pages native Git integration.

| Channel | Domain | Trigger | Build |
|---------|--------|---------|-------|
| Beta | `beta.marginaliabible.com` | Push to `main` | Sanctum overlay (`npm run build:sanctum`) → Pages project `marginalia-ui-beta` |
| Production | `marginaliabible.com` | GitHub Release tag `v*` | Public UI (`VITE_SANCTUM=0`) → Pages project `marginalia-ui` |

Workflows: [`.github/workflows/ci.yml`](.github/workflows/ci.yml) (PR tests), [`.github/workflows/deploy-beta.yml`](.github/workflows/deploy-beta.yml), [`.github/workflows/deploy-prod.yml`](.github/workflows/deploy-prod.yml), [`.github/workflows/create-release.yml`](.github/workflows/create-release.yml), [`.github/workflows/cleanup-merged-branches.yml`](.github/workflows/cleanup-merged-branches.yml) (deletes `main`-merged PR branches after 90 days).

Pull requests to `main` run `npm test`. In GitHub **Settings → Branches → Branch protection** for `main`, require the status check **`test`** so merges are blocked until CI is green.

To cut a production release: run **Actions → Create release** on `main` (manual). It tags `vYYYY.MM.PP` from the UTC calendar month (`v2026.11.00`, then `v2026.11.01`, …) and publishes a GitHub Release, which triggers the prod deploy.

Build identity appears in **Settings** (`VITE_APP_VERSION` / `VITE_APP_GIT_SHA`). Prod shows the release tag; beta shows `{latest-v-tag}-{sha7}` (for example `v2026.11.00-a1b2c3d`).

### One-time Cloudflare / GitHub setup

1. Create Pages projects `marginalia-ui` and `marginalia-ui-beta` (or let the first `wrangler pages deploy` create them).
2. Attach custom domains: apex (+ `www` → apex) on prod; `beta.marginaliabible.com` on beta.
3. Create a GitHub Environment named **`hosted`**:
   - Deployment branches/tags: allow `main` **and** `v*` tags (prod runs on the release tag ref).
   - **Secrets:** `CLOUDFLARE_API_TOKEN`, `SANCTUM_CHECKOUT_TOKEN` (Contents: Read on `marginaliabible/Marginalia.UI.Sanctum`).
   - **Variables:** `CLOUDFLARE_ACCOUNT_ID`, `VITE_GOOGLE_CLIENT_ID`, `VITE_MICROSOFT_CLIENT_ID`.
4. `VITE_AUTH_SERVICE_URL` is hardcoded in the workflows to `https://cloudcontrol.marginaliabible.com/`. Do not set `VITE_STORAGE_PUBLIC_BASE_URL` (defaults to shared `https://storage.marginaliabible.com`). Hosted Marginalia does not set `VITE_GITHUB_CLIENT_ID` (private GitHub library OAuth); forks can uncomment it in the deploy workflows if needed.
5. Allowlist `https://beta.marginaliabible.com` on the storage gateway Worker and in CCS Lambda `OAUTH_ALLOWED_RETURN_ORIGINS`, then redeploy the Worker / update Lambda env.

## License

MIT. Each translation retains the license defined by its source.
