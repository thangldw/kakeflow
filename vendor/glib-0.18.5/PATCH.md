# GLib 0.18.5 security backport

Upstream crate: https://crates.io/crates/glib/0.18.5 (MIT; original license retained).
Advisory: GHSA-wrw7-89jp-8q8g / RUSTSEC-2024-0429.
Reference fix: glib 0.20.0 src/variant_iter.rs, available from https://crates.io/api/v1/crates/glib/0.20.0/download.

Only the VariantStrIter::impl_get out-parameter is changed: declare p mutable and pass &mut p to g_variant_get_child. GLib writes this output; passing a shared reference permits mutation of immutable Rust storage and is unsound. This is the same two-line fix in upstream 0.20.0, without upgrading the GTK/Tauri ABI or hiding the retained 0.18.5 version.

Native iterator tests run against real system GLib. The path override applies to the desktop graph on Linux; standalone tests also exercise the backport on macOS. Remove this vendor patch when the supported Tauri GTK graph accepts an upstream fixed GLib major. Version-only vulnerability scanners may still identify 0.18.5; disposition must cite this exact source patch and native test evidence.
