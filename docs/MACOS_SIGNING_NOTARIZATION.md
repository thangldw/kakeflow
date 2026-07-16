# macOS signing and notarization — out of scope

KakeFlow's public macOS artifact is intentionally ad-hoc signed. An ad-hoc
signature satisfies Apple Silicon's local code-signing requirement, but it does
not identify the publisher and it does not make the artifact eligible for Apple
notarization. Gatekeeper can therefore show:

> Apple could not verify “KakeFlow.app” is free of malware.

Paid Apple Developer Program membership, `Developer ID Application`
certificates, notarization credentials, stapling, and their CI secret workflow
are not funded roadmap tasks and do not block direct GitHub releases. The
release must instead state that the DMG is ad-hoc signed and not notarized and
that macOS may require the user's explicit **Open Anyway** approval. This file
is retained only to record that product boundary; the former production-signing
runbook is no longer active.

## Supported release controls

The release workflow still must:

1. build with `APPLE_SIGNING_IDENTITY=-`;
2. verify the ad-hoc signature structure with `codesign --verify`;
3. run the packaged-app and read-only DMG smoke tests;
4. compute and publish SHA-256; and
5. disclose the supported architecture, ad-hoc signature, absent notarization,
   and manual first-launch approval in every GitHub Release.

Do not add certificate purchase, Developer ID enrollment, notary submission,
stapler, App Store Connect secret management, or Gatekeeper-acceptance tests to
the release checklist. Do not claim that GitHub hosting makes the publisher
trusted by macOS.

Official background references:

- [Tauri macOS code signing](https://v2.tauri.app/distribute/sign/macos/)
- [Apple: Signing Mac software with Developer ID](https://developer.apple.com/developer-id/)
- [Apple: Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
