# WEB checker

Watches a part of a web page (a CSS selector on a URL) on a schedule and posts to Slack when it changes.

- `functions/` — Cloud Functions for Firebase (2nd gen)
  - `webCheckerDispatch`: every hour, finds the targets that are due (each target has its own cron, Asia/Tokyo) and publishes them to Pub/Sub
  - `webCheckerCrawl`: fetches one target, compares the selected HTML with the latest snapshot, saves a new snapshot and notifies Slack when it changed
  - `webCheckerOnTargetWrite`: crawls right after a target is created or its URL / selector changes, and deletes the snapshots when a target is deleted
- Each target has a notification mode: `slack` (default) only posts to Slack; `ai-writer` also records the links that newly appeared in the selected HTML (up to 20 per change) in `web_checker_detected_links`, for the AI writer's scheduled run to decide whether to write an article. The first crawl of a target hands nothing over, because everything in it looks new
- A failed fetch or a missing selector is posted to Slack once, then at most once a day until it is fixed (`alertedAt`); right after a target is created or edited it is always posted
- `web/` — the screens to add, edit and delete targets and to read their history (Next.js static export on Firebase Hosting)

## Data

| Path | Written by |
|---|---|
| `web_checker_targets/{id}` (`url`, `selector`, `title`, `cron`, `notifyMode`, `checkedAt`, `alertedAt`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`) | the screens (Firestore rules) and Functions (`checkedAt` and `alertedAt` only) |
| `web_checker_targets/{id}/snapshots/{id}` (`content`, `time`) | Functions only |
| `web_checker_detected_links/{sha256 of the normalized URL}` (`url`, `targetId`, `targetTitle`, `detectedAt`) | Functions only (read by the AI writer). The ID uses `@revolution/net/attempt-url`, the same key as the AI writer's attempts and registered URLs |

The Firestore rules live in `apps/ai-writer/firestore.rules`, shared with the AI writer (a Firebase project has one set of rules). Only users with the `admin` or `allowedEditor` custom claim can read or write.

## Safety

- Pages are fetched with redirects followed by hand, and every hop is checked with `@revolution/net/safe-host` so that internal addresses are never requested (SSRF)
- Text taken from pages is escaped before it is put into a Slack message
- Snapshots are shown as text in the screens, never rendered as HTML

## Commands

```bash
pnpm --filter @revolution/web-checker-functions test        # unit tests
pnpm --filter @revolution/web-checker-functions test:rules  # Firestore rules tests (starts the Emulator; needs Java)
pnpm --filter @revolution/web-checker-functions build       # bundle to functions/dist
pnpm --filter @revolution/web-checker-web dev               # screens on http://localhost:6060
pnpm --filter @revolution/web-checker-web test
```

`@revolution/*` packages from `shared/` are bundled into `functions/dist/index.js` by `functions/build.mjs`, because the Cloud Functions build installs dependencies with npm and cannot resolve pnpm workspace packages.

## Configuration

Functions read these parameters (`firebase-functions/params`):

| Name | Kind |
|---|---|
| `SLACK_BOT_TOKEN` | secret |
| `SLACK_WEB_CHECKER_CHANNEL_ID` | string |
| `WEB_CHECKER_SITE_URL` | string (the screens' URL, used for the history link in notifications) |

The screens need the six `NEXT_PUBLIC_FIREBASE_*` values at build time (see `web/lib/env.ts`).
