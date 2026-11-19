# rusqlite_migration 2.7.0 dependency bump

Upstream crate: https://crates.io/crates/rusqlite_migration/2.7.0 (Apache-2.0; original license retained).
Advisory: RUSTSEC-2026-0459 / RUSTSEC-2026-0502 (SQLite CVE-2026-119375 in the bundled SQLCipher amalgamation).

The patched SQLCipher (`sqlcipher-src` 420.0.0) is only reachable through `libsqlite3-sys` 0.40, which is used by `rusqlite` 0.42. Upstream `rusqlite_migration` 2.7.0 requires `rusqlite` ^0.41, and Cargo allows only one crate linking `sqlite3`.

Only the `rusqlite` version requirement in Cargo.toml changes (`0.41.0` -> `0.42.0`); no source file is modified. Remove this vendor patch when a `rusqlite_migration` release accepts `rusqlite` 0.42.
