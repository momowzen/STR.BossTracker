# LORDNINE Boss Tracker

Real-time collaborative field boss & world boss respawn timer for the STR4NG3RZ guild. Syncs across all users via Firestore — mark a boss dead in one tab, everyone sees the countdown instantly.

## Features

- **Live boss list** — Two columns: fixed-interval bosses and weekly-scheduled bosses, with level, location, and countdown per card
- **KILLED button** — Atomic Firestore transaction starts a respawn timer visible to all users
- **Next Boss panel** — Shows the soonest upcoming respawn with a live countdown
- **World Boss panel** — Daily 12:00 / 21:00 JST spawns for Ratan, Parto, Nedra
- **Remaining Today counter** — How many field bosses still have respawns left in the current JST day
- **Schedule view** — TODAY / TOMORROW columns listing expected spawns (world bosses excluded)
- **Search & Sort** — Real-time filter by name; sort by time, name, or level
- **Notifications & Alarm** — Desktop notification + audio alarm 5 minutes before respawn and on spawn
- **Discord webhook** — Configurable in Settings; sends killed / 5-min warning / spawned messages
- **Admin panel** — Password-protected; clear timers, export/import JSON backup, reset all timers
- **Accent color picker** — 5 themes (Gold, Red, Purple, Blue, Green) saved to localStorage
- **Auto-update** — Checks page hash every 30s and reloads on change
- **Mobile responsive** — Swipeable panels, view toggles, 600px breakpoint

## Tech Stack

- **Firebase Firestore** (v10 CDN) — real-time sync, dead-lock management, notification dedup
- **Firebase App Check** — reCAPTCHA v3 protection
- **Web Audio API** — alarm beeps (no audio files)
- **Vanilla HTML/CSS/JS** — single file, no bundlers or frameworks
- **SVG icon sprite** — inline `<symbol>` definitions used via `<use href="#icon-...">`

## Files

| File | Purpose |
|---|---|
| `index.html` | The full application (single HTML file, ~4300 lines) |
| `bosses_data.json` | Boss definitions (id, name, level, respawn/ schedule, location) |
| `assets/images/*.png` | Boss portraits (hosted on GitHub raw) |
| `functions/` | Firebase Cloud Function for Discord OAuth2 callback |
| `firebase.json` | Firebase project config |
| `.firebaserc` | Firebase default project alias |

## Setup

1. Clone the repo
2. Place `index.html` and `bosses_data.json` on any static web server (GitHub Pages, Netlify, Vercel, etc.)
3. The Firebase config is already wired to project `bosstracker-a290e` with App Check. No backend needed.

### Self-host Firebase

If you want your own Firebase project:

1. Create a Firebase project, enable Firestore
2. Enable App Check with reCAPTCHA v3
3. Replace `firebaseConfig` in `index.html` and the reCAPTCHA site key in `initializeAppCheck()`
4. Set Firestore security rules to allow read/write (App Check handles abuse prevention)

### Discord Login

The app uses Discord OAuth2 to restrict access to guild members.

#### 1. Vercel Setup

1. Go to https://vercel.com and sign in with GitHub
2. Click **Add New** → **Project** → import `momowzen/STR.BossTracker`
3. In **Environment Variables**, add:
   - `DISCORD_CLIENT_ID` = `1518260560766963912`
   - `DISCORD_CLIENT_SECRET` = your Discord client secret
   - `DISCORD_GUILD_ID` = `1405710246655164557`
4. Click **Deploy**
5. Copy your project URL (e.g. `https://str-bosstracker.vercel.app`)

#### 2. Discord Developer Portal

1. Go to https://discord.com/developers/applications → **OAuth2** → **General**
2. Add a redirect URL: `https://YOUR_VERCEL_APP.vercel.app/api/discord-callback`
3. Copy the **Client ID** and **Client Secret**

#### 3. Update Frontend

In `index.html`, update the redirect URI:
```js
const DISCORD_REDIRECT_URI = 'https://YOUR_VERCEL_APP.vercel.app/api/discord-callback';
```

### Admin Password

### Timezone

Hardcoded to **Asia/Tokyo (UTC+9)**. Edit `TIME_ZONE_OFFSET_MS` and related constants in `index.html` to change.

## Boss Data

44 bosses total:
- **Fixed interval** — e.g. Venatus (36000s), Livera (86400s), Secreta (223200s)
- **Weekly schedule** — e.g. Clemantis (Mon 12:30 / Thu 20:00), Libitina (Mon 22:00 / Sat 22:00)
- **World bosses** — Ratan, Parto, Nedra (daily 12:00 / 21:00 JST, shown separately)

Edit `bosses_data.json` to add, remove, or change bosses.

## License

MIT
