# Bundled font source

KakeFlow bundles Noto Sans JP for Japanese text in generated PDF reports.

| Field | Value |
| --- | --- |
| Family | Noto Sans JP |
| File | `NotoSansJP-wght.ttf` |
| Upstream | [google/fonts](https://github.com/google/fonts/tree/main/ofl/notosansjp) |
| License | SIL Open Font License 1.1 |
| Retrieved | 2026-07-14 |
| Font SHA-256 | `c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f` |
| License SHA-256 | `babcfe66c8a098b2fa279bc724a3a342f8124f77ce18941fbcc1bbb39823cded` |

[Font file](https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf) · [OFL license](https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/OFL.txt)

The bundled `OFL.txt` preserves the upstream license; only one trailing space was normalized.

Verify the vendored files before a release:

```bash
shasum -a 256 src-tauri/generated-resources/fonts/NotoSansJP-wght.ttf \
  src-tauri/generated-resources/fonts/OFL.txt
```

Do not replace the font from an unpinned download or remove this provenance record.
