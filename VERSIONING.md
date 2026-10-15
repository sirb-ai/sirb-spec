# Versioning

The spec has two version numbers. They are related but separate:

| | Example | What it versions |
|---|---|---|
| **apiVersion** | `sirb/v1alpha1` | The document format. Every Sirb document declares it. One directory per apiVersion: `schema/<version>/`. |
| **Package semver** | `@sirb/spec@0.1.0` | This package: the schemas, the reference loader and the conformance suite. |

## apiVersion lifecycle

`v1alpha1` → `v1alpha2` → … → `v1beta1` → … → `v1` → `v2alpha1` …

| Stage | Can a directory change in place? | Guarantees |
|---|---|---|
| alpha | Yes, including breaking changes. | None. Each breaking change is listed in the CHANGELOG. |
| beta | No. The directory is **frozen**. | Documents valid today stay valid. Breaking changes require a new apiVersion. |
| GA (`v1`, `v2`, …) | No. The directory is frozen. | The same guarantee as beta, plus a deprecation period of at least one minor release before removal. |

How freezing works:
- `npm run freeze -- v1beta1` records the sha256 of every schema file in `schema/frozen.json`.
- `test/versioning.test.mjs` then fails if a frozen file changes, is removed, or gets a new sibling file.
- Alpha directories cannot be frozen.

## What counts as breaking

A change is breaking if **any document that was valid before becomes invalid,
or changes meaning**. Examples:

- removing or renaming a property or enum value
- adding a required property
- tightening a pattern, bound or enum
- changing a default
- changing what a field means

These changes are **non-breaking** if they don't change the meaning of valid
documents: adding an optional property, adding an enum value, loosening a
constraint, or improving descriptions.

A fix to the secret checks that rejects a credential-shaped string the schema
previously accepted is treated as a **security fix**. It is allowed in a
frozen apiVersion only through a patch release of the loader's `literal-secret`
scan. The schema files themselves are never edited.

## Package semver

- While only alpha apiVersions exist, the package stays `0.x`:
  - Any breaking change to an alpha schema or to the loader API bumps the **minor** version.
  - Everything else bumps the **patch** version.
- From the first beta apiVersion onward:
  - A new apiVersion directory, or a loader API addition, bumps the **minor** version.
  - Removing an apiVersion, or making a breaking loader API change, bumps the **major** version.
  - Fixes bump the **patch** version.
- Every release has a `## <version>` section in [CHANGELOG.md](CHANGELOG.md). A test enforces this.

## Migrations

A breaking change ships as a new apiVersion **and** a migration from every
frozen apiVersion before it. Migrations live in `migrations/` (see
[migrations/README.md](migrations/README.md)), and the versioning test
requires them. Changes between alpha versions are recorded in the CHANGELOG.
A migration script for them is optional.
