# 0012. Runtime-level conformance fixtures

- **Status:** Proposed (draft for owner review)
- **Date:** 2026-10-17
- **Requirements:** SR-RT-01, SR-RT-02, SR-RT-03, SR-RT-05, SR-RT-06, SR-RT-07 (the draft IDs in
  `docs/requirements.md`; their mapping is unconfirmed). SR-RT-10 is out of scope; see
  [CLI behaviour](#cli-behaviour-sr-rt-10).

## Context

The first runtime slice (Node.js on Vercel AI SDK Core, .NET on Microsoft.Extensions.AI) has to
behave the same in both runtimes. The repository rule is "spec first", but the existing fixture
levels only cover documents. `schema` checks a parsed document and `loader` checks raw text.
Nothing pins down what a runtime *does* with a valid document: what it sends to the model, how it
calls tools, when it retries, what it writes to memory, and which spans and usage records it
emits.

These fixtures must be runnable by both runtimes in CI. That means no network, no real model and
no secrets. They must also follow ADR-0006: locators and matching rules use neutral vocabulary,
never the types of one SDK (no `ModelMessage`, no `ChatMessage`, no `FunctionCallContent`).

## Decision

Add **`level: runtime`** to `conformance/fixture.schema.json`. `level: semantic` stays reserved
for cross-document rules (ADR-0006). The change is additive: no existing fixture changes meaning.

### Fixture shape

| Field | Meaning |
|---|---|
| `documents` | The Sirb documents under test. Each must load with no errors and no warnings. |
| `agent` | The `metadata.name` of the Agent to run. |
| `model.turns` | The **scripted model**: canned responses, consumed in order across all runs. |
| `tools` | **Stub tools**, keyed by Tool name. `results[n]` is returned by the n-th accepted invocation. |
| `runs` | Runs executed in order: `input` (the user message), optional `context` (`orgId`, `userId`, `sessionId`), and optional `structuredOutput` (`schema`, `maxRetries`). |
| `expect` | `valid`, `errors`, `runs[]` (`output`, `steps`, `memory`), `spans`, `usage`. |

A scripted turn has `text`, `object`, `toolCalls` (each with `id`, `name` and `arguments`), or
`error` (`type`: `error`, `timeout` or `rate-limit`, the ModelBinding fallback triggers). Every
turn without `error` also has `usage` (`inputTokens`, `outputTokens`). `object` is shorthand for a
`text` turn that holds the value's JSON serialization, so structured output always reaches the
runtime as text, the way providers return it. The scripted model reports finish reason
`tool-calls` when the turn has `toolCalls`, and `stop` otherwise. A turn may carry
`expectRequest`, which asserts what the runtime sent for that call.

For `level: runtime`, `expect.valid` means "every run completes without an error". A run that
fails is listed in `expect.errors` as `{code, run}`. File name prefixes keep their meaning, so a
fixture whose run is expected to fail is named `invalid-…`.

### What the runner must do

1. **Load** the documents through the runtime's own loader, as JSON or YAML text. It must not
   build them with constructors that skip validation. This is also how SR-RT-01 is exercised.
2. **Replace every model** with the scripted model. Credentials are never resolved, and
   provider-level transport retries are turned off, so each runtime model call consumes exactly one
   turn. If the runtime asks for a turn when none are left, or leaves turns unused, the fixture
   fails.
3. **Replace every tool implementation** with its stub, whatever the Tool's `type`. The runner
   must not make the HTTP call, start the process or load the handler. Fixtures use `type: http`
   tools with `example.com` URLs, so neither runtime's function syntax appears in them. If a stub is
   invoked more times than it has `results`, or fewer times, the fixture fails.
4. **Bind memory** through the runtime's store interface, wrapped by a recorder. See
   [Memory](#memory).
5. **Capture spans** with an in-memory OTel exporter, and capture **usage records** with an
   in-memory sink.
6. Execute `runs` sequentially against one runtime instance. No assertion depends on wall-clock
   time or on the format of generated IDs.

### Neutral transcript

`expectRequest.messagesInclude` and memory entries use one message form. Both SDKs map onto it
directly:

| Neutral message | Vercel AI SDK Core | Microsoft.Extensions.AI |
|---|---|---|
| `{role: "system", text}` | `system` message | `ChatRole.System` + `TextContent` |
| `{role: "user", text}` | `user` message, text part | `ChatRole.User` + `TextContent` |
| `{role: "assistant", text?, toolCalls?: [{id, name, arguments}]}` | `assistant`, text and tool-call parts | `ChatRole.Assistant`, `TextContent` + `FunctionCallContent` |
| `{role: "tool", toolCallId, isError, result}` | `tool`, tool-result part | `ChatRole.Tool` + `FunctionResultContent` |

The Agent's `instructions` must appear in a system message. The tool name the model sees is the
Tool's `metadata.name`.

### Step trace (normative)

`expect.runs[i].steps` is the exact, ordered list of what the run did:

- `{type: "model", turn}`: one model call, naming the scripted turn it consumed.
- `{type: "tool", name, callId, arguments, outcome}`: one tool call the model requested.
  `arguments` is compared **exactly** with what the model produced. Runtimes do not apply
  defaults, coerce types or drop fields before validation or invocation.
  - `outcome: "ok"` means the arguments validated against `inputSchema` and the stub was invoked.
  - `outcome: "invalid-arguments"` means validation failed and the stub was **not** invoked. The
    runtime sends a tool result to the model with `isError: true` and
    `result: {error: {code: "invalid-tool-arguments", issues: [{instancePath, keyword}]}}`. The
    issue locators use the ADR-0006 vocabulary. Neither SDK's default handling of invalid tool
    input produces this, so both runtimes validate inside their own tool wrapper.
- `{type: "retry", reason: "structured-output-invalid", attempt}`: the final output failed to
  parse as JSON, or failed `structuredOutput.schema`. The runtime then makes another model call.
  That request contains the rejected assistant message followed by a `user` repair message.
  `attempt` counts from 1. After `maxRetries` retries the run fails with
  `structured-output-invalid`. Every attempt is a model call, so every attempt gets its own span and
  usage record.

Tool calls within one turn are handled, and their spans started, in the order the model listed
them.

### Run error codes (normative)

| Code | When |
|---|---|
| `structured-output-invalid` | The output still fails after `maxRetries` retries. |
| `model-error` | A model call fails (a scripted `error` turn) and no fallback applies. |
| `max-iterations` | `spec.maxIterations` model calls were made in the tool loop without a final answer. |

### Matching rules

1. **Exact:** `output` (`text` or `object`, by JSON equality), step `arguments`, the length and
   order of `steps` and of `memory`, `expectRequest.messageCount`, and `expectRequest.tools`
   (compared as a set).
2. **Subset:** every other object, including messages, tool `result`, span `attributes` and usage
   records. Each given member must match, and extra members are fine. Arrays inside a subset match
   are compared element by element and must have the same length. There is one exception:
   `result.error.issues` of an `invalid-tool-arguments` result follows the ADR-0006 locator rule.
   Each expected locator must match at least one reported issue, and extra issues are fine,
   because validators report wrapper keywords differently.
3. **`messagesInclude`** is an ordered subsequence. Each entry matches a distinct request
   message, and the matches come in the order given.
4. **Matchers** are recognized only inside `expect` and `expectRequest`. A matcher is an object
   with exactly one member, named `$contains` or `$capture`:
   - `{"$contains": "s"}` matches a string that contains `s`.
   - `{"$capture": "name"}` matches a non-empty string. All occurrences of one name must bind the
     same value, and different names must bind different values. This is how the fixture states
     that `request_id` is **stable** (the same on the usage record and on its span) and **unique**
     (different on every step).
5. **Spans:** the runner keeps only spans whose `gen_ai.operation.name` is `invoke_agent`, `chat`
   or `execute_tool`, and orders them by start time. When `expect.spans` is present, the count must
   match exactly and each span must match the entry at the same index: `name` exactly, `parent` by
   index, `status`, the `attributes` subset and `absentAttributes`. SDK-internal spans without those
   operation names, such as the AI SDK's `ai.*` spans, are ignored. A runtime must not emit two
   `chat` spans for one model call.
6. **Usage:** a sink may receive a record more than once, because delivery is at least once. The
   runner groups records by `request_id`, fails if two copies differ, and then matches the
   de-duplicated list in emission order. When `expect.usage` is present, the count must match
   exactly.
7. If an `expect` section is absent, it is not checked.

**Informative, never asserted:** the wording of system prompts beyond `$contains`, repair
messages and error messages; span timing, span kind and extra attributes; extra usage fields such
as timestamps; ID formats; and latency.

### Spans (OTel GenAI semantic conventions)

The names follow the GenAI conventions as of semconv 1.37 or later. Those conventions are still
in *Development* status, so the fixtures are updated when the names change. Sirb-specific
attributes use the `sirb.` prefix.

| Span | Name | Required attributes |
|---|---|---|
| One per run | `invoke_agent {gen_ai.agent.name}` | `gen_ai.operation.name=invoke_agent`, `gen_ai.agent.name`. On failure: status Error and `error.type` = the run error code. |
| One per model call | `chat {gen_ai.request.model}` | `gen_ai.operation.name=chat`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `sirb.request_id`, `sirb.billing.mode`. On failure: status Error. |
| One per tool step, including rejected ones | `execute_tool {gen_ai.tool.name}` | `gen_ai.operation.name=execute_tool`, `gen_ai.tool.name`, `gen_ai.tool.call.id`. `invalid-arguments`: status Error and `error.type=invalid-tool-arguments`. |

The `chat` and `execute_tool` spans are children of `invoke_agent`. **Content capture is off by
default:** `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions`,
`gen_ai.tool.call.arguments` and `gen_ai.tool.call.result` must be absent unless an operator turns
capture on. Fixtures assert this with `absentAttributes`.

### Usage records (proposed wire format)

The runtime emits one record per **completed** model call, including structured-output attempts
that are later rejected, because those tokens were consumed. A failed call (an `error` turn) emits
no record. The fields use the snake_case wire names that idempotency is keyed on:

| Field | Meaning |
|---|---|
| `request_id` | Unique per model call. Identical on every redelivery of the record, and equal to the call's `sirb.request_id` span attribute. This is the idempotency key. |
| `run_id` | The same for every call in a run. |
| `step` | The 0-based index of the model call within its run, counting retries. |
| `agent`, `model_binding`, `provider`, `model` | Taken from the documents. |
| `mode` | `byok` or `billable`, from the ModelBinding. |
| `org_id` | `context.orgId`, when given. |
| `input_tokens`, `output_tokens` | Integers, exactly as the model reported them. |

The runtime does not compute prices. The platform prices usage with versioned prices
(SR-BILL-01..04).

### Memory

The store contract is `read(key) → messages` and `append(key, messages)`, using the neutral
transcript form:

- The key is `(orgId, memory name, scope id)`. The scope id is `userId` for `scope: user`,
  `sessionId` for `session`, the agent name for `agent`, and a constant for `global`.
- The runtime reads once before the first model call of a run. It appends the messages the run
  added (user, assistant and tool messages; never system messages) once, after the run succeeds.
  `entries` counts those messages.
- Fixtures declare `store.provider: in-memory`, because a `postgres` store would need a `connection`
  secretRef that the runner would have to resolve. **The fixture asserts the contract, and the
  backing store is the runner's choice.** A runtime that ships a Postgres store must run every
  memory fixture against it as well, in CI with a disposable Postgres service container. That
  container is the only non-hermetic dependency this level allows.
- Isolation is normative. A different `orgId` or a different scope id reads nothing.

### MCP tools

MCP tools are **in scope for the format but deferred to a follow-up fixture set**, because three
behaviours need owner decisions first (see [Open questions](#open-questions)):

1. The name the model sees: the raw MCP tool name, which is what both SDKs' MCP clients expose,
   or a name prefixed with the Tool resource.
2. How name collisions are handled.
3. How `toolFilter` globs match.

The proposed shape, which is not in the fixture schema yet, is
`tools.<name>.mcp: {tools: [{name, description, inputSchema, results}]}`. The runner would serve
it from an in-process MCP server over a real MCP JSON-RPC transport (the in-memory transports of
the TypeScript and C# MCP SDKs). That way the runtime's MCP client path is exercised. The Tool's
`command` or `url` is replaced and never started or contacted.

### CLI behaviour (SR-RT-10)

`sirb init` and `sirb dev` are **not tested by this level**. A fixture describes agent behaviour,
not a process with files, ports and a terminal. Each runtime repository tests its CLI with smoke
tests:

- `sirb init` produces files that pass the reference loader with no errors or warnings.
- `sirb dev` starts, serves the agent, and can complete a run against the scripted model, reusing a
  `level: runtime` fixture.

If the two CLIs must match flag for flag, a later ADR can add `level: cli`.

### `defineAgent()` parity (part of SR-RT-01)

The runtime fixtures double as golden documents. Each runtime adds a test that rebuilds the
`documents` of every runtime fixture with its code-first API (`defineAgent()` and friends). The
test asserts JSON equality with the fixture after the code-first result passes the runtime's own
validation.

### Proposed Agent Spec change (not made here)

Agent Spec v1alpha1 has no field for structured output. So the fixtures put `structuredOutput`
on the **run**, which matches how both SDKs take a schema per call. If the owner wants it on the
Agent as well, the proposal is an optional
`Agent.spec.output: {schema, maxRetries (0–10, default 2)}`. Adding an optional property is
non-breaking under VERSIONING.md, but it changes the public schema, so it needs owner sign-off and
is not part of this change.

## Consequences

- Both runtimes get one executable definition of the run loop, tool validation, structured-output
  retry, memory, spans and usage. A parity bug shows up as a failing fixture, not as a customer
  report.
- `@sirb/spec`'s reference runner only **validates** runtime fixtures: their shape, their
  embedded documents and their internal consistency. It does not execute them, because this
  package has no runtime. The behaviour is executed by the runners in sirb-js and sirb-dotnet.
  The Python runner validates the embedded documents.
- Each runtime builds a scripted-model adapter: an AI SDK `LanguageModel` mock, and an
  `IChatClient` for MEAI. It also builds a tool-stub binder, a recording memory store, an in-memory
  span exporter and a usage sink. These are test-only code.
- The rules force some implementation choices. Runtimes validate tool arguments themselves,
  without mutating them. They emit exactly one `chat` span per model call; on .NET that means either
  using `OpenTelemetryChatClient` as that span or not wrapping it. They also keep content capture
  off by default.
- The GenAI semantic conventions are still in Development, so attribute renames will need
  fixture updates.
- The usage-record fields are a proposal. They have to be reconciled with the platform's
  usage-event schema before they are relied on for billing.

## Alternatives considered

- **Record and replay real provider traffic.** This needs keys and network access to record, the
  recordings are provider-specific, and they are brittle across SDK versions.
- **SDK-native mocks per runtime (`MockLanguageModelV2`, a fake `IChatClient`) with no shared
  format.** The two test suites would drift, and parity could not be shown.
- **Snapshotting full traces.** That is brittle across SDK and semconv versions, the same reason
  ADR-0006 rejected full error snapshots.
- **Using `level: semantic` for this.** Semantic is reserved for cross-document validation rules,
  not for execution.

## Open questions

1. Is the SR-RT ID-to-item mapping in `docs/requirements.md` right?
2. MCP: which tool names does the model see, how are collisions handled, and how does
   `toolFilter` match?
3. Should structured output also be an Agent field (`spec.output`)? What is the default
   `maxRetries`?
4. In billable mode the Model Gateway also meters calls. Which usage record goes to the ledger, so
   that nothing is billed twice? Are the field names in this ADR the platform's names?
5. Is a run that fails written to memory? This ADR says no.
6. What happens when `scope: user` or `scope: session` memory runs without a `userId` or
   `sessionId`? This ADR proposes no code for it yet.
7. How does a Sirb `provider` map to `gen_ai.provider.name` (`google`, `ollama`,
   `openai-compatible`)? The fixtures assert that attribute only for `anthropic`.
8. Do structured-output retries count towards `maxIterations`? This ADR says no.
