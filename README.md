# Graylog Message Trace

Explain the path of a Graylog message while keeping stored facts, recorded execution, and replay results distinct.

**Status: development foundation, not an installable Graylog plugin.** No production Graylog configuration is modified. Exact recording, Graylog API access, and native simulation are not implemented yet.

## Available now

- Local JSON trace viewer with processing flow, provenance labels, field history, diagnostics, and JSON export.
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

## Documentation

- [Engineering specification v1.2](docs/SPECIFICATION.md)
- [Graylog 7.1.3 integration research](docs/RESEARCH.md)
- [Implementation status and next steps](docs/ROADMAP.md)

Never represent reconstruction as recording. A configuration snapshot alone does not recover the original input, lookup responses, processor state, or actual execution.
