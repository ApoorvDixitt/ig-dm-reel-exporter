# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The extension `version` in `extension/manifest.json` and the `toolVersion` in the
JSON export track this same number.

## [Unreleased]

## [3.1.0] - 2026-07-13

Initial public release of **ig-dm-reel-exporter** — a focused Chrome MV3 tool
that exports the reels/posts/carousels shared in a single Instagram Direct
thread as one structured JSON file (export schema `1.1`).

### Added
- Shares-only extraction: keeps `clip`, `xma_clip`, `media_share`,
  `xma_media_share`; drops all other message types, reactions, and reply context.
- Classification into `reel` / `post` / `carousel` with canonical
  `instagram.com/(reel|p)/<shortcode>/` URLs; decodes `l.instagram.com/?u=…`
  redirect shims before extracting the shortcode.
- Deduplication by shortcode with `shareCount` and a chronological
  `occurrences[]` timeline; `reel > carousel > post` precedence when the same
  media appears under multiple item types.
- Full (untruncated) captions.
- Media enrichment: `thumbnailUrl`, `videoDurationSec`, `audioTitle`,
  `audioArtist`, `likeCount`, `viewCount` where the payload exposes them.
- `skippedShares` diagnostics: per-item `reason` + `messageId` + `itemType`,
  plus a `summary.skippedByReason` rollup.
- Date-range windows: all / 1d / 7d / 30d / 6mo / 1yr / 2yr / custom, recorded
  in `extractionWindow`.
- Client-side JSON download via Blob; adaptive-backoff pagination over
  Instagram's private `direct_v2/threads/<id>/` endpoint.
