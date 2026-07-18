# Localization

KakeFlow supports Japanese (`ja`), English (`en`), and Vietnamese (`vi`). Language selection lives in Settings and persists locally as `kakeflow.locale`.

- Japanese is the first-run default and fallback for untranslated domain text.
- Root `lang` follows the active locale.
- Dates use `ja-JP`, `en-US`, or `vi-VN`.
- Financial values use tabular numerals.
- Account, merchant, tag, filename, and imported source text are never translated.

Shell, navigation, global filters, dashboard, data quality, reconciliation, and primary transaction controls use the shared dictionary. Specialized financial text keeps reviewed source language until a safe translation exists.

New product copy should add reviewed JA/EN/VI entries together. UI uses system-first Japanese-capable sans fonts; monospace is reserved for identifiers and evidence.
