# 🎬 HLS Stream Pro

A professional **live streaming platform** built for **Cloudflare Pages** with an ExoPlayer-style HLS player and a powerful admin panel.

---

## ✨ Features

### 🎥 Public Player (`/`)
- **ExoPlayer-style player** powered by [HLS.js](https://github.com/video-dev/hls.js/)
- Quality level selector (Auto + manual levels)
- Playback speed control (0.5x → 2x)
- Volume slider with smooth expand
- Fullscreen + **Picture-in-Picture**
- **Keyboard shortcuts**: `Space`/`K` play/pause, `F` fullscreen, `M` mute, `←/→` seek, `↑/↓` volume
- Live buffering spinner with recovery
- Custom **cookies** & **headers** injected via `xhr.setRequestHeader`
- Real-time stream stats (codec, resolution, bitrate, buffer, latency)
- Live program schedule sidebar
- "Now Playing" banner with channel info

### 🛠️ Admin Panel (`/admin`)
- Password-protected login
- **Stream Manager** — URL, name, description, thumbnail, type
- **HLS Options** — low latency, buffer length, start level
- **HTTP Headers** — add/remove custom headers with quick presets
- **Cookie Manager** — add/remove cookies with common name presets  
- **Schedule Manager** — add/remove timed programs with genre tags
- **Live Preview** — test player embedded in admin panel
- URL reachability tester
- Configuration saved to **Cloudflare KV** + **localStorage** fallback

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Create KV Namespace
```bash
npm run kv:create
npm run kv:create-preview
```
Copy the namespace IDs into `wrangler.toml`.

### 3. Local Development
```bash
npm run dev
```
Opens at `http://localhost:8788`

### 4. Deploy to Cloudflare Pages
```bash
npm run deploy
```

---

## ⚙️ Configuration

### Environment Variables (Cloudflare Dashboard)
| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_PASSWORD` | `admin123` | Admin panel password |

### wrangler.toml KV Setup
```toml
[[kv_namespaces]]
binding = "STREAM_KV"
id = "YOUR_KV_NAMESPACE_ID"
preview_id = "YOUR_PREVIEW_KV_NAMESPACE_ID"
```

---

## 📁 Project Structure
```
HLS-STREAM/
├── public/
│   ├── index.html          # Public player page
│   ├── admin/
│   │   └── index.html      # Admin panel
│   ├── assets/
│   │   ├── player.css      # Player styles
│   │   └── admin.css       # Admin styles
│   ├── js/
│   │   ├── player.js       # HLS.js player logic
│   │   └── admin.js        # Admin panel logic
│   └── _redirects          # CF Pages routing
├── functions/
│   └── api/
│       ├── stream.js        # Public stream API
│       ├── schedule.js      # Public schedule API
│       └── admin/
│           ├── stream.js    # Admin stream CRUD
│           └── schedule.js  # Admin schedule CRUD
├── wrangler.toml
└── package.json
```

---

## 🔑 Default Credentials
- **Admin password**: `admin123`
- Change it in Cloudflare Pages dashboard → Settings → Environment variables → `ADMIN_PASSWORD`

---

## 📡 Supported Stream Types
| Type | Format | Notes |
|------|--------|-------|
| HLS | `.m3u8` | Full support via HLS.js |
| DASH | `.mpd` | Basic support |
| Direct | `.mp4` | Native browser |
| LL-HLS | `.m3u8` | Low latency mode |

---

## 🎨 Tech Stack
- **Hosting**: Cloudflare Pages
- **API**: Cloudflare Pages Functions (Workers)
- **Storage**: Cloudflare KV  
- **Player**: HLS.js v1.5
- **UI**: Vanilla HTML/CSS/JS (no frameworks)
- **Fonts**: Inter + JetBrains Mono (Google Fonts)
