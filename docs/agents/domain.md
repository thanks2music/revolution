# Domain Docs

How the engineering skills should consume Revolution's domain documentation when exploring this repository.

## Before exploring, read these

This repository has no glossary or ADRs of its own. Revolution keeps one set for all its repositories in the parent repository, `thanks2music/one-more-time`, which is checked out one directory up:

- **`../GLOSSARY.md`**: the product vocabulary
- **`../docs/adr/`**: decisions that span Revolution, including how tasks are tracked (ADR-0008, ADR-0009)

If the parent checkout is missing, read them on GitHub: `gh api repos/thanks2music/one-more-time/contents/GLOSSARY.md --jq .content | base64 -d` for the glossary, and `gh api repos/thanks2music/one-more-time/contents/docs/adr --jq '.[].name'` to list the ADRs.

Create new terms and ADRs in the parent repository, not here.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `../GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`, run from the parent repository).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (web checker on Functions), but worth reopening because…_
