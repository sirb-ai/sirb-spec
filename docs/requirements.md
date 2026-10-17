# Sirb requirements (BRD + SRS)

> **Placeholder.** The owner adds the full BRD and SRS here: business requirements (`BR-`),
> software requirements (`SR-<COMP>-`), non-functional requirements (`NFR-`) and security
> requirements (`SEC-`). This file currently holds only the draft runtime section below. Nothing
> in this file defines any other requirement. The `SR-SPEC-01` to `SR-SPEC-05` IDs that this
> repository already uses are recorded in
> [ADR-0001](adr/0001-record-architecture-decisions.md).

## SR-RT: Agent runtime (Node.js and .NET)

> **DRAFT — proposed by Claude, needs owner confirmation.**
>
> The owner named the IDs SR-RT-01, 02, 03, 05, 06, 07 and 10 for the first runtime slice, and
> listed what the slice contains. The owner did **not** say which ID covers which item. The mapping
> below is a guess: it assigns the items in the order the owner listed them. It is to be corrected
> by the owner. When it changes, update this section, [ADR-0012](adr/0012-runtime-conformance-fixtures.md),
> `conformance/README.md`, `test/traceability.test.mjs` and the `requirements` tags of the
> `conformance/fixtures/runtime/` fixtures together.

| ID | Proposed statement | Verified by |
|---|---|---|
| SR-RT-01 | The runtime loads and validates Agent Spec `sirb/v1alpha1` documents (YAML or JSON), and a code-first `defineAgent()` API produces the same spec object. | The `schema` and `loader` fixtures run by each runtime, the runtime fixtures (which load their documents through the runtime loader), and a `defineAgent()` round-trip test in each runtime |
| SR-RT-02 | The runtime runs a single agent in a model/tool loop, on Vercel AI SDK Core (Node.js) or Microsoft.Extensions.AI (.NET). Tools are typed and validated against their `inputSchema`, and MCP tools are supported. | Runtime fixtures (MCP fixtures to follow; see ADR-0012) |
| SR-RT-03 | The runtime returns structured output that is validated against a JSON Schema, and retries the model a bounded number of times when the output is invalid. | Runtime fixtures |
| SR-RT-04 | TBD by owner. | |
| SR-RT-05 | The runtime provides an in-memory memory store and a Postgres memory store with the same contract. | Runtime fixtures, run against each store |
| SR-RT-06 | The runtime emits an OpenTelemetry span for every run, model call and tool call, using the GenAI semantic conventions. | Runtime fixtures |
| SR-RT-07 | The runtime emits one usage record for every model call. Records are idempotent by `request_id` and carry `mode: byok \| billable`. | Runtime fixtures |
| SR-RT-08 | TBD by owner. | |
| SR-RT-09 | TBD by owner. | |
| SR-RT-10 | The CLI provides `sirb init` (scaffold an agent project) and `sirb dev` (run it locally). | CLI smoke tests in sirb-js and sirb-dotnet, not fixtures (ADR-0012) |

The most likely alternative mapping is: SR-RT-01 load and validate, SR-RT-02 `defineAgent()`,
SR-RT-03 the run loop and tools, SR-RT-05 structured output, SR-RT-06 memory, and SR-RT-07 spans
plus usage.
