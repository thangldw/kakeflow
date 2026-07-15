# Localization

KakeFlow supports Japanese (`ja`), English (`en`), and Vietnamese (`vi`) from the desktop top bar.

## Behavior

- Japanese is the first-run default and the fallback for untranslated domain-specific text.
- The selected locale is stored locally under `kakeflow.locale` and restored on the next launch.
- The root HTML `lang` attribute follows the active locale for assistive technology.
- Dates shown by localized dashboard components use `ja-JP`, `en-US`, or `vi-VN`.
- Financial values use tabular lining numerals so amounts remain aligned in every language.

## Translation policy

The application shell, navigation, global filters, overview dashboard, data-quality summary, reconciliation summary, and primary transaction filters use the shared dictionary in `src/i18n.tsx`. Specialized import, accounting, investment, and recovery messages fall back to their original Japanese source string until a reviewed translation is available. This avoids silently changing financial meaning with an incomplete machine translation.

New user-facing copy should be written once in Japanese and added to the English and Vietnamese dictionaries in the same change. Account names, merchant names, tags, filenames, and imported source text must never be translated.

## Font stack

The interface uses system-first sans-serif fonts with `Inter` when installed and Japanese fallbacks (`Noto Sans JP`, `Hiragino Sans`, `Yu Gothic UI`, and `Meiryo`). Monospace is reserved for source records, identifiers, and other technical evidence.
