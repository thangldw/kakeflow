# Development

## Setup

```bash
npm ci
npm run dev
```

Use `npm run desktop:dev` for the Tauri application. Desktop persistence and native filesystem behavior are not available in the browser preview.

## Repository

| Path | Contents |
| --- | --- |
| `src/` | React UI, adapters, domain types, platform clients and tests |
| `src-tauri/` | Rust commands, SQLCipher, evidence, OCR, reports and migrations |
| `relay-service/` | Reference family and mobile-capture relay |
| `scripts/` | Release, smoke, OCR, localization and deterministic fixture tools |
| `docs/` | Current product and operational contract |
| `packaging/` | Platform packaging resources |

## Required checks

```bash
npm run lint
npm test -- --run
npm run build
cd src-tauri
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test
```

Do not use production financial data in fixtures, screenshots, logs, or issues. Demo fixtures must be fictional and deterministic.
