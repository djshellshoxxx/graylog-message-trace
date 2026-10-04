# Message Trace engineering specification v1.2

Repository: `graylog-message-trace`. Display name: Message Trace. Planned Java package: `org.graylog.plugins.messagetrace`. Initial compatibility target: Graylog 7.1.3; compatibility is not yet certified.

This document carries forward the supplied v1.1 product scope in a consolidated implementation specification. Requirements below describe the target product; README and ROADMAP describe what exists. Version 1.2 corrects replay confidence, partial capture, late stream selection, simulation isolation, and recording integration assumptions.

## Product and evidence contract

Start with an indexed message and explain input, processor order, pipelines, stages, rules, field mutations, stream routing, physical index, event relationships, and diagnostics. Normal tracing is read-only. Never modify the original document or production processing configuration. What-if processing uses a detached copy in an isolated executor.

Every result and export carries provenance:

| Status | Meaning |
|---|---|
| OBSERVED | Stored message or authoritative persisted metadata |
| RECORDED | Captured during original execution at a stated boundary |
| HISTORICAL_REPLAY | Executed again with a historical configuration snapshot |
| CURRENT_REPLAY | Executed again with current configuration |
| RECONSTRUCTED | Derived relationship between authoritative objects |
| INFERRED | Plausible explanation, not established fact |
| UNKNOWN | Insufficient evidence |

Authorization redaction is a separate visibility state, `REDACTED_BY_PERMISSION`, never an indication that an inaccessible object does not exist. A current input name/configuration resolved from a stored input ID is not automatically historical OBSERVED configuration.

Overall confidence may be EXACT, HIGH, MEDIUM, or LOW, but cannot replace per-claim provenance and coverage. EXACT requires verified original recording with complete coverage for the declared boundary, no dropped/truncated spans, and known configuration revision. Pipeline-only recording cannot claim exact input-to-index coverage. Replay never proves historical execution. A stored final document and historical configuration alone do not justify HIGH historical confidence. The standalone importer displays evidence summaries rather than certifying imported confidence claims.

Trace metadata must carry capture boundary, completeness, loss/truncation reasons, Graylog and adapter versions, configuration revisions, input origin, and missing prerequisites. Sequence numbers preserve actual callback order. Stage priorities are numeric; never sort recorded events by stage number after capture. Concurrent pipelines must not acquire invented serial causality.

## Message resolution and topology

Accept index plus message ID, message ID alone, Graylog message URL, search context action, or message action **Trace Message**. Resolve to `(index, message_id)` with permission checks. Ambiguous ID-only matches require selection. Retained traces of dropped/unindexed messages use a separate trace ID, node/ingestion identity, and explicit indexing status; do not invent a physical index.

Resolve available stored metadata such as input/node IDs, sender, timestamps, final stream IDs, errors, and physical index. Metadata availability and field names must be validated for each supported version. Resolve input type, bind address, port, codec, extractors, static fields, source override, node, processor order, pipeline connections, streams, index sets, retention, and event definitions. Missing/deleted objects remain visible as unresolved references. Physical index, index set configuration, and current write index are distinct claims. Represent multiple index destinations if applicable.

Build topology with cycle detection and bounded node/edge counts. A topology cycle is not proof of repeated live execution. Preserve created/cloned/dropped message lineage. Do not deduplicate separate executions merely because rule IDs match.

## Replay and best available mode

Modes: Best Available, Recorded, Historical Replay, Current Replay, Stored Facts Only. Prefer complete authorized recording, then eligible historical replay, then current replay, then stored facts. Never automatically perform unsafe or unavailable replay. Partial recordings remain accessible with their coverage stated.

Reuse Graylog's native interpreter and simulator; do not implement another pipeline language. Adapter contracts normalize rule evaluations, matches, execution failures, field changes, routing, lineage, and timings. A final indexed document is not the original incoming message. Label replay input as raw captured input, preprocessor snapshot, or final document. Show missing codec/extractor history and initial stream state. Preserve field types; do not silently stringify dates or numeric values.

Historical snapshots do not capture historical lookup contents or arbitrary function effects. Record these dependencies where supported; otherwise mark them unavailable or substituted. Configuration revisions must reflect state active on the executing node, not simply the nearest wall-clock snapshot.

Simulation must isolate message mutation, indexing, queue acknowledgements, production counters where possible, outputs, notifications, and external writes from custom functions. Enforce time, memory, output-message, and function capability limits. If isolation cannot be guaranteed, disable the operation with a specific reason. Do not invoke the live interpreter entry point on an indexed message merely because it accepts a custom listener.

## Optional exact recording

Exact recording defaults OFF. Disabling it never disables stored facts or permitted replay. Location: System → Configurations → Message Trace. Show support status separately from enabled status. An unsupported adapter cannot enable recording or report ACTIVE.

Scope modes: disabled, all messages, selected inputs, selected streams, compiled filter, sampling, and temporary debug sessions. Use immutable object IDs in configuration; names are display labels. Support optional sampling combined with a scope. Validate finite rates between 0 and 1; define deterministic per-message hash sampling separately from every-N sampling. Document the filter grammar instead of promising full search-engine query semantics over an in-memory message.

Temporary options: 5, 15, 30, 60 minutes or explicit manual stop. Persist an absolute UTC expiry; enforce it on every participating node including after restart. Display ACTIVE/STOPPED/EXPIRED/UNSUPPORTED/PARTIAL and per-node acknowledgements, remaining time, effective scope, and Stop Recording. Start/stop operations require separate administrative permission and an audit entry. A cluster partition must not extend a temporary session.

Input selection can occur before processing. A stream assigned late cannot retroactively activate earlier instrumentation: either use a bounded provisional buffer for a preselected superset and retain matching traces, or clearly label capture as beginning at the matching boundary. Filter and pipeline/rule-based live selection have the same late-selection issue. Sampling happens before expensive collection where possible.

Capture rule condition evaluation/result, action start/end/error, before/after field changes, stream membership changes, created/dropped messages, processor/stage/pipeline boundaries, relative monotonic timing, node identity, revisions, and completeness. Capture values under redaction and size/depth limits. A null value and absent field are different. Rule-level deltas do not prove which expression or lookup caused a change without additional instrumentation.

Dedicated trace storage is separate from normal messages. Defaults: 7-day traces and 90-day configuration snapshots, configurable with quotas and referential retention rules. Bounded queues and asynchronous persistence drop diagnostic data before blocking ingestion. Mark loss, partial capture and eviction; never silently promote incomplete records to EXACT. Guard against recursive tracing of trace-storage traffic. Bound per-message events/bytes, queue bytes, and session throughput.

Health: evaluated, matched, recorded, sampled-out, dropped and written counts, queue depth/bytes, storage use, instrumentation overhead distributions, node coverage, expiry and persistence failures. Measure overhead in staging under representative load before deployment; do not publish invented benchmark figures.

## Snapshots and comparison

Content-address configuration snapshots: pipelines, rules, stages, stream connections/rules, inputs/extractors/static fields, processor order, streams, index sets, event definitions, and lookup configuration metadata. Exclude credentials and secret-bearing settings. Deduplicate unchanged objects, retain a revision manifest with capture completeness, and preserve revision references while traces need them.

Support Recorded/Historical/Current views and pairwise comparisons, message-to-message comparisons, rule-source diff and field-value diff. Missing evidence is not a negative execution result. Display changes between ingestion time and known configuration revision without assuming cluster-wide atomic updates.

## Investigation UI

Tabs: Flow, Timeline, Fields, Rules, Streams, Storage, Events, Diagnostics, Raw Trace. Header: canonical identity, mode, confidence/coverage, Replay, Compare, Export. Use accessible keyboard controls and text labels in addition to colors; escape all message/rule content.

Field view lists creation/modification/removal with producer, pipeline/stage, before/after, timing and provenance. Trace Field answers why a field exists or is missing only to the extent supported. Rule view distinguishes not reached, evaluated false, matched, executed, failed, and unknown; provide Open Rule, View Source, matching-message search where representable, field trace and isolated replay. Never translate arbitrary rule code into an allegedly equivalent search query.

Routing view shows membership origin and source rule when recorded; final stored membership alone does not establish routing history. Timeline labels simulation timings prominently. Performance view identifies slow rules/lookups only with relevant evidence and comparison baselines.

Diagnostics: overwritten fields, type changes, missing lookup responses, topology cycles, processor dependency conflicts, errors, hotspots, failed/unreached rules, missing expected fields, multiple writers, changed configuration, and event filter/stream mismatch. Static analysis produces possibilities, not asserted execution causes. Unknown is a useful result.

What-if edits are detached copies. Live debug waits for a scoped match under a temporary recording policy, then opens the captured trace. Future step-rule/stage debugger runs only in isolated replay; never pause live ingestion threads.

## Events

Statuses: FILTER_MATCH, FILTER_NO_MATCH, AGGREGATION_CONTRIBUTOR, EVENT_CONFIRMED, EVENT_NOT_CONFIRMED, CORRELATION_PARTICIPANT, UNKNOWN. A matching filter is a candidate, not proof of contribution. Verify stream scope, search window, timestamp behavior, grouping, scheduling, execution and explicit linkage before claiming contribution or confirmation. A message cannot alone prove that a count threshold triggered. Missing backlog references do not prove exclusion. Enforce event permissions independently.

## API and security

Proposed namespace `/api/plugins/org.graylog.plugins.messagetrace`; final mounted path depends on verified plugin registration. Planned routes:

| Method | Relative route | Purpose |
|---|---|---|
| GET | `/trace/{index}/{messageId}` | Authorized stored facts and available evidence |
| POST | `/trace/resolve` | Resolve supplied identity |
| POST | `/trace/replay` | Explicit isolated replay |
| POST | `/trace/compare` | Authorized comparison |
| GET | `/trace/{index}/{messageId}/fields` | Field history |
| GET | `/trace/{index}/{messageId}/events` | Event relationships |
| GET | `/trace/{index}/{messageId}/diagnostics` | Evidence-based diagnostics |
| GET/PUT | `/configuration` | Read/update plugin configuration |
| GET | `/recording/status` | Cluster recording state |
| POST | `/recording/start`, `/recording/stop` | Controlled recording sessions |
| GET | `/snapshots`, `/snapshots/{id}` | Authorized snapshot metadata/content |

Add pagination, bounded exports, stable schema version, cancellation, rate limits and appropriate error codes. Recorded evidence is re-authorized on every read/export, including after original-message retention or permission changes. Never bypass Graylog permissions with direct unrestricted backend searches. Separate trace viewing, replay, recording administration, snapshot creation and history deletion permissions. Redact rule source, intermediate values, object names and lookup results when inaccessible. Do not grant historical access just because a final stream is visible. Credentials never enter exported snapshots.

Exports: JSON/YAML first, Markdown/plain text later. Preserve per-claim provenance, capture coverage, versions and redactions across formats. No export may imply that missing traces mean a rule never ran.

## Architecture and delivery

Server components: MessageResolver, InputResolver, ProcessorResolver, PipelineTopologyResolver, SimulationAdapter, StreamResolver, IndexResolver, EventAnalyzer, FieldProvenanceAnalyzer, DiagnosticAnalyzer, ConfigurationSnapshotService and permission-aware REST resources. Recording subsystem: ScopeMatcher, SamplingEngine, TraceCollector, bounded persistence worker and RetentionManager. Web components follow the tabs above. Server integration will use pinned Graylog APIs, with version-specific adapters and a supported-version matrix.

v0.1 target: message action and canonical lookup, input/processor/topology resolution, safe current simulation, rule states, field changes, streams/storage, errors, event candidates, Flow/Timeline/Fields/Diagnostics, JSON/YAML and provenance. Recording UI may show unsupported/experimental status; no functioning-looking inactive switch.

v0.2 target: proven exact instrumentation, input/stream scopes, temporary sessions, sampling, retention, revision hashes, field/rule explanations and message comparison.

v0.3 target: configuration snapshots/historical replay, recorded-vs-current/historical comparison, pipeline diff, live sessions, advanced event relationships, performance and routing analysis. Debugger controls remain future scope.

## Acceptance gates

1. Unit tests cover absent/null/type values, immutable snapshots, provenance preservation, mixed and truncated recordings, numeric stages, cycles and clones.
2. Adapter integration tests on pinned Graylog prove authorized resolution, deleted objects, ambiguous IDs, rule/stream behavior and no production side effects from replay.
3. Security tests cover cross-stream access, removed permissions, expired original messages, snapshots, exports, malicious field text, and intermediate-field leakage.
4. Recording tests cover OFF, stop, expiry, restart, partitions, sampling endpoints, late stream selection, queue overflow and storage failure without ingestion interruption.
5. UI tests cover message action navigation, each supported mode, permission redaction, field history, comparison and export.
6. Staging load tests establish throughput, tail latency, memory and storage bounds with recording OFF and each supported scope. Production readiness requires these gates; the current foundation does not satisfy them yet.
