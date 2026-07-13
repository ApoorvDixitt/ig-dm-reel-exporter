# Contributing

Thanks for your interest in improving **ig-dm-reel-exporter**!

This is a small, vanilla-JavaScript Manifest V3 extension with **no build step** and **no runtime dependencies**. Keep it that way unless there's a strong reason not to.

## Development setup

```bash
git clone https://github.com/ApoorvDixitt/ig-dm-reel-exporter.git
cd ig-dm-reel-exporter
npm install        # dev tooling only (web-ext) — the extension itself ships no deps
npm start          # launch a Chromium profile with extension/ loaded
```

Or just load it manually: `chrome://extensions` → **Developer mode** → **Load unpacked** → select `extension/`.

### Checks before you push

```bash
npm run lint                                   # web-ext lint of extension/
node --check extension/content/parser.js       # (and the other .js files) — syntax
```

The parser is pure, dependency-free JavaScript, so its logic can be exercised in Node without a browser (load `extension/content/parser.js`, feed a synthetic thread payload to `ChatParser.parseShare` + `ChatParser.buildCategorizedOutput`, and assert on the output). Please add or update such checks when you change parsing/classification.

## Workflow

1. Create a branch off `main`: `feat/short-description` or `fix/short-description`.
2. Make atomic commits using [Conventional Commits](https://www.conventionalcommits.org): `feat(parser): …`, `fix(popup): …`, `docs: …`, `chore(ci): …`.
3. Ensure lint passes and the extension loads without manifest errors.
4. Open a pull request, fill in the template, and link any related issue.
5. The maintainer squash-merges once checks pass and the review is approved. `main` keeps a linear history.

## Scope

The extension's job stops at the browser: extract shared links + the metadata Instagram already returns in the DM payload, and emit clean JSON. Deeper enrichment (reel transcripts, on-screen text, re-fetching live stats) is intentionally **out of scope** — that belongs to whatever consumes the export. PRs that add heavy tooling, build systems, or runtime dependencies will likely be asked to slim down.

Do not change the auth / `X-IG-WWW-Claim` / pagination / backoff logic in `extension/content/extractor.js` without a clear reason and manual re-testing against a live thread — it is the fragile, rate-limit-sensitive part.

## Reporting bugs / requesting features

Open an issue using the provided templates. Because Instagram changes its private payload shapes, bug reports about missing/mis-classified shares are most useful when they include the `itemType` and `skippedShares` reasons from an export (with any private URLs/usernames redacted).

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
