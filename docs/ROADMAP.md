# Implementation status

## Completed foundation

- Consolidated v1.2 engineering specification with optional exact recording.
- Source-based Graylog 7.1.3 integration findings.
- Dependency-free browser evidence model, field diff/history and diagnostics.
- Local trace JSON import/export and illustrative flow viewer.
- Automated Node regression tests and GitHub Actions test workflow.

## Next: native read-only integration

1. Inspect official plugin skeleton and pin server/web build versions.
2. Implement authorized canonical message lookup and stored-facts REST response.
3. Register Trace Message action and mount the viewer inside Graylog.
4. Resolve current input, processor, stream and storage configuration with individual provenance and permissions.
5. Prove isolated native simulation before exposing Replay; preserve typed fields and replay input origin.
6. Add rule/timeline/event candidate views and YAML export.

## Later recording milestone

Prove an original-execution listener integration, then implement bounded collection, per-node policy/expiry, sampling, persistence, retention and completeness. Add recording controls only when the backend reports the corresponding capability. Follow with snapshots, historical replay, comparisons and live sessions.

## Current limitations

This is not a JAR or a Graylog plugin installation. It has no Graylog authentication/API integration, live collector, replay engine, recording persistence, snapshot storage or event analysis. Browser imports trust supplied labels and cannot certify historical truth. The local environment had Java 17 runtime but no compiler/Maven; package installation was unavailable. Browser behavior requires further integration testing; automated tests currently verify the model and fixture.
