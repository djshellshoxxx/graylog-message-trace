# Graylog Message Trace

Explain the path of a Graylog message while keeping stored facts, recorded execution, and replay results distinct.

**Status: development foundation, not an installable Graylog plugin.** An optional read-only CLI can retrieve one authorized stored message through Graylog's REST API. The native plugin, exact recording, processing reconstruction and replay are not implemented.

## Available now

- Local JSON trace viewer with processing flow, provenance labels, field history, diagnostics, and JSON export.
- Permission-enforced single-message REST lookup and conversion to development trace JSON through a Node.js CLI (not a native plugin).
- Evidence model and field-diff tests, including absent/null values and partial recording.
- Engineering specification, version-specific integration findings, and implementation roadmap.

## Run

Requires Node.js 22+ for tests and Python 3 for the development web server. There are no npm dependencies.

```sh
npm test
npm run serve
```

Open http://localhost:8080 and choose **Load illustrative trace**, or open a trace JSON file. The example is synthetic. Imports stay in the browser; the example button fetches only the bundled local example. Imported evidence is not authenticated. The 5 MiB input limit bounds file size; use trusted exports during development.

The version 1 development format is illustrated in [web/example.json](web/example.json). Steps contain a label and provenance, optional nonnegative microsecond duration, and optional paired before/after field snapshots. The canonical message identity is `(index, id)`. This format is provisional until the server adapter is integrated.

## Read a stored message from Graylog (experimental)

With Node.js 22+, retrieve a message you are authorized to read. Graylog 7.1.3's single-message endpoint checks message and stream read permissions; the CLI does not bypass these checks. Credentials stay outside the URL and exported file.

```sh
export GRAYLOG_TOKEN='your-API-token'
node tools/trace-message.mjs --url https://graylog.example.org/api --index graylog_42 --id MESSAGE_ID --out message-trace.json
```

Open `message-trace.json` in the local viewer. The CLI makes **one read-only GET** to `/api/messages/{index}/{messageId}`. You must supply the physical index and ID; ID-only discovery and native message actions are not implemented. It refuses redirects and non-TLS connections by default. Localhost HTTP works; HTTP on another host requires explicit `--allow-http` and sends HTTP Basic credentials without TLS protection.

For password-based authentication, unset `GRAYLOG_TOKEN` and set both `GRAYLOG_USER` and `GRAYLOG_PASSWORD`. Graylog API access tokens authenticate as Basic `API_TOKEN:token` (the password is the literal word `token`). Never pass tokens on the command line, embed them in URLs, or commit them. `--out` creates a new file without overwriting; output contains potentially sensitive message fields. Without `--out`, JSON is printed to stdout.

Only the stored final document, physical index, and available persisted metadata are labeled `OBSERVED`. A stored input ID does not establish its historical configuration, and stored streams do not establish routing sequence. This adapter **does not** determine which pipelines or rules originally executed. HTTP failures are reported without printing server response bodies.

## Documentation

- [Engineering specification v1.2](docs/SPECIFICATION.md)
- [Graylog 7.1.3 integration research](docs/RESEARCH.md)
- [Implementation status and next steps](docs/ROADMAP.md)
- [Code and feature audit (2026-10-13)](docs/AUDIT-2026-10-13.md)

Never represent reconstruction as recording. A configuration snapshot alone does not recover the original input, lookup responses, processor state, or actual execution.
