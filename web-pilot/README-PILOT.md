# Reading Adventures — Web Pilot (Google Drive Option A)

**PILOT ONLY — not final.** Use while you finish editing the main app.  
Re-sync after main app changes: `node scripts/sync-from-v1.cjs`

Students open a **website link** (phone, tablet, laptop). No install.  
Class data loads from a **public** `class-data.json` on Google Drive.

---

## What you need

| Item | Who |
|------|-----|
| Assessment Tracker | Teacher (school) |
| `class-data.json` on Google Drive (public view link) | Teacher uploads |
| Web host (GitHub Pages, Netlify, school server) | You — for the pilot folder |
| Optional Google API key | You — **strongly recommended** so browsers can load the file |

---

## Step 1 — Export class data (teacher)

1. Open **Assessment Tracker** (browser or desktop).
2. Go to **Save/Load**.
3. Click **Save** → export `class-data.json` (baseline or current save point).
4. Keep this file — you will upload it to Drive.

*Pilot note: desktop auto-save to Documents\\Reading Tracker also works; upload that file instead.*

---

## Step 2 — Upload to Google Drive

1. Open [Google Drive](https://drive.google.com).
2. Create a folder, e.g. `Reading Adventures - Class 3A`.
3. Upload `class-data.json` into that folder.
4. When you update assessments, **upload/replace** this file (same name).

---

## Step 3 — Share the JSON file publicly

1. Right-click `class-data.json` → **Share**.
2. **General access** → **Anyone with the link** → **Viewer**.
3. Copy the link. It looks like:

   `https://drive.google.com/file/d/1ABC123xyz_EXAMPLE_ID/view?usp=sharing`

4. The **FILE_ID** is the long string between `/d/` and `/view`:

   `1ABC123xyz_EXAMPLE_ID`

---

## Step 4 — Configure the web pilot

**Option A — URL (good for QR codes)**

```
https://YOUR-SITE.example/reading-adventures/?dataId=FILE_ID
```

**Option B — config file**

1. Copy `drive-config.example.js` → `drive-config.js` (already exists; edit it).
2. Paste your FILE_ID:

```javascript
window.DRIVE_PILOT_CONFIG = {
  fileId: "1ABC123xyz_EXAMPLE_ID",
  apiKey: "",  // add in Step 5
};
```

---

## Step 5 — Google API key (recommended for browsers)

Direct Drive links often **fail in browsers** (CORS). A free API key fixes this.

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (e.g. `Reading Adventures Pilot`).
3. **APIs & Services** → **Library** → enable **Google Drive API**.
4. **Credentials** → **Create credentials** → **API key**.
5. Restrict the key (recommended):
   - **Application restrictions** → HTTP referrers → your site, e.g. `https://yourschool.org/*`
   - **API restrictions** → Google Drive API only
6. Paste the key into `drive-config.js`:

```javascript
apiKey: "AIza...",
```

Or append to the student link (pilot testing only — do not share publicly):

```
?dataId=FILE_ID&apiKey=AIza...
```

---

## Step 6 — Sync & host the pilot app

Whenever you change `ReadingAdventures V1.html`:

```bat
cd web-pilot
node scripts\sync-from-v1.cjs
```

Host the **`TRACKER`** folder structure (or at minimum `web-pilot/`, `data/`, `HTML games/`, logo PNG) on HTTPS:

| Host | Notes |
|------|--------|
| **Netlify** | Drag-drop `TRACKER` or connect Git repo |
| **GitHub Pages** | Publish `/docs` or `gh-pages` branch |
| **School web server** | Copy files to a subfolder |

Student URL example:

```
https://yourschool.org/tracker/web-pilot/?dataId=FILE_ID
```

**Google Sites:** add a page with a link or embed:

- Button: “Open Reading Adventures” → URL above
- QR code → same URL (use any free QR generator)

---

## Step 7 — Student experience

1. Scan QR or tap link.
2. App loads in the browser.
3. Class data loads from Drive automatically.
4. Choose class → student login → play games.

**Progress in pilot:** saved in the browser (`localStorage`) only — **not** back to Drive yet. Teacher desktop Progress tab won’t see web students until Phase B.

---

## Step 8 — When you update class data

1. Teacher saves/exports new `class-data.json`.
2. Replace the file in Google Drive (same name, same FILE_ID if you replace in place).
3. Students refresh the web page — they get new targets.

Replacing **in place** keeps the same FILE_ID and QR code.

---

## Privacy warning (Option A)

**Anyone with the file link can download class data** (student names, targets).  

Acceptable only for a **closed pilot**. For wider use, move to sign-in or private links later.

---

## Local test (developer)

```bat
cd TRACKER\web-pilot
npx --yes serve .. -p 3456
```

Open:

```
http://localhost:3456/web-pilot/?dataId=YOUR_FILE_ID
```

(`npx serve` needs Node.js — students won’t need this.)

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| “Could not load from Google Drive” | Add API key (Step 5) |
| Blank page | Host must be **HTTPS** (except localhost) |
| Games/audio missing | Host must include `data/` and `HTML games/` folders |
| Old targets after teacher update | Replace Drive file; students hard-refresh |
| App looks outdated | Re-run `sync-from-v1.cjs` after editing V1 HTML |

---

## Not final

- Do not treat this as production until you finish the main app.
- Re-run sync after edits to `ReadingAdventures V1.html`.
- Desktop + Electron path remains unchanged.
