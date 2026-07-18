# Replicable planning and configuration capture

KakeFlow captures seven portable household aggregates without sending or applying them remotely:

![Replicable planning and configuration](assets/infographics/family-v2-planning.svg)

- complete monthly budget plan;
- savings goals;
- classification rules with sorted labels/tags;
- account groups with ordered membership;
- explicit card settlement mappings;
- dashboard preferences; and
- versioned parser profiles.

Every aggregate is household-scoped. Stable IDs cannot move between households. Same-commit edits coalesce to the latest state; independent deletions create tombstones; budget changes emit a new complete plan.

Restore and two-database replay validate typed fields, enums, deterministic child order, household/account dependencies, amounts, statuses, mappings, appearance, and parser versions. Classification application history remains part of the resulting transaction aggregate.

This is a reproducibility proof—not a transport, incoming apply, merge, login, remote authorization, cloud sync, or mobile capture feature.
