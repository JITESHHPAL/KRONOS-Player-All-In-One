# Architecture

KRONOS has two parts: a small Python server and a static web player.

## Server (`server.py`)

Standard library only (`http.server`, `subprocess`, `threading`). It:

- serves the player from `web/` (with `Cache-Control: no-cache`)
- serves library files from `/media/…` with **HTTP range support**, using zero-copy `sendfile`
- redirects a browser opening a video link directly to the player (`/?src=…`)
- runs `ffprobe` / `ffmpeg` when available, in background threads
- refuses any path that resolves outside its root folders

### HTTP API

| Endpoint | Purpose |
|---|---|
| `GET /api/list` | Library listing: `{video: [], image: [], audio: []}` |
| `GET /media/<path>` | File download with `Range` support |
| `GET /api/tracks?f=<path>` | Audio tracks, embedded subtitles, duration, height, codec (ffprobe) |
| `GET /api/prepare?f=<path>&a=<audio>&h=<height>` | Start or poll a conversion job → `{state, progress, url}` |
| `GET /cache/<file>` | Converted MP4 produced by `prepare` |
| `GET /api/sub?f=<path>&s=<index>` | Embedded subtitle converted to WebVTT |
| `GET /api/thumb?f=<path>` | Cached JPEG thumbnail for photos |

### Why conversions instead of live streaming

Switching audio or quality produces a normal, seekable MP4 (`-movflags +faststart`). The video stream is copied unless a lower resolution is chosen. This keeps audio and video perfectly in sync and makes seeking instant. Results are cached in `cache/`.

## Web player (`web/`)

| File | Role |
|---|---|
| `index.html` | All screens (home, library, photo viewer, now playing, video player) |
| `media.js` | Navigation (history API), library, Recent, photo viewer, music player |
| `player.js` | Video player, settings panel, audio/quality switching, subtitles, picture settings |
| `player.css` | Liquid-glass styling and transitions |
| `sw.js`, `manifest.webmanifest` | Installable app (service worker works on `localhost` / HTTPS) |

Screens are switched with `show()` in `media.js`; Chrome's View Transitions API is used for cross-blur transitions (never while a video is playing). Settings and recent items are stored in `localStorage`.

## Performance notes

- Blur (`backdrop-filter`) is not used on small buttons over a playing video; hidden controls use `visibility: hidden` so they cost nothing
- A "Smooth mode" lightens the remaining glass on slower phones
