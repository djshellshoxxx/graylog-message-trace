# MT-001 — Core Graylog Message Trace: native integration, investigation and recording feasibility

**Priority P0.** Status: specification. Initial compatibility: Graylog **7.1.3**, subject to real build and staging verification. The standalone viewer and read-only Node CLI exist; native plugin, original-execution instrumentation and replay isolation **do not** exist. Read this alongside `../SPECIFICATION.md` v1.2 and `00-SHARED-CONTRACT.md`.

## Problem and unique product requirement

Select any authorized message from Graylog search, then see a **per-message evidence-based journey**: stored facts, accessible current topology, original recorded processing *only where an actual proven recorder captured it*, unknown boundaries, error evidence, optional safe current replay. Do not claim that a replay or current topology proves what originally happened.

Do not reimplement Graylog's pipeline language, built-in simulator, native searches, processing-failure reporting or favorite fields. Reuse native interfaces where safe.

## Supported modes and gates

| Mode | Input | Output | Gating |
| --- | --- | --- | --- |
| `STORED_FACTS` (v0.1) | (physical index, message ID) | Stored final fields, input ID, final streams, index | Read-only authorized lookup, always available if message is readable |
| `CURRENT_TOPOLOGY` (v0.1) | Stored facts + authorized config | Current input/codec/processors/pipelines/streams/index relationships; each labeled RECONSTRUCTED | Explicit read permission for each object, no historical assertions |
| `CURRENT_REPLAY` (after isolation proof) | Deliberately selected source message state + current config | Native simulated rule results, deltas, timings, clearly replay-labelled | Safe sandbox and side-effect tests; explicit user action |
| `RECORDED_EXECUTION` (future) | Proven original-processor instrumentation | Captured callbacks / snapshots, completeness and loss | A proven supported live hook, bounded writer, opt-in, permissions |
| `HISTORICAL_REPLAY` (future) | Historical revision and captured initial state | Historical replay with missing external dependencies noted | Snapshot and isolation requirements satisfied |

The `Best Available` command may select an authorized mode but may **never automatically perform simulation with side effects**. If no safe replay exists, show stored facts and unresolved boundaries.

## Version-specific research gate

Graylog 7.1.3 `MessageResource` already implements `GET /messages/{index}/{messageId}` with message-read + stream-read authorization, and `SimulatorResource` provides a permission-checked simulation API. `PipelineInterpreter.process(Messages)` selects a metrics/no-op listener on its ordinary path; the overload accepting a custom listener is used by the simulator. **Neither alone proves live listener registration is possible.** Authoritative sources:
- https://github.com/Graylog2/graylog2-server/blob/7.1.3/graylog2-server/src/main/java/org/graylog2/rest/resources/messages/MessageResource.java
- https://github.com/Graylog2/graylog2-server/blob/7.1.3/graylog2-server/src/main/java/org/graylog/plugins/pipelineprocessor/rest/SimulatorResource.java
- https://github.com/Graylog2/graylog2-server/blob/7.1.3/graylog2-server/src/main/java/org/graylog/plugins/pipelineprocessor/processors/PipelineInterpreter.java
- https://go2docs.graylog.org/current/what_more_can_graylog_do_for_me/plugins.html

Use the official Graylog sample/archetype matching the pinned release. Do **not** invent stable ABI, JDK version, web extension hooks, permissions, or successful package installation. Verify them with an isolated 7.1.3 install and a minimal plugin that builds, loads and unloads.

## Server architecture and contracts

```text
Server (package org.graylog.plugins.messagetrace)
  RestResource [authorization at boundary]
     -> MessageResolver -> existing Graylog authorized message service
     -> InputResolver / ProcessorResolver / PipelineTopologyResolver
     -> StreamResolver / IndexResolver / EventEvidenceResolver
     -> EvidenceAssembler -> TraceV1 DTO
  SimulationAdapter [disabled until isolation proof]
  InstrumentationAdapter [UNSUPPORTED until hook feasibility proof]
  RecordingPolicy / bounded capture / retention [future, feature-gated]
Web action "Trace Message" -> server Trace DTO -> existing view selectors/UX
```

Interfaces (conceptual, Java signatures to be pinned with actual dependency classes):

```java
interface MessageResolver {
  AuthorizedMessage resolve(String physicalIndex, String messageId, ViewerContext user);
}
interface TopologyResolver {
  List<Claim> currentTopology(AuthorizedMessage message, ViewerContext user);
}
interface EvidenceAssembler {
  TraceEnvelope assemble(AuthorizedMessage message, List<Claim> authorizedClaims);
}
interface RecordingCapabilityProbe {
  Capability probe(NodeId node); // SUPPORTED / UNSUPPORTED / ERROR, with reasons
}
```

`AuthorizedMessage` must never be fetched from unrestricted OpenSearch indexes with administrator credentials. Resolve and recheck message and stream ACLs. Claim-level permissions for rule source, input properties, streams, index sets, events and historical captures are checked separately, at read **and export** time. Missing or deleted objects remain `UNKNOWN`/`UNRESOLVED`, not `NOT_EXECUTED`. Permission-hidden objects remain `REDACTED_BY_PERMISSION`.

API namespace is provisional and must be verified against Graylog's plugin REST registration; proposed routes are scoped to authorized operations:

| Request | Result | Fault behavior |
| --- | --- | --- |
| `GET /trace/{index}/{id}` | Canonical Trace v1 envelope with stored facts and available current claims | 400 invalid identity, 401 unauthenticated, 403 unauthorized, 404 inaccessible/nonexistent per policy, 503 backend unavailable |
| `POST /trace/resolve` | One or many candidate canonical identities (authorized only) | Ambiguity is returned as a selection set, not silently resolved |
| `GET /trace/{index}/{id}/capabilities` | Recording/simulation availability with explicit reasons | No phantom ACTIVE status |
| `POST /trace/replay` | **Only after isolation proof**; explicit mode and input-origin metadata | 409 unsupported/unsafe, 403 not permitted |
| `GET /trace/{index}/{id}/export` | Reauthorized/redacted evidence | No credentials or secret-bearing config exported |

REST DTO must expose `schema_version`, `source`, `message(index,id,fields)`, `steps`, `capture`, `visibility`, optional `replay_input`. All returned claims carry typed provenance and timestamps/revisions when genuinely available. Avoid serializing Java entities directly.

## UI integration

Add **Trace Message** to the message action menu if supported by the pinned web API; if no stable hook is available, use a separate plugin page that accepts physical index+ID, without patching Graylog core UI. Header: message identity and source, trust/provenance, mode picker, reasoned disabled replay/recording, export. Sections: Flow, Fields/Journey, Evidence Coverage, Rules, Streams, Storage, Diagnostics. Unavailable sections show unavailable states, never fake simulated data. Context links open native Graylog objects only when authorized and target object exists.

## Native recording proof (standalone feasibility spike before implementation)

1. Build and load minimal Graylog 7.1.3 plugin in **isolated staging**; identify whether the official processor extension or any supported listener can attach to the live pipeline interpreter **without replacing the processor or executing twice**.
2. Instrument trace for a unique controlled message across codec/extractor, processor, stage/rule, stream routing and index boundaries. Document **exact boundaries proven** and those not exposed.
3. Confirm live processing results, acknowledgement, metrics, errors and indexing match baseline with recording OFF and ON. Compare known reproducible fixtures.
4. Test concurrent pipelines, stream changes and cloned/dropped messages. Preserve actual callback order with per-node sequence/parent IDs; do not invent global ordering.
5. If unsupported, ship `STORED_FACTS + CURRENT_TOPOLOGY` and mark `RECORDED_EXECUTION=UNSUPPORTED`; upstream integration proposal is a separate follow-up, not a hidden hack.

**Do not build the persistent collector until the spike passes.** If proved possible, recorder defaults OFF; supports selected input IDs first, opt-in bounded queue with backpressure-free loss markers, per-node fail-closed temporary expiry, sampling, 7-day default retention, quota limits, redaction and health metrics. A late-selected stream cannot claim earlier capture without buffered evidence. Completion attestation needs known boundary, revisions, node coverage and loss counters; "partial" persists explicitly.

## Replay isolation proof (independent gate)

Existing simulator code takes a message, adds stream, executes `PipelineInterpreter.process` with custom tracer. Despite official simulation support, investigate custom functions capable of network/file/external writes, acknowledgements, metrics and shared state before using it as safe arbitrary replay. Maintain an explicit allowed-function capability policy. Reject a replay with precise reasons if isolation is not provable. Preserve typed fields, original input origin, stream state and exact config revision when available. Never present replay as recorded history.

## Delivery milestones and dependency graph

- **M0** — Pin actual server/web dependencies; minimal plugin compiles, install/load/unload on 7.1.3, no side effects, documented JDK/toolchain.
- **M1** — MessageResolver with permission matrix; action/deeplink or fallback page; DTO compatibility with existing viewer, read-only.
- **M2** — Topology resolvers and scoped claims; missing/deleted/permission-hidden cases. Add trace widgets from MT-002–MT-006 using existing normalized model.
- **M3** — Isolated simulation feasibility; enable only proved-safe usage.
- **M4** — Instrumentation feasibility spike; if supported, collect bounded original execution without altering live pipeline semantics.
- **M5** — Recorded-trace storage/retention, policies, auditing, diagnostics, per-node status and expiry.
- **M6** — Historical snapshots, comparison, event linking, performance and packaging hardening.

Work streams: server authorization/DTO, viewer widgets, validation/testing, and staging research can proceed separately if shared data contracts are frozen; merge each small passing PR back to main before building downstream features. No orphan branches.

## Tests and acceptance gates

- Unit: identity/URL validation, canonical index not current write alias, null-vs-absent, typed fields, source/visibility, stage ordering, clone lineage, unknown vs failure, topology cycles.
- Native integration: 7.1.3 install, read permitted/denied streams (plus mixed streams), deleted object, stale permissions after trace saved, 401/403/404/503, unauthorized rule source, reverse-proxy path, huge field values, no credentials in logs.
- Replay isolation: custom function that attempts observable side effect must be blocked; no original message mutation; error/timeouts have evidence, not false successful replay.
- Recorder feasibility: OFF unchanged throughput, supported listener, no double processing or acknowledgement, bounded loss reporting, crash/restart/session expiry, cluster node gaps. Collect baseline performance numbers rather than fabricate thresholds.
- UI: direct action, deep links, permission redaction, keyboard focus, distinguish current config vs history, no XSS from arbitrary message fields, offline imported-file mode unaffected.
- Exit condition M1: signed-off permission tests, working build/load in pinned staging, a real authorized message opens within plugin and all unavailable execution components show `UNKNOWN`/`UNSUPPORTED`. "Installable alpha" requires these checks, not just a JAR build.

## Out of scope for the first alpha

Historical replay, instrumentation claims without hook proof, arbitrary debugger pausing live threads, generic search UI, duplicating native rule parsing, unrestricted direct index searches, silent writes to production configuration, enabling recording in production before operator approval.
