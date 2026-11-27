# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.


## Other labels in this tracker

These are not triage roles. Apply them alongside one.

| Label | Meaning |
| --- | --- |
| `area:ai-writer` | AI writer (article generation pipeline) |
| `area:frontend` | Public site (`revolution` frontend) |
| `area:backend` | API, database, Supabase |
| `area:infra` | Hosting, CI, cloud resources |
| `area:templates` | `revolution-templates` (YAML prompt templates) |
| `area:product` | Product decisions, specs, requirements |
| `someday` | Nobody plans to start it yet. |
