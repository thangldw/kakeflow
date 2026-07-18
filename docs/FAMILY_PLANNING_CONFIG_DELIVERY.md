# Family planning and configuration delivery

Family schema v2 carries complete planning/configuration aggregates through the same audience partition and explicit Apply boundary as the core family graph.

Covered aggregates are monthly budgets, savings goals, classification rules, account groups, card settlement mappings, dashboard preferences, and parser profiles.

Each aggregate is assigned the least-widening audience across its account/member dependencies. Shared-only dependencies remain shared; one-member dependencies may remain personal; mixed, other-member, unresolved, ownerless personal, or evidence-dependent graphs are withheld.

Current-state aggregates are complete and deterministic. An audience-relocation lineage prevents omission in an old partition from deleting an entity moved to another partition. Schemas that cannot represent these aggregates have no deletion authority over them.

Staging validates types, ordering, dependencies, counts, hashes, and household scope. Conflicts use whole-aggregate choices; no field-level merge occurs. Explicit Apply revalidates destination state and commits accepted choices atomically. No receive, preview, or relay event applies automatically.

![KakeFlow family planning delivery](assets/infographics/family-v2-planning.svg)
