# Connecting your Google account

The app is fully built and already runs (you'll see a "Sign in with Google" screen).
It just needs one credential from you: an **OAuth Client ID**. Nothing else — no API
key, no service account, no billing.

## 1. Create a Google Cloud project

1. Go to https://console.cloud.google.com/
2. Top-left project dropdown → **New Project** → name it e.g. `planner-pwa` → Create.
3. Make sure that new project is selected (top-left dropdown).

## 2. Enable the APIs the app uses

1. Left sidebar → **APIs & Services → Library**.
2. Search **Google Sheets API** → open it → **Enable**.
3. Search **Google Drive API** → open it → **Enable**.
4. Search **Google Tasks API** → open it → **Enable** (needed for the Tasks page).

## 3. Configure the OAuth consent screen

1. Left sidebar → **APIs & Services → OAuth consent screen**.
2. User type: **External** → Create.
3. App name: `Planner`. User support email: your email. Developer contact: your email. Save and continue.
4. Scopes step: click **Add or remove scopes**, search for and check both:
   - `.../auth/drive.file` (Drive API — "See, edit, create, and delete only the
     specific Google Drive files you use with this app")
   - `.../auth/tasks` (Tasks API — "Create, edit, organize, and delete all your
     tasks and task lists")

   Save and continue.
5. Test users step: **Add users** → add your own Gmail address. Save and continue.
   (Because this stays in "Testing" mode, only accounts you list here can sign in —
   perfect for a personal app, and you never need Google's app-review process.)

## 4. Create the OAuth Client ID

1. Left sidebar → **APIs & Services → Credentials**.
2. **Create Credentials → OAuth client ID**.
3. Application type: **Web application**. Name: `Planner web`.
4. Under **Authorized JavaScript origins**, add every origin you'll actually load
   the app from, e.g.:
   - `http://localhost:8080` (for local testing)
   - `https://<your-username>.github.io` (once you deploy — see below)
5. Leave "Authorized redirect URIs" empty — this app uses the token flow, not redirects.
6. Create. Copy the **Client ID** (ends in `.apps.googleusercontent.com`).

## 5. Paste it into the app

Open `config.js` in this folder and replace the placeholder:

```js
GOOGLE_CLIENT_ID: 'REPLACE_WITH_YOUR_CLIENT_ID.apps.googleusercontent.com',
```

## 6. Run it locally and sign in

From this folder:

```
python -m http.server 8080
```

Open `http://localhost:8080` in Chrome, tap **Sign in with Google**, pick your
account, and approve. Since the scope is `drive.file`, the consent screen will show
a narrow permission ("create and manage its own files") — not full Drive access.

On first sign-in the app automatically creates a Google Sheet named
**"Planner PWA Data"** in your Drive with the right header row — you can open it
directly in Google Sheets at any time to inspect or hand-edit your data.

## 7. Deploy for real phone installability

`localhost` works for desktop testing, but to install it on your phone's home
screen you need a real HTTPS URL. Easiest free option: **GitHub Pages**.

1. Push this `planner-pwa` folder to a GitHub repo.
2. Repo → Settings → Pages → Deploy from branch → `main` / root.
3. You'll get a URL like `https://yourname.github.io/planner-pwa/`.
4. Go back to step 4 above and add that exact origin
   (`https://yourname.github.io`) to **Authorized JavaScript origins**.
5. Open that URL on your phone in Chrome/Safari → sign in → menu →
   **Add to Home Screen** / **Install app**.

## Notes on sign-in behavior

- **First time**: you'll see the Google account picker + consent screen once.
- **Later visits** (same browser, still logged into Google): sign-in is silent —
  no prompt, per the spec.
- **If your Google session truly expires**: the app retries silently once, then
  falls back to the "Sign in with Google" button — this is expected, not a bug.
- **Different device/browser/profile, or after signing out of Google entirely**:
  you'll need to sign in again — also expected per the spec.
