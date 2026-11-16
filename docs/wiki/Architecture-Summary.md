# Architecture Summary

From the README and `docs/features/00-SHARED-CONTRACT.md`.

- **Evidence model.** Each step has a label and provenance; field snapshots are paired before and after. Message identity is `(index, id)` (README).
- **Viewer.** A local JSON trace viewer in `web/` with processing flow, provenance labels, field history, diagnostics and export.
- **Graylog access.** `lib/graylog-api.js` and `lib/graylog-auth.js` perform permission-enforced single-message lookup for the CLI.
- **Format status.** The version 1 format is provisional until the server adapter is integrated (README).
