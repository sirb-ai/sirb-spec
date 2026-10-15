# sirb-spec

Agent Spec JSON Schema, conformance suite and AI security evals for Sirb.

## Sirb Agent Spec `v1alpha1`

Every Sirb document has the same envelope:

```json
{ "apiVersion": "sirb/v1alpha1", "kind": "<Kind>", "metadata": { "name": "..." }, "spec": { } }
```

| Kind | Schema |
|---|---|
| any (dispatches on `kind`) | [`schema/v1alpha1/resource.schema.json`](schema/v1alpha1/resource.schema.json) |
| Agent | [`agent.schema.json`](schema/v1alpha1/agent.schema.json) |
| Workflow | [`workflow.schema.json`](schema/v1alpha1/workflow.schema.json) |
| Tool | [`tool.schema.json`](schema/v1alpha1/tool.schema.json) |
| Memory | [`memory.schema.json`](schema/v1alpha1/memory.schema.json) |
| KnowledgeBase | [`knowledgebase.schema.json`](schema/v1alpha1/knowledgebase.schema.json) |
| ModelBinding | [`modelbinding.schema.json`](schema/v1alpha1/modelbinding.schema.json) |
| UIBinding | [`uibinding.schema.json`](schema/v1alpha1/uibinding.schema.json) |
| Policy | [`policy.schema.json`](schema/v1alpha1/policy.schema.json) |
| shared `$defs` | [`common.schema.json`](schema/v1alpha1/common.schema.json) |

The schemas are JSON Schema draft 2020-12, and every object in them is closed.
Secret values are never written inline. They are always referenced:

```json
"credentials": { "secretRef": { "name": "anthropic-key", "key": "api-key" } }
```

A `ModelBinding` has `mode: byok | billable`, ordered `fallbacks` and a
per-binding `budget`. A billable binding must have a budget and must not
carry credentials.

## Conformance suite

See [`conformance/README.md`](conformance/README.md) for the fixture format.
To run the schema tests and the conformance suite:

```sh
npm ci
npm test
```

## Design decisions

The architecture decision records are in [`docs/adr/`](docs/adr/).
