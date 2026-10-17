"""Second, independent conformance runner (Python jsonschema).

Runs every `level: schema` fixture in conformance/fixtures against the
schemas with python-jsonschema and checks the verdict and the
instancePath + keyword locators. `property` is informative and skipped.
`level: loader` fixtures need a Sirb loader and are skipped here.
`level: runtime` fixtures need an agent runtime (ADR-0012). Their behaviour
is not executed here; only their embedded `documents` are checked, and each
of them must be schema-valid.

Usage: python -I run_conformance.py <repo-root>
"""

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

KIND_FILES = {
    "Agent": "agent", "Workflow": "workflow", "Tool": "tool", "Memory": "memory",
    "KnowledgeBase": "knowledgebase", "ModelBinding": "modelbinding",
    "UIBinding": "uibinding", "Policy": "policy",
}


def pointer(path):
    return "".join("/" + str(p).replace("~", "~0").replace("/", "~1") for p in path)


def flatten(errors):
    for e in errors:
        yield e
        yield from flatten(e.context)


def parent(ptr):
    return ptr.rsplit("/", 1)[0] if ptr else None


def matches(expected, actual):
    path, keyword = actual
    if keyword != expected["keyword"]:
        return False
    if path == expected["instancePath"]:
        return True
    # python-jsonschema drops the instance path on false-schema errors
    # (descend() returns before prepending it), so a false error is
    # reported at the parent object. Accept that location.
    return keyword == "false" and path == parent(expected["instancePath"])


def main(root):
    root = Path(root)
    schema_dir = root / "schema" / "v1alpha1"
    schemas = {p.stem.removesuffix(".schema"): json.loads(p.read_text()) for p in schema_dir.glob("*.schema.json")}
    registry = Registry().with_resources(
        (s["$id"], Resource.from_contents(s, default_specification=DRAFT202012)) for s in schemas.values()
    )
    checker = Draft202012Validator.FORMAT_CHECKER
    validators = {
        name: Draft202012Validator(schema, registry=registry, format_checker=checker)
        for name, schema in schemas.items()
    }

    def errors_for(doc):
        kind = doc.get("kind") if isinstance(doc, dict) else None
        validator = validators[KIND_FILES.get(kind, "resource")]
        errors = list(flatten(validator.iter_errors(doc)))
        return [(pointer(e.absolute_path), "false" if e.validator is None else e.validator) for e in errors]

    failures, ran, skipped, runtime_docs = [], 0, 0, 0
    for path in sorted((root / "conformance" / "fixtures").rglob("*.json")):
        fixture = json.loads(path.read_text())
        name = path.relative_to(root / "conformance" / "fixtures")
        if fixture["level"] == "runtime":
            # Behaviour is not executed here; the embedded documents must be valid.
            skipped += 1
            for i, doc in enumerate(fixture.get("documents", [])):
                runtime_docs += 1
                actual = errors_for(doc)
                if actual:
                    failures.append(f"{name}: documents[{i}] must be valid; errors {actual}")
            continue
        if fixture["level"] != "schema":
            skipped += 1
            continue
        ran += 1
        actual = errors_for(fixture["document"])
        valid = not actual
        if valid != fixture["expect"]["valid"]:
            failures.append(f"{name}: verdict {valid}, expected {fixture['expect']['valid']}; errors {actual}")
            continue
        for e in fixture["expect"].get("errors", []):
            if not any(matches(e, a) for a in actual):
                failures.append(f"{name}: expected {e['instancePath']} [{e['keyword']}] not reported; got {actual}")

    for f in failures:
        print("FAIL", f)
    print(
        f"python-jsonschema: {len(failures)} failure(s); {ran} schema-level fixtures run, "
        f"{runtime_docs} runtime-fixture documents validated, {skipped} loader/runtime fixtures not executed"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "."))
