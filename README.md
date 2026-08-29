# Coverly

A free, installable area-coverage web app for planning a search and tracking
visited routes in real time.

## Features

- View all 369 official 2025 Greater Bengaluru ward demarcations.
- Search or tap a ward to select its exact irregular territory.
- Use verified OpenStreetMap polygons outside the official Bengaluru dataset.
- Continuous route recording that resumes the same saved path.
- Automatic highlighting of only the territory containing the live GPS point.
- Persistent important-place markers during a journey.
- Six-digit route transfer codes that expire after seven days.
- Multiple locally saved projects with history and statistics.
- Responsive phone and desktop layouts.
- No paid map key or billing requirement.

Location data stays in the browser unless the user creates a temporary transfer
code. OpenStreetMap provides the map and search.
The Bengaluru polygons come from the public-domain
[GBA Final Wards Map, December 2025](https://data.opencity.in/dataset/gba-wards-delimitation-2025)
published through OpenCity.

Temporary route codes use a free Cloudflare Worker and KV namespace configured
under `worker/`. Anyone with a route code can open that snapshot until it
expires.

## Run

```bash
npm install
npm run dev -- --host 0.0.0.0
```

Open `http://localhost:5173` on the computer. A phone can open the network URL
on the same Wi-Fi, but mobile GPS normally requires an HTTPS deployment.

## Build and install

```bash
npm run build
npm run preview
```

Deploy `dist` to an HTTPS static host. Cloudflare Pages, GitHub Pages, Netlify,
and Vercel have free plans. Then use “Add to Home Screen” in the phone browser.

## Android background tracking

Install `Coverly.apk` once to enable Android foreground-service GPS. Starting
tracking displays Android's required persistent notification and continues
collecting route points while another app is open.

The APK loads the HTTPS web app, so future map, UI, boundary, and JavaScript
tracking changes update automatically when Coverly is reopened. Native Android
permission or plugin changes still require a newly built APK.

Build the APK with:

```bash
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```
