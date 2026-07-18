# Update channel contract

KakeFlow does not ship an automatic updater. GitHub Releases and manual installation are the supported lifecycle.

`packaging/update-channel.json` declares:

```text
stable -> DISABLED_UNCONFIGURED
```

Tauri updater artifacts, dependencies, plugin configuration, capabilities, signing key, and endpoint are absent. `npm run check:update-channel` cross-checks all of these and runs within desktop smoke; partial activation fails the build.

Future activation would require one atomic change supplying updater artifacts, official dependencies, matching public key/HTTPS endpoint, capability grant, valid endpoint variables, signed artifacts, hosted-manifest validation, credential controls, and packaged upgrade/rollback tests on every advertised platform.

Configuration consistency alone would not prove a secure production updater. Until all external gates pass, release notes must state manual updates only.
