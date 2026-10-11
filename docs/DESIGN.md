# KakeFlow landing design contract

User selected the third displayed traceable-finance mockup on 2026-10-12 and authorized production release.

The portfolio owns the design system: https://thangldw.github.io/css/site-shell.css is the official entry and imports canonical tokens.css. Route CSS owns composition only. Default English and light; EN/VN/JP/CN controls translate website copy. The native app has Japanese, English and Vietnamese UI only.

Use source evidence -> explicitly reviewed double-entry ledger -> spending, budgets and investments. Synthetic graph examples must be labeled. The use-case screenshots are actual product captures using synthetic Tanaka data. Keep desktop/browser capabilities distinct; retain v1.2.1 ARM64 ad-hoc signing/notarization disclosure. Do not change the application or its /app/ route for a landing redesign.

Verification: node --check docs/kakeflow-page.js; npm run build:pwa; desktop/mobile browser review including locale, environment and theme controls. GitHub Pages workflow assembles docs plus PWA dist into one artifact.
