# Epikur desktop releases

This repository contains public release automation, public verification keys, signed update manifests and GitHub Release installers. The private source checkout, backend code and tests are never committed here or retained as artifacts; installer archives contain only the application payload intended for distribution.

- **Epikur QA** receives a new Apple-signed, notarized build after a successful `main` CI run in `epikurai/epikur_2.0`. The private source workflow queues one immutable `requests/qa/<source SHA>` branch with a three-field `candidate.json`.
- **Epikur** receives updates only through the manual **Desktop release** workflow followed by human approval. Choose `stable` and an existing QA release tag. The workflow verifies that QA release's Ed25519 signature and builds the stable app from the same source commit. Its signed artifact is available for installation before publication; the GitHub Release and live update feed remain blocked until the required reviewer approves the `desktop-live` environment.
- The apps have separate bundle identities, local profiles, URL schemes, manifest keys and update feeds. They cannot install each other's updates. Separate local profiles do not create separate server accounts or backend data.

## Release flow

An unprivileged candidate workflow triggers the privileged workflow through `workflow_run` on reviewed default `main`. Requests are inspected as data; the privileged workflow never checks out request-branch code. Main-only GitHub environments protect all credentials, and `main` protection prevents deploy keys or the workflow token from rewriting the release automation.

Ubuntu checks the request without running application code. A read-only deploy key fetches the exact source commit and verifies its Git tree and ancestry on source `main`. A Mac build job removes that key before running candidate dependencies, tests and packaging. A separate, fresh Mac signing job fetches a reviewed signer commit pinned by `EPIKUR_TRUSTED_SIGNER_SHA`; it treats the candidate app strictly as data and uses a bounded ZIP reader for extraction. It compares desktop files with the exact source checkout and validates full prepared-bundle inventory before Apple credentials become available. Apple credentials exist only in its signing step, and the channel's private manifest key exists only in its envelope-signing step.

A separate publication job verifies the downloaded artifact, publishes the three exact files, independently downloads and hashes the published ZIP, and then advances the selected channel feed. An older concurrent build cannot replace a newer channel version or move its source backwards or onto a divergent branch. A published version cannot be overwritten with different bytes. Existing releases remain available for traceability. Published recovery uses a reviewed revert committed forward on source `main`; the installed updater separately retains its original app when an individual update transaction fails.

Manual `qa` reissues also require an existing signed QA tag and retain its source commit. Every workflow run receives a monotonically numbered app version. The source commit and app version are bound into the signed release identity.

## Repository configuration

Public keys belong in `keys/qa.pem` and `keys/stable.pem`. Private keys never belong in Git, artifacts or logs. Configure these as environment secrets, with every environment restricted to deployment branch `main`:

| Environment | Secret | Purpose |
| --- | --- | --- |
| `desktop-source`, `desktop-signing`, `desktop-publish`, `desktop-live` | `EPIKUR_DESKTOP_SOURCE_KEY` | Read-only SSH deploy key for private source data and ancestry |
| `desktop-signing` | `CSC_LINK`, `CSC_KEY_PASSWORD` | Existing encrypted Apple Developer ID identity and its password |
| `desktop-signing` | `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | Existing Apple notarization credentials |
| `desktop-signing` | `EPIKUR_QA_MANIFEST_KEY` | QA Ed25519 private key |
| `desktop-signing` | `EPIKUR_STABLE_MANIFEST_KEY` | Stable Ed25519 private key |

The `EPIKUR_TRUSTED_SIGNER_SHA` repository variable pins the reviewed private signer implementation independently of candidate changes. The source repository separately holds a repository-scoped queue deploy key. Its `EPIKUR_RELEASE_AUTOMATION_SHA` variable pins the reviewed automation commit on which requests are based. No personal GitHub access token is copied into either workflow.

The `desktop-live` environment additionally requires approval by `epikurai`. Starting a manual stable build does not approve publication. QA publication continues through `desktop-publish`; it never approves or updates the live channel.

Application test, compiler and package logs are kept only in the ephemeral runner's private temporary directory. They are not uploaded or printed in public CI logs. Uploaded release files are limited to the installer ZIP, a sanitized signing receipt and its signed manifest.

## Downloads and feeds

Installers are attached to each GitHub Release. QA releases are marked prerelease. The apps use `channels/qa.json` and `channels/stable.json` on the separate `feeds` branch through GitHub's raw HTTPS endpoint. The publication token can update `feeds` but cannot change protected release automation on `main`. The initial installer must be downloaded once; subsequent updates run through the installed app's signed update module and preserve that app's profile.

Run automation verification locally with `node --test tools/release-automation.test.cjs`. Tests use generated fixture keys and files; they do not access Apple services or publish releases.
