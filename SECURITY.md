# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| latest (`main`) | ✅ |
| older tags | ❌ |

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Report privately via GitHub's **"Report a vulnerability"** button (repository **Security** tab → **Advisories** → *Report a vulnerability*). If that is unavailable, open a minimal public issue asking the maintainer to enable private reporting — without including any exploit details.

Please include: what the issue is, how to reproduce it, and the potential impact. I aim to acknowledge reports within 7 days.

## Scope and data handling

This extension runs entirely in your browser. It uses **your own** authenticated Instagram session cookies to call Instagram's private web API and writes the resulting JSON to a local download. It does **not** transmit your data, cookies, or session to any third-party server, and it has no analytics or telemetry.

Security-relevant things worth reporting include: any path by which the extension could leak session cookies or the extracted data off-device, an injection vector in the popup or content scripts, or over-broad permissions in `manifest.json`.
