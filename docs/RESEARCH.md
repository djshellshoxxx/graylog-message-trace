# Integration research — 2026-10-04

## Sources examined

- [Graylog pipeline documentation](https://go2docs.graylog.org/current/making_sense_of_your_log_data/pipeline_usage.html): native pipeline simulation is an existing building block. Message Trace should add evidence aggregation rather than a second rule engine.
- [PipelineInterpreter.java at Graylog 7.1.3](https://github.com/Graylog2/graylog2-server/blob/7.1.3/graylog2-server/src/main/java/org/graylog/plugins/pipelineprocessor/processors/PipelineInterpreter.java): source read through GitHub during repository initialization.

The earlier conversation reported broader feature searches. This repository does not treat those searches as proof that no equivalent commercial or community feature exists. Current research establishes useful native components and integration constraints, not an exhaustive market absence claim.

## Verified source observations

`process(Messages)` obtains the latest interpreter state and creates either a RuleMetricsListener or NoopInterpreterListener. The overload accepts an InterpreterListener and State. This class does not expose a registration list for arbitrary plugin listeners on its ordinary live path. A public overload is not evidence of a supported installation hook.

The listener receives rule evaluation, match/non-match, execution, finish and failure notifications. Action execution calls finish in a finally block. Stage execution evaluates conditions before running queued rule actions. Pipelines are processed across stage slices; the source explicitly does not guarantee pipeline execution order.

The ordinary processing path can acknowledge dropped messages and mutate metrics. Calling it for replay without isolation could affect live services. The source's explicit-state path is useful for investigating a safe adapter but still executes rule functions, which may depend on external state or have custom side effects.

Stream processing tracks message/stream pairs and reprocesses newly added streams. The renderer must distinguish a configuration graph cycle from an actual execution loop.

## Engineering decisions

Keep exact recording unsupported until a staging proof establishes a compatible hook, or explicitly scoped upstream change. Do not replace the built-in processor silently, run it twice, or infer exact provenance from before/after processor snapshots. Pipeline instrumentation alone cannot capture codec/extractor/indexing provenance.

Pin server and web plugin integration dependencies after examining the official plugin skeleton and Graylog 7.1.3 build configuration. Do not advertise a Java/runtime requirement based solely on the local runtime. No Graylog source has been copied into this repository.

Historical replay requires more than configuration: initial message state, lookup/time-dependent behavior, version and ordering matter. Final-document replay must carry an explicit input-origin warning.

## Remaining research

Verify plugin REST/web registration, permission APIs and search/message resolver contracts; native simulator isolation and response structure; available live instrumentation hooks outside this class; dropped-message identity; server minimum JDK/build toolchain; packaging and supported patch-version matrix. Test everything against an isolated 7.1.3 instance before calling the plugin installable.
