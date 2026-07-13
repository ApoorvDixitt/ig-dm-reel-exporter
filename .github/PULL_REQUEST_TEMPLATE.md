## Summary

What does this change, and why?

## Related issue

Closes #

## Checklist

- [ ] `npm run lint` passes and the extension loads in `chrome://extensions` with no manifest errors
- [ ] Parsing/classification changes are covered by a Node check against a synthetic payload
- [ ] Docs / `CHANGELOG.md` updated if behavior or the export schema changed
- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org)
- [ ] No new runtime dependencies; `extension/content/extractor.js` auth/pagination logic left intact (or re-tested against a live thread)
