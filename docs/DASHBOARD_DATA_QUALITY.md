# Dashboard data quality and freshness

Home qualifies its analytics with source-backed facts rather than a universal completeness score.

The panel reports the latest source from a `POSTED` import, timestamp/name/type, immutable document/row counts, source-type count, pending/ready candidates excluded from analytics, and failed imports. Latest source is deterministic and household-scoped.

| State | Meaning |
| --- | --- |
| `原本データなし` | No source document exists. |
| `取込エラーあり` | At least one import failed. |
| `確認待ちあり` | Candidates remain outside confirmed analytics. |
| `確認済みデータを反映` | Sources exist with no known pending/failure warning. |

The final state does not claim complete coverage of all external accounts. The action opens Import Inbox. Browser demo data is labeled as sample. Trend direction has semantic text and the SVG chart has an equivalent hidden numeric table.
