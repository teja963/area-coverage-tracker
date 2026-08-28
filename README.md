# Coverly

A free, installable area-coverage web app for planning a search and tracking
visited routes in real time.

## Features

- View all 369 official 2025 Greater Bengaluru ward demarcations.
- Search or tap a ward to select its exact irregular territory.
- Use verified OpenStreetMap polygons outside the official Bengaluru dataset.
- Live route recording and an adaptive coverage grid.
- Multiple locally saved projects with history and statistics.
- Responsive phone and desktop layouts.
- No account, backend, or paid map key.

Location data stays in the browser. OpenStreetMap provides the map and search.
The Bengaluru polygons come from the public-domain
[GBA Final Wards Map, December 2025](https://data.opencity.in/dataset/gba-wards-delimitation-2025)
published through OpenCity.

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
