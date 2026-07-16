# Update channel contract

KakeFlow does not ship an automatic updater. Direct GitHub distribution and
manual user installation are the supported lifecycle. The checked-in
`packaging/update-channel.json` is an authoritative, fail-closed declaration:

```text
stable -> DISABLED_UNCONFIGURED
```

No production update signing key or hosted HTTPS endpoint is planned. Current
builds explicitly set `bundle.createUpdaterArtifacts` to
`false`, do not install the Tauri updater dependencies, do not configure the
plugin, and grant no updater capability. The application therefore neither
checks for nor downloads updates. Users install a verified release manually.

`npm run check:update-channel` cross-checks that declaration against the Tauri
configuration, JavaScript and Rust manifests, and every desktop capability. It
is part of `desktop:smoke`; a partial or accidental activation fails before a
release build.

## Unsupported activation boundary

Automatic-update activation is outside the funded roadmap. If that decision is
revisited in the future, changing the descriptor to `ENABLED` is accepted only
when one change supplies
all structural prerequisites:

- `bundle.createUpdaterArtifacts` is exactly `true`;
- both official Tauri updater dependencies are installed;
- `plugins.updater` contains the same inline public key and endpoint as the
  descriptor;
- the desktop capability grants `updater:default`;
- the endpoint uses HTTPS and is either a static URL ending in `/latest.json`,
  or contains each supported variable exactly once: `{{target}}`, `{{arch}}`,
  and `{{current_version}}`;
- partial, duplicate, or unknown endpoint variables and dangerous insecure
  transport opt-outs are rejected.

These checks establish configuration consistency only. They do not validate a
private signing key, sign an artifact, host or query an endpoint, validate a
remote update manifest, exercise upgrade/rollback behavior, or prove platform
installation. Activation still requires signed artifacts, hosted-manifest
tests, packaged update tests on every advertised platform, credential handling,
and release evidence. Until those external and platform gates pass, the
descriptor must remain `DISABLED_UNCONFIGURED` and release notes must not claim
automatic updates.
