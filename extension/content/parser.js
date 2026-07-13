/**
 * Share parsing + categorization.
 *
 * Keeps ONLY shared media items (reels / posts / carousels) from a DM thread,
 * extracts each media shortcode, and builds a deduplicated, categorized JSON
 * export suitable for knowledge-base import.
 *
 * Shared execution context with other content scripts.
 */

/* exported ChatParser */
// eslint-disable-next-line no-var
var ChatParser = (() => {
  'use strict';

  // The only item_types we care about. Everything else is dropped silently.
  const SHARE_ITEM_TYPES = new Set([
    'clip', 'xma_clip', 'media_share', 'xma_media_share',
  ]);

  // Category precedence for resolving conflicts when the SAME shortcode is
  // shared under different item_types (e.g. once as `clip`, once as
  // `media_share`). Higher wins — a reel is authoritative over a plain post.
  const CATEGORY_RANK = { reel: 3, carousel: 2, post: 1 };

  // Enrichment fields that get merged (first non-null wins) across occurrences.
  const MEDIA_FIELDS = ['thumbnailUrl', 'videoDurationSec', 'audioTitle', 'audioArtist', 'likeCount', 'viewCount'];

  // Instagram media timestamps are MICROSECONDS since epoch.
  const MICROS_PER_SECOND = 1_000_000;

  function unixSecondsFromMicros(tsMicro) {
    return tsMicro ? Math.floor(tsMicro / MICROS_PER_SECOND) : 0;
  }

  function isoFromMicros(tsMicro) {
    if (!tsMicro) return null;
    // micros -> millis for the Date constructor.
    return new Date(tsMicro / 1000).toISOString();
  }

  function isoFromUnixSeconds(unixSecs) {
    return unixSecs == null ? null : new Date(unixSecs * 1000).toISOString();
  }

  function finiteNumber(v) {
    return typeof v === 'number' && isFinite(v) ? v : null;
  }

  function buildUserMap(threadInfo, myUserId) {
    const userMap = {};
    for (const u of (threadInfo.users || [])) {
      const pk = u.pk ?? u.pk_id;
      if (pk != null) {
        userMap[Number(pk)] = u.username || `user_${pk}`;
      }
    }
    userMap[myUserId] = 'me';

    const inviter = threadInfo.inviter;
    if (inviter) {
      const pk = inviter.pk;
      if (pk && Number(pk) !== myUserId) {
        userMap[Number(pk)] = inviter.username || `user_${pk}`;
      }
    }
    return userMap;
  }

  /**
   * Resolve an l.instagram.com/?u=<encoded> redirect shim to the real URL.
   * Handles the (rare) double-encoded case defensively.
   */
  function resolveRedirect(rawUrl) {
    if (!rawUrl) return rawUrl;
    try {
      const parsed = new URL(rawUrl);
      if (parsed.hostname && parsed.hostname.includes('instagram.com')) {
        const u = parsed.searchParams.get('u');
        if (u) {
          let decoded = decodeURIComponent(u);
          // If still wrapped/encoded, decode one more time.
          if (/%25|l\.instagram\.com/i.test(decoded)) {
            try { decoded = decodeURIComponent(decoded); } catch (_) { /* keep first decode */ }
          }
          return decoded;
        }
      }
    } catch (_) { /* not a parseable URL — fall through */ }
    return rawUrl;
  }

  /**
   * Pull an Instagram shortcode out of a URL. Accepts /reel/, /reels/, /p/
   * and /tv/ paths. Trailing query strings (?igsh=…) are naturally excluded
   * by the charset. Returns the shortcode string, or null if none found.
   */
  function shortcodeFromUrl(rawUrl) {
    if (!rawUrl) return null;
    const resolved = resolveRedirect(rawUrl);
    const match = resolved.match(/\/(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
  }

  function canonicalUrl(category, shortcode) {
    if (category === 'reel') {
      return `https://www.instagram.com/reel/${shortcode}/`;
    }
    // post + carousel share the /p/ permalink form.
    return `https://www.instagram.com/p/${shortcode}/`;
  }

  // Full caption text (no truncation — the caption is the KB's richest text
  // signal, so hashtags / long bodies must survive intact).
  function captionText(captionObj) {
    return captionObj && captionObj.text ? captionObj.text : null;
  }

  function emptyMediaMeta() {
    return {
      thumbnailUrl: null,
      videoDurationSec: null,
      audioTitle: null,
      audioArtist: null,
      likeCount: null,
      viewCount: null,
    };
  }

  /**
   * Best-effort enrichment pulled from a raw clip/media_share media object.
   * Every field is optional — anything absent stays null. XMA cards carry no
   * media object, so they get all-nulls.
   */
  function extractMediaMeta(media) {
    const meta = emptyMediaMeta();
    if (!media || typeof media !== 'object') return meta;

    // Thumbnail (fall back to the first carousel child for albums).
    const candidates = media.image_versions2 && media.image_versions2.candidates;
    if (Array.isArray(candidates) && candidates.length) {
      meta.thumbnailUrl = candidates[0].url || null;
    }
    if (!meta.thumbnailUrl && Array.isArray(media.carousel_media) && media.carousel_media.length) {
      const child = media.carousel_media[0];
      const childCandidates = child && child.image_versions2 && child.image_versions2.candidates;
      if (Array.isArray(childCandidates) && childCandidates.length) {
        meta.thumbnailUrl = childCandidates[0].url || null;
      }
    }

    meta.videoDurationSec = finiteNumber(media.video_duration);
    meta.likeCount = finiteNumber(media.like_count);
    // Reels report plays; prefer view_count, then play_count / ig_play_count.
    meta.viewCount = finiteNumber(media.view_count)
      ?? finiteNumber(media.play_count)
      ?? finiteNumber(media.ig_play_count);

    const cm = media.clips_metadata;
    if (cm && typeof cm === 'object') {
      const licensed = cm.music_info && cm.music_info.music_asset_info;
      if (licensed) {
        meta.audioTitle = licensed.title || null;
        meta.audioArtist = licensed.display_artist || null;
      }
      if (!meta.audioTitle && cm.original_sound_info) {
        const osi = cm.original_sound_info;
        meta.audioTitle = osi.original_audio_title || null;
        meta.audioArtist = (osi.ig_artist && osi.ig_artist.username) || null;
      }
    }

    return meta;
  }

  function firstXmaElement(value) {
    if (Array.isArray(value)) return value.length ? value[0] : null;
    return value || null;
  }

  /**
   * Parse a single thread item into a normalized "share candidate".
   *
   * Returns:
   *   - null                                    → not a share-type item (dropped)
   *   - { valid: false, skipReason, ... }       → share item with NO shortcode (counts as skipped)
   *   - { valid: true, shortcode, category, …}  → usable share
   *
   * `timestampUnix` (seconds) is always present so content.js can date-filter
   * before we tally skipped/occurrences.
   *
   * skipReason values:
   *   - 'missing_media_object' → the media payload was absent (media likely deleted / unavailable / expired)
   *   - 'no_shortcode'         → media object present but carried no code
   *   - 'missing_target_url'   → XMA card had no target_url
   *   - 'unresolvable_url'     → XMA target_url present but no Instagram shortcode could be extracted
   */
  function parseShare(item, myUserId, userMap) {
    const itemType = item.item_type || '';
    if (!SHARE_ITEM_TYPES.has(itemType)) return null;

    const ts = item.timestamp || 0; // microseconds
    const userId = item.user_id || 0;
    const sharedBy = Number(userId) === myUserId
      ? 'me'
      : (userMap[Number(userId)] || `user_${userId}`);

    let shortcode = null;
    let category = null;
    let ownerUsername = null;
    let caption = null;
    let media = emptyMediaMeta();
    let skipReason = null;

    switch (itemType) {
      case 'clip': {
        const clip = (item.clip && item.clip.clip) || null;
        if (!clip) {
          skipReason = 'missing_media_object';
        } else {
          shortcode = clip.code || null;
          ownerUsername = (clip.user && clip.user.username) || null;
          caption = captionText(clip.caption);
          media = extractMediaMeta(clip);
          if (!shortcode) skipReason = 'no_shortcode';
        }
        category = 'reel';
        break;
      }

      case 'media_share': {
        const shared = item.media_share || null;
        if (!shared) {
          skipReason = 'missing_media_object';
          category = 'post';
        } else {
          shortcode = shared.code || null;
          ownerUsername = (shared.user && shared.user.username) || null;
          caption = captionText(shared.caption);
          media = extractMediaMeta(shared);
          category = shared.media_type === 8 ? 'carousel' : 'post';
          if (!shortcode) skipReason = 'no_shortcode';
        }
        break;
      }

      case 'xma_clip': {
        // XMA cards expose the media only via a (possibly redirect-wrapped)
        // target_url; owner/caption/enrichment are not present -> left null.
        const xma = firstXmaElement(item.xma_clip);
        if (!xma || !xma.target_url) {
          skipReason = 'missing_target_url';
        } else {
          shortcode = shortcodeFromUrl(xma.target_url);
          if (!shortcode) skipReason = 'unresolvable_url';
        }
        category = 'reel';
        break;
      }

      case 'xma_media_share': {
        // No reliable carousel signal in XMA cards -> always classify as post.
        const xma = firstXmaElement(item.xma_media_share);
        if (!xma || !xma.target_url) {
          skipReason = 'missing_target_url';
        } else {
          shortcode = shortcodeFromUrl(xma.target_url);
          if (!shortcode) skipReason = 'unresolvable_url';
        }
        category = 'post';
        break;
      }

      default:
        return null;
    }

    const timestampUnix = unixSecondsFromMicros(ts);
    const base = {
      itemType,
      messageId: item.item_id || '',
      sharedBy,
      timestampUnix,                         // seconds; 0 when missing (used for filtering)
      sharedAt: isoFromMicros(ts),           // ISO or null when timestamp missing
      sharedAtUnix: ts ? timestampUnix : null,
    };

    if (!shortcode) {
      // Share-type item that yielded no usable shortcode → counted as skipped.
      return {
        ...base,
        valid: false,
        skipReason: skipReason || 'no_shortcode',
        shortcode: null,
        category: null,
        url: null,
        ownerUsername: null,
        caption: null,
        media: emptyMediaMeta(),
      };
    }

    return {
      ...base,
      valid: true,
      shortcode,
      category,
      url: canonicalUrl(category, shortcode),
      ownerUsername,
      caption,
      media,
    };
  }

  function resolveTitle(threadInfo) {
    let title = threadInfo.thread_title || '';
    if (!title) {
      const users = threadInfo.users || [];
      title = users.map(u => u.username || '?').join(', ');
    }
    return title;
  }

  function buildParticipants(userMap, myUserId) {
    const participants = [];
    for (const [uid, uname] of Object.entries(userMap)) {
      if (Number(uid) === myUserId) {
        participants.unshift('me');
      } else {
        participants.push(uname);
      }
    }
    return participants;
  }

  /**
   * Build the categorized export from a chronological (oldest→newest) list of
   * share candidates. Dedupes by shortcode; every send is recorded as an
   * occurrence. reels/posts/carousels are ALWAYS present.
   *
   * @param {object} meta { window: {mode, requestedStart, requestedEnd}, messagesScanned }
   */
  function buildCategorizedOutput(threadInfo, shares, myUserId, userMap, meta) {
    const byShortcode = new Map();
    const skippedItems = [];
    const skippedByReason = {};
    let totalShareMessages = 0;

    // shares arrive oldest→newest, so the first time we see a shortcode is its
    // earliest send — that occurrence seeds owner/caption/itemType/category.
    for (const s of shares) {
      if (!s.valid) {
        const reason = s.skipReason || 'no_shortcode';
        skippedByReason[reason] = (skippedByReason[reason] || 0) + 1;
        skippedItems.push({
          messageId: s.messageId,
          itemType: s.itemType,
          reason,
          sharedBy: s.sharedBy,
          sharedAt: s.sharedAt,
          sharedAtUnix: s.sharedAtUnix,
        });
        continue;
      }
      totalShareMessages++;

      const occurrence = {
        messageId: s.messageId,
        sharedBy: s.sharedBy,
        sharedAt: s.sharedAt,
        sharedAtUnix: s.sharedAtUnix,
      };

      let entry = byShortcode.get(s.shortcode);
      if (!entry) {
        entry = {
          shortcode: s.shortcode,
          category: s.category,
          itemType: s.itemType,
          ownerUsername: s.ownerUsername,
          caption: s.caption,
          media: { ...s.media },
          occurrences: [],
        };
        byShortcode.set(s.shortcode, entry);
      } else {
        // Category conflict across sends → highest precedence wins, and the
        // itemType that established it is adopted for the export item.
        if (CATEGORY_RANK[s.category] > CATEGORY_RANK[entry.category]) {
          entry.category = s.category;
          entry.itemType = s.itemType;
        }
        // Backfill owner/caption/media fields if a later send has them.
        if (!entry.ownerUsername && s.ownerUsername) entry.ownerUsername = s.ownerUsername;
        if (!entry.caption && s.caption) entry.caption = s.caption;
        for (const f of MEDIA_FIELDS) {
          if (entry.media[f] == null && s.media[f] != null) entry.media[f] = s.media[f];
        }
      }

      entry.occurrences.push(occurrence);
    }

    const reels = [];
    const posts = [];
    const carousels = [];
    let actualOldestUnix = null;
    let actualOldestIso = null;
    let actualNewestUnix = null;
    let actualNewestIso = null;

    for (const entry of byShortcode.values()) {
      // Order occurrences oldest→newest; timestamp-less sends go last.
      const dated = entry.occurrences.filter(o => o.sharedAtUnix != null);
      const undated = entry.occurrences.filter(o => o.sharedAtUnix == null);
      dated.sort((a, b) => a.sharedAtUnix - b.sharedAtUnix);
      const occurrences = dated.concat(undated);

      const first = dated.length ? dated[0] : null;
      const last = dated.length ? dated[dated.length - 1] : null;

      if (first && (actualOldestUnix == null || first.sharedAtUnix < actualOldestUnix)) {
        actualOldestUnix = first.sharedAtUnix;
        actualOldestIso = first.sharedAt;
      }
      if (last && (actualNewestUnix == null || last.sharedAtUnix > actualNewestUnix)) {
        actualNewestUnix = last.sharedAtUnix;
        actualNewestIso = last.sharedAt;
      }

      const exportItem = {
        shortcode: entry.shortcode,
        url: canonicalUrl(entry.category, entry.shortcode),
        ownerUsername: entry.ownerUsername ?? null,
        caption: entry.caption ?? null,
        itemType: entry.itemType,
        shareCount: occurrences.length,
        occurrences,
        firstSharedAt: first ? first.sharedAt : null,
        lastSharedAt: last ? last.sharedAt : null,
        media: entry.media,
      };

      if (entry.category === 'reel') reels.push(exportItem);
      else if (entry.category === 'carousel') carousels.push(exportItem);
      else posts.push(exportItem);
    }

    const uniqueShares = byShortcode.size;
    const duplicatesInChat = totalShareMessages - uniqueShares;
    const skipped = skippedItems.length;

    const windowMeta = (meta && meta.window) || {};
    const now = new Date();

    return {
      schemaVersion: '1.1',
      extraction: {
        extractedAt: now.toISOString(),
        extractedAtUnix: Math.floor(now.getTime() / 1000),
        toolVersion: '3.1.0',
      },
      source: {
        threadId: threadInfo.thread_id || '',
        chatWith: resolveTitle(threadInfo),
        participants: buildParticipants(userMap, myUserId),
        viewerId: threadInfo.viewer_id || myUserId,
      },
      extractionWindow: {
        mode: windowMeta.mode || 'all',
        requestedStart: windowMeta.requestedStart ?? null,
        requestedEnd: windowMeta.requestedEnd ?? null,
        actualOldestShare: actualOldestIso ?? isoFromUnixSeconds(actualOldestUnix),
        actualNewestShare: actualNewestIso ?? isoFromUnixSeconds(actualNewestUnix),
        messagesScanned: (meta && meta.messagesScanned) || 0,
      },
      summary: {
        uniqueShares,
        totalShareMessages,
        duplicatesInChat,
        skipped,
        skippedByReason,
        byCategory: {
          reels: reels.length,
          posts: posts.length,
          carousels: carousels.length,
        },
      },
      reels: { count: reels.length, items: reels },
      posts: { count: posts.length, items: posts },
      carousels: { count: carousels.length, items: carousels },
      skippedShares: { count: skipped, items: skippedItems },
    };
  }

  return {
    buildUserMap,
    parseShare,
    buildCategorizedOutput,
    // exported for potential reuse / testing
    resolveRedirect,
    shortcodeFromUrl,
    canonicalUrl,
    extractMediaMeta,
  };
})();
