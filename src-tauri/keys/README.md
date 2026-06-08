# Tauri Updater Signing Key

This directory contains the Tauri 2 updater signing keypair.

## Files

- `hws.key.pub` — **committed**. The public half is embedded in
  `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`. End-user
  installs verify update signatures against this key.
- `hws.key` — **never commit**. The private half. The `.gitignore` in
  this folder excludes `*.key`, `*.key.password`, and `*.key.b64`.

## How signing works

1. CI reads the private key from the `TAURI_SIGNING_PRIVATE_KEY`
   repository secret and writes it to `keys/hws.key` before invoking
   `cargo tauri build`.
2. The Tauri bundler signs each `*.nsis.exe`, `*.dmg`, `*.deb`,
   `*.AppImage` and the matching `*.sig` files, then uploads them to
   the GitHub Release.
3. The end-user app calls `app.updater().check()` which downloads the
   JSON manifest from `plugins.updater.endpoints`, fetches the
   signature, and verifies it against the embedded public key.

## How to rotate the key

```bash
# 1. Generate a new keypair (passphrase protected)
cd src-tauri
cargo tauri signer generate -w keys/hws.key -p "<new-passphrase>"

# 2. Replace the public key in tauri.conf.json
cat keys/hws.key.pub
# → paste into plugins.updater.pubkey

# 3. Re-encrypt the private key for the CI secret
#    (the secret must be the literal base64 contents of hws.key)
cat keys/hws.key
# → paste into repo Settings → Secrets → TAURI_SIGNING_PRIVATE_KEY

# 4. Burn the old key — once rotated, all in-the-wild clients with
#    the old pubkey will refuse future updates until they upgrade
#    out-of-band.
```

The existing key was generated on 2026-06-07 with passphrase
`hermes-workspace-updater-2026`. Rotate at least annually or
immediately if the key is exposed.
