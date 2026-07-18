# macOS signing and notarization boundary

The public macOS artifact is ad-hoc signed and not notarized. The signature satisfies local Apple Silicon code requirements but does not identify a publisher or establish Gatekeeper trust. Users may need to approve first launch with **Open Anyway**.

Paid Developer Program membership, Developer ID certificates, notarization credentials, stapling, and CI secret management are outside the funded roadmap and are not release blockers.

Release controls still require:

1. build with `APPLE_SIGNING_IDENTITY=-`;
2. `codesign --verify --deep --strict`;
3. packaged-app and read-only DMG smoke tests;
4. SHA-256 publication; and
5. explicit architecture, ad-hoc signing, no-notarization, and first-launch disclosure.

GitHub hosting does not make the publisher trusted by macOS. References: [Tauri signing](https://v2.tauri.app/distribute/sign/macos/), [Apple Developer ID](https://developer.apple.com/developer-id/), and [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).
