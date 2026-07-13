# Export JSON Schema

`ig-dm-reel-exporter` produces one JSON document per extraction. This is the
field reference for **`schemaVersion` `1.1`** (emitted by `toolVersion`
`3.1.0`). A runnable sample lives at [`../examples/sample-export.json`](../examples/sample-export.json).

All timestamps come in two forms: `…At` is an ISO-8601 UTC string; `…AtUnix` is
integer **seconds** since the epoch. (Instagram's raw payload uses microseconds;
the extension normalizes them.)

## Top-level shape

```jsonc
{
  "schemaVersion": "1.1",
  "extraction":      { … },
  "source":          { … },
  "extractionWindow":{ … },
  "summary":         { … },
  "reels":       { "count": <int>, "items": [ <Item> ] },
  "posts":       { "count": <int>, "items": [ <Item> ] },
  "carousels":   { "count": <int>, "items": [ <Item> ] },
  "skippedShares": { "count": <int>, "items": [ <SkippedItem> ] }
}
```

`reels`, `posts`, and `carousels` are **always present**, even when empty
(`count: 0`, `items: []`).

### `extraction`

| Field | Type | Notes |
|-------|------|-------|
| `extractedAt` | string (ISO) | When the export was generated. |
| `extractedAtUnix` | int (seconds) | Same instant, epoch seconds. |
| `toolVersion` | string | Extension version that produced the file. |

### `source`

| Field | Type | Notes |
|-------|------|-------|
| `threadId` | string | Instagram thread id. |
| `chatWith` | string | Thread title, or participant usernames joined. |
| `participants` | string[] | Usernames; the viewer is `"me"`. |
| `viewerId` | number | The logged-in user's numeric id. |

### `extractionWindow`

| Field | Type | Notes |
|-------|------|-------|
| `mode` | string | One of `all`, `past_1_day`, `past_7_days`, `past_30_days`, `past_6_months`, `past_1_year`, `past_2_years`, `custom`. |
| `requestedStart` | string (ISO) \| null | Start of the requested window (null for `all`). |
| `requestedEnd` | string (ISO) \| null | End of the requested window. |
| `actualOldestShare` | string (ISO) \| null | Oldest kept share's timestamp (null if none). |
| `actualNewestShare` | string (ISO) \| null | Newest kept share's timestamp. |
| `messagesScanned` | int | Total thread items fetched before filtering. |

### `summary`

| Field | Type | Notes |
|-------|------|-------|
| `uniqueShares` | int | Distinct shortcodes kept. |
| `totalShareMessages` | int | Total kept share sends (`= Σ shareCount`). |
| `duplicatesInChat` | int | `totalShareMessages − uniqueShares`. |
| `skipped` | int | Share-type items that yielded no valid shortcode. |
| `skippedByReason` | object | `{ <reason>: <count> }` rollup (see reasons below). |
| `byCategory` | object | `{ reels, posts, carousels }` counts. |

Invariant: `totalShareMessages == uniqueShares + duplicatesInChat`, and
`skipped` is disjoint from all three category buckets.

## `Item`

```jsonc
{
  "shortcode": "DExAmPLe123",
  "url": "https://www.instagram.com/reel/DExAmPLe123/",
  "ownerUsername": "some.creator",     // nullable (often null for XMA cards)
  "caption": "full text, untruncated", // nullable
  "itemType": "clip",                  // clip | xma_clip | media_share | xma_media_share
  "shareCount": 2,
  "occurrences": [ <Occurrence> ],      // oldest → newest
  "firstSharedAt": "2026-01-04T18:22:10.000Z",  // nullable
  "lastSharedAt":  "2026-02-11T09:03:44.000Z",  // nullable
  "media": <Media>
}
```

- **Category** is implied by which bucket the item is in (`reels`/`posts`/`carousels`).
- **`itemType`** is the source Instagram type of the send that determined the
  item's category. When one shortcode is shared under several types, category is
  resolved by precedence **reel > carousel > post**.
- **URL** is canonical: reels use `/reel/<code>/`, posts and carousels use `/p/<code>/`.

### `Occurrence`

One entry per time the media was shared in the thread.

| Field | Type | Notes |
|-------|------|-------|
| `messageId` | string | The DM message item id. |
| `sharedBy` | string | Sender username, or `"me"`. |
| `sharedAt` | string (ISO) \| null | When it was sent (null if the payload lacked a timestamp). |
| `sharedAtUnix` | int (seconds) \| null | Same instant, epoch seconds. |

### `Media`

Best-effort enrichment from the DM payload. Every field is nullable; XMA cards
(`xma_clip` / `xma_media_share`) carry no media object, so all fields are null.

| Field | Type | Notes |
|-------|------|-------|
| `thumbnailUrl` | string \| null | Preview image (first carousel child for albums). |
| `videoDurationSec` | number \| null | Video length in seconds. |
| `audioTitle` | string \| null | Licensed track title, else original-audio title. |
| `audioArtist` | string \| null | Track artist, else the original-audio creator. |
| `likeCount` | number \| null | As present in the shared payload at share time. |
| `viewCount` | number \| null | `view_count`, else `play_count` / `ig_play_count`. |

> Media metadata (likes/views especially) reflects the payload **at the time of
> the share**, not the live current value. Treat it as approximate.

## `SkippedItem`

A share-type message that could not be resolved to a shortcode. Recorded so a
thin export is debuggable rather than silent.

| Field | Type | Notes |
|-------|------|-------|
| `messageId` | string | The DM message item id. |
| `itemType` | string | `clip` / `xma_clip` / `media_share` / `xma_media_share`. |
| `reason` | string | See below. |
| `sharedBy` | string | Sender username, or `"me"`. |
| `sharedAt` | string (ISO) \| null | When it was sent. |
| `sharedAtUnix` | int (seconds) \| null | Same instant, epoch seconds. |

### Skip reasons

| Reason | Meaning |
|--------|---------|
| `missing_media_object` | The share's media payload was absent — the media was likely deleted, made private, or is otherwise unavailable/expired. |
| `no_shortcode` | Media object was present but carried no `code`. |
| `missing_target_url` | An XMA card had no `target_url`. |
| `unresolvable_url` | An XMA `target_url` was present but no Instagram shortcode could be extracted (e.g. a non-Instagram link). |

> If `posts` or `carousels` is `0` but you expected shares there, check
> `skippedShares.items` for `media_share` / `xma_media_share` entries — that
> tells you whether they were dropped (with a reason) or simply weren't in the
> thread.
