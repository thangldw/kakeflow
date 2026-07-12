# Packaged application smoke test

KakeFlow's packaged smoke harness launches the same native artifact that CI
packages for users. It verifies all of the following before the process exits:

- the native process and `main` WebView window boot;
- frontend-to-Rust IPC can invoke `app_bootstrap`;
- SQLCipher opens an isolated database and every migration applies;
- SQLite's integrity check succeeds;
- the app exits cleanly and leaves a machine-readable success result.

## Isolation

The harness creates a new directory below the operating system's temporary
directory and passes it as `KAKEFLOW_SMOKE_ROOT`. In this mode KakeFlow:

- does not use the normal application-data directory;
- does not read or write the database key in Keychain or Credential Manager;
- does not participate in production single-instance locking;
- does not start background folder discovery;
- removes the temporary database and result after validation.

`KAKEFLOW_PACKAGED_SMOKE` is not sufficient by itself: an absolute
`KAKEFLOW_SMOKE_ROOT` is required. The smoke-only IPC endpoint rejects calls in
normal application mode.

## Local use

Build the unsigned artifact for the current platform, then launch it through
the harness:

```sh
# macOS
APPLE_SIGNING_IDENTITY=- npm run desktop:build:mac
npm run test:packaged

# Windows
npm run desktop:build:windows
npm run test:packaged
```

Set `KAKEFLOW_KEEP_SMOKE_DATA=1` only while debugging to retain the temporary
directory. `KAKEFLOW_SMOKE_EXECUTABLE` can point at another compatible build.

## Scope and limitations

This is a deterministic launch/IPC/migration test, not a complete visual UI
automation suite. It does not click every screen, inspect rendering pixels,
exercise OS file-picker dialogs, install the NSIS package, or validate signing,
notarization, Gatekeeper, and SmartScreen behavior. Those checks need signed
release credentials and/or a dedicated interactive runner.
