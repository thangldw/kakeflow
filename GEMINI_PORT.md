# KakeFlow Gemini design and feature port

This branch uses `kakeflow-gemini` as the visual source of truth while keeping the GitHub application's production ledger, import, reconciliation, and local-first data model.

## Design port

- Warm paper canvas, olive/green brand palette, coral expense accents, low-contrast borders, and compact desktop typography.
- 32px desktop title bar, 246px collapsible navigation rail, 58px command bar, 14px cards, and Gemini-style spacing rhythm.
- Gemini brand mark, grouped navigation, solid-green active state, compact household switcher, global ledger search, and top-level quick actions.
- Dashboard page heading, template tabs, KPI cards, action center, charts, lists, dark theme tokens, and responsive rules restyled through `src/gemini-theme.css`.

## Feature parity added to the GitHub app

| Gemini capability | GitHub implementation |
| --- | --- |
| Natural-language ledger search | Global command-bar search; routes to Transactions and parses merchant text plus amount phrases such as `5000円以上` / `5000円以下`. |
| Quick manual entry and file import | Always-available command-bar actions wired to the existing balanced-entry modal and import workflow. |
| Secondary-currency dashboard | USD/EUR/GBP/AUD conversion strip for net worth, income, and expense. |
| Debt payoff planning | Interactive balance/rate/payment calculator under Budgets. |
| Future-spending simulation | Interactive monthly spending delta with annual impact under Budgets. |
| Monthly context notes | Household/month-scoped notes stored locally under Reports. |
| Recurring and fixed-cost workspace | New navigation page backed by the production recurring-series and fixed-cost review models; realistic browser preview state included. |
| Audit readiness | New audit/evidence overview connected to import/evidence counts and the existing source-provenance workflows. |
| Collapsible sidebar | Persisted local preference, matching Gemini's compact navigation control. |

Gemini's cloud-AI presentation is represented through local deterministic search and the existing explainable classification/rules engine, preserving KakeFlow's local-first and review-before-posting behavior.

## Production capabilities retained

The GitHub implementation remains the source of truth for double-entry posting, OCR/import review, duplicate protection, card reconciliation, investments, household attribution, exports, encrypted local evidence, backups, and native desktop commands.
