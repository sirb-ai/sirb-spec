# Migrations

Each breaking change ships as a new apiVersion (see [VERSIONING.md](../VERSIONING.md)).
When it does, one migration is added here for every frozen apiVersion that
comes before it.

- **File:** `migrations/<from>-to-<to>.mjs`, for example `v1beta1-to-v1.mjs`.
- **Contract:** the file exports `migrate(document) → document`.
  - The function is pure and deterministic.
  - It never resolves or invents secrets. `secretRef`s are copied unchanged.
  - Any field it cannot map is left for a human. The function throws an error that names the field.
- **Tests:** add `conformance/migrations/<from>-to-<to>/` cases, each an input
  plus the expected output. The output must validate against the target apiVersion.

`test/versioning.test.mjs` fails when a frozen apiVersion has no migration to
a later apiVersion. There are none yet, because `v1alpha1` is the only
apiVersion and alpha versions are never frozen.
