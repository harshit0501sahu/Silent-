# Planner

A mobile-first, installable day planner that stores every task in **your own Google Sheet** — no backend, no database, no third-party server. It's a static PWA that talks directly to the Google Sheets API.

## Features

- Month view → tap a date → 24-hour, 30-minute-slot day timeline
- 5 fixed categories (Work, Film, Personal, Health, Admin), color-coded consistently everywhere
- Create / edit / delete tasks, synced to a Google Sheet in your own Drive
- The Sheet is the source of truth — open it directly in Google Sheets any time to read or hand-edit
- **Export to PDF** — a custom date range (a day up to a year+), or a monthly batch bundled into one file
- Installable as a real home-screen / desktop app (not just a browser shortcut)
- Silent sign-in on repeat visits; only asks again if your Google session actually expires
- Dark, night-sky themed UI; adapts from full-bleed mobile to a centered frame on larger screens

## Tech stack

Plain HTML/CSS/JS. No framework, no build step, no npm dependencies to install.

- Auth: [Google Identity Services](https://developers.google.com/identity/gsi/web) (OAuth token flow, `drive.file` scope only)
- Data: [Google Sheets API v4](https://developers.google.com/sheets/api) + [Drive API v3](https://developers.google.com/drive/api), called directly via `fetch`
- PDF export: [jsPDF](https://github.com/parallax/jsPDF) (loaded from CDN)
- PWA: hand-written `manifest.json` + `sw.js` service worker (app-shell caching only — task data always hits the network)

## Project structure

```
planner-pwa/
├── index.html      # markup + all CSS
├── app.js          # UI logic, view rendering, PDF export
├── auth.js         # Google sign-in (silent + interactive)
├── sheetsApi.js     # Sheets/Drive REST calls (find-or-create sheet, CRUD on rows)
├── config.js        # your Google OAuth Client ID goes here
├── manifest.json     # PWA manifest
├── sw.js             # service worker (app-shell cache only)
├── icons/            # 192px / 512px app icons
├── SETUP.md          # step-by-step Google Cloud setup
└── README.md
```

## Quick start (local)

1. Clone this repo.
2. Follow **[SETUP.md](SETUP.md)** to create a Google Cloud project, enable the Sheets + Drive APIs, and get an OAuth Client ID.
3. Paste that Client ID into `config.js`.
4. Serve the folder over HTTP (needed for Google sign-in to work — opening `index.html` directly as a `file://` URL won't work):
   ```
   python -m http.server 8080
   ```
5. Open `http://localhost:8080`, sign in with Google.

On first sign-in the app auto-creates a Sheet called **"Planner PWA Data"** in your Drive, with the correct header row.

## Deploying (GitHub Pages)

1. Push this repo to GitHub (see below).
2. Repo → **Settings → Pages** → Source: **Deploy from a branch** → branch `main`, folder `/ (root)` → Save.
3. GitHub gives you a URL like `https://<username>.github.io/<repo>/`.
4. Back in Google Cloud Console → **APIs & Services → Credentials** → your OAuth Client → add that exact origin (`https://<username>.github.io`) under **Authorized JavaScript origins**.
5. Open the Pages URL on your phone → **Install App** from the drawer menu (☰) to add it as a real home-screen app.

No build step, no GitHub Actions needed — it's plain static files.

## Security note

`config.js` contains a Google OAuth **Client ID** and is committed to this repo — that's expected and safe. Client IDs for this kind of browser-side OAuth flow aren't secrets; what actually protects the app is the **Authorized JavaScript origins** allowlist configured in Google Cloud Console (only requests from those exact origins are accepted) and the narrow **`drive.file`** scope (the app can only ever see files it created itself, never your wider Drive or Sheets).

## Pushing this to GitHub

This repo isn't initialized yet. From a terminal in this folder:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

Create the (empty) repo on GitHub first at github.com/new, then use the URL it gives you in place of the one above.
