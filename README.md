# ig-dm-reel-exporter

> A Chrome (Manifest V3) extension that extracts the reels, posts, and carousels shared in one Instagram Direct thread into a single structured JSON file — built for importing into a searchable knowledge base.

[![CI](https://github.com/ApoorvDixitt/ig-dm-reel-exporter/actions/workflows/ci.yml/badge.svg)](https://github.com/ApoorvDixitt/ig-dm-reel-exporter/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg)](extension/manifest.json)
[![No build step](https://img.shields.io/badge/build-none%20(vanilla%20JS)-lightgrey.svg)](#development)

If you and a friend trade reels in the DMs all day, this turns that thread into a clean, deduplicated JSON list of every shared link — with owner, caption, thumbnail, and share history — so you can feed it into notes, a database, or an embeddings-based search tool.

> [!IMPORTANT]
> This extension talks to Instagram's **private** web API using **your own** logged-in session, entirely client-side — nothing is sent to any third-party server. It only reads a thread you already have access to. Instagram's private endpoints are undocumented and can change or rate-limit at any time, and automating them may be contrary to Instagram's Terms of Use. Use it on your own account, at your own risk.

## Features

- **Shares only.** Keeps `clip`, `xma_clip`, `media_share`, and `xma_media_share` items — text, photos, voice notes, stories, reactions, and reply context are all dropped.
- **Classify + canonicalize.** Each share becomes a `reel`, `post`, or `carousel` with a canonical `https://www.instagram.com/(reel|p)/<shortcode>/` URL. Redirect shims (`l.instagram.com/?u=…`) are decoded first.
- **Deduplicated with history.** The same link shared five times becomes one item with `shareCount: 5` and a full `occurrences[]` timeline (who shared it, when).
- **Full captions.** Captions are captured in full — no truncation — so hashtags and long text survive for search/embeddings.
- **Enrichment.** Where the payload exposes it: thumbnail URL, video duration, audio/track title + artist, like and view counts.
- **Debuggable skips.** Every share that can't be resolved is itemized in `skippedShares` with a reason, so a thin export is never a silent mystery.
- **Date windows.** Extract everything, or the last 1 day / 7 days / 30 days / 6 months / 1 year / 2 years, or a custom range.

## Installation (load unpacked)

1. Clone or [download](https://github.com/ApoorvDixitt/ig-dm-reel-exporter/archive/refs/heads/main.zip) this repository.
2. Open `chrome://extensions` in Chrome (or any Chromium browser).
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and select the **`extension/`** folder inside this repo.
5. Pin the extension and make sure you're logged into [instagram.com](https://www.instagram.com).

## Quickstart

1. Open a Direct thread in Instagram's **full web view** (`instagram.com/direct/t/…`).
2. Click the extension icon.
3. Pick a date range (default: **All messages**) and click **Extract Shared Links**.
4. When it finishes, click **Download JSON**.

The download is a single `.json` file named after the chat. See [`examples/sample-export.json`](examples/sample-export.json) for a real-shaped sample and [`docs/SCHEMA.md`](docs/SCHEMA.md) for the full field reference.

## Output

Top level: `schemaVersion`, `extraction`, `source`, `extractionWindow`, `summary`, and the three always-present buckets `reels`, `posts`, `carousels` (each `{ count, items[] }`), plus `skippedShares`. A shortened item looks like:

```jsonc
{
  "shortcode": "DExAmPLe123",
  "url": "https://www.instagram.com/reel/DExAmPLe123/",
  "ownerUsername": "some.creator",
  "caption": "full caption text, including #hashtags …",
  "itemType": "clip",
  "shareCount": 2,
  "occurrences": [
    { "messageId": "…", "sharedBy": "me", "sharedAt": "2026-01-04T18:22:10.000Z", "sharedAtUnix": 1767551730 }
  ],
  "firstSharedAt": "2026-01-04T18:22:10.000Z",
  "lastSharedAt": "2026-02-11T09:03:44.000Z",
  "media": {
    "thumbnailUrl": "https://…", "videoDurationSec": 26.5,
    "audioTitle": "Original audio", "audioArtist": "some.creator",
    "likeCount": 1234, "viewCount": 98765
  }
}
```

Full schema and field semantics: [`docs/SCHEMA.md`](docs/SCHEMA.md).

## How it works

The extension is plain Manifest V3 with no build step. A popup drives content scripts that run in Instagram's page context, read your session cookies, and page through the thread via Instagram's private `direct_v2/threads/<id>/` endpoint (with adaptive backoff on rate limits). Results are parsed, classified, deduplicated, and downloaded client-side as a Blob. Nothing leaves your browser.

## Development

No build step. For iterating, [`web-ext`](https://github.com/mozilla/web-ext) makes live-reload and linting easy:

```bash
npm install                 # installs web-ext (dev only)
npm start                   # launch a Chromium profile with the extension loaded
npm run lint                # web-ext lint of extension/
npm run build               # package extension/ into a distributable zip in dist/
```

You can also just **Load unpacked** the `extension/` folder — that's the whole extension.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). For anything security-related, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Apoorv Dixit
