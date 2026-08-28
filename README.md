# Coverly

A free, installable area-coverage web app for planning a search and tracking
visited routes in real time.

## Features

- Add target points by place search, map tap, or current GPS.
- Set each radius from 100 metres to 10 kilometres.
- Live route recording and an adaptive coverage grid.
- Multiple locally saved projects with history and statistics.
- Responsive phone and desktop layouts.
- No account, backend, or paid map key.

Location data stays in the browser. OpenStreetMap provides the map and search.

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
