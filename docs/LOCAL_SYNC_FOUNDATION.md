# Local sync foundation

KakeFlow records deterministic local change envelopes as groundwork for optional multi-device workflows. The foundation itself sends nothing to a server.

`sync_device` is a logical origin; `sync_principal` is a local actor, not a login; `household_principal_binding` explicitly maps that actor to a member or none.

Domain commits capture immutable envelopes with household, device/principal, per-device sequence, mutation ID, entity/operation, canonical payload, and SHA-256. Repeated same mutation/content is idempotent; changed reuse conflicts. Delivery status lives in a separate transport-free outbox.

Transaction aggregates contain complete header, ordered journals, sorted labels/tags, and source/external references. Planning/configuration covers budgets, goals, rules, groups, settlement mappings, dashboard preferences, and parser profiles. Multiple writes in one commit coalesce to the latest complete pending aggregate.

User-driven [local change packages](LOCAL_CHANGE_PACKAGES.md) provide staging, conflict review, and atomic apply without outbox echo. Later schemas extend the graph to cards, investments, dashboards, and recurring preferences.

Restore validates identities, envelopes, relationships, typed payloads, balance, deterministic children, and dependencies, while clearing device-local context.

This contract does not itself provide network transport, automatic delivery/apply, login, remote authorization, field merge, source-blob sync, pending-import replication, or watched-folder portability.
