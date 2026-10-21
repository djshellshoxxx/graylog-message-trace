# MT-007 — Standalone packaging and in-viewer live lookup

Status: **implemented** (`lib/server.js`, `lib/cli.js`, `lib/assets.js`, `scripts/build.mjs`, `.github/workflows/release.yml`).

## Scope
A single self-contained executable per platform (Node 22 Single Executable Application) that bundles the viewer assets, the read-only lookup CLI and a loopback web server. Targets: `linux-x64`, `windows-x64`, `macos-arm64`, `macos-x64`. This is **not** the native Graylog plugin.

## Commands
`graylog-trace serve [--port N]` · `graylog-trace fetch --url … --index … --id … [--out FILE]` · `--version`.

## Live lookup contract
- Enabled only when `GRAYLOG_URL` is set at startup; credentials come from `GRAYLOG_TOKEN` or `GRAYLOG_USER`+`GRAYLOG_PASSWORD`, read once, never sent to the browser. `GRAYLOG_ALLOW_HTTP=1` permits non-loopback HTTP.
- `POST /lookup` body `{"index","id"}` (≤4 KiB, `application/json`). The browser cannot select the Graylog host (no SSRF). Response: normalized trace (stored facts only, `OBSERVED`) or `{error}` with HTTP 502 (message only, no upstream body).
- `GET /health` → `{ok, lookup}`.

## Security controls
Binds `127.0.0.1` only; `Host` must be a loopback name on the bound port (DNS-rebinding defense); cross-origin `Origin` rejected; strict CSP (`default-src 'none'; script-src 'self'`), `nosniff`, `no-store`; read-only GET to Graylog, redirects refused, TLS required by default.

## Build and release
`npm run build` → `dist/graylog-trace-<target>[.exe]` (esbuild CJS bundle with base64 assets → SEA blob → postject). Tagging `v*` runs `release.yml`: tests, build, smoke test (`--version`, `/health`), archive, `SHA256SUMS.txt`, GitHub (pre)release. Binaries are **unsigned**; macOS builds are ad-hoc signed and may need `xattr -d com.apple.quarantine` / right-click Open; Windows SmartScreen will warn.

## Tests
`test/server.test.js`: headers, host rejection, traversal, lookup enabled/disabled, cross-origin, content-type, upstream error mapping, argument parsing.
