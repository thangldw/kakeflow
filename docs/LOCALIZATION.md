# Localization

KakeFlow supports Japanese (`ja`), English (`en`), and Vietnamese (`vi`). Japanese is the source language for domain copy.

## Runtime contract

- `I18nProvider` owns the selected locale and updates the document language.
- `text()` handles context-bound labels; `localize()` handles shared and static UI modules.
- Dynamic Japanese messages use catalog-backed interpolation.
- User data, imported source text, merchant names, account names, and evidence content are not translated.

## Coverage

Generated catalogs live in `src/locales/`. Manual entries in `src/i18n.tsx` override generated translations for accounting vocabulary and high-impact messages.

```bash
npm run i18n:codemod
npm run i18n:generate
npm test -- --run scripts/i18n-catalog-contract.test.ts src/i18n.test.tsx
```

The catalog contract fails when static Japanese UI text bypasses localization or when English or Vietnamese entries are missing.
