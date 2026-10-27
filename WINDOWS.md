# Windows QA release setup

This adds a separate Windows x64 release pipeline. Existing Mac workflows, keys,
tags and `channels/{qa,stable}.json` remain unchanged. No Windows release or
production signing identity has been configured or published by this change.

## Preconditions

1. Review/merge the Windows source implementation and the public automation.
2. Pass both exact-main source CI and **Epikur Windows checks**, including the
   real installer/application/browser/N→N+1 acceptance on an ephemeral runner.
3. Select a genuine Windows signing identity. The current workflow supports a
   certificate signing provider; it must not be enabled with a fixture identity.
4. Configure the separate environments and keys below, then pin reviewed SHAs.
5. Enable queue/publication and publish a first signed Windows QA release.

## Environment separation

| Environment | Purpose | Protection |
|---|---|---|
| existing `desktop-source` | Read-only source inspection/build | Existing main policy |
| `desktop-windows-signing` | Windows signing + Windows manifest keys | Reviewed main only |
| `desktop-windows-publish` | QA publication | Reviewed main only |
| `desktop-windows-live` | Stable publication | Main only; required reviewer `epikurai` |

The signing job needs the existing read-only `EPIKUR_DESKTOP_SOURCE_KEY` scoped
to its environment. The live/QA publication environments need that same
read-only source access for ancestry checks. Do not copy Apple credentials.

For the certificate-provider workflow, place `WINDOWS_PFX_BASE64` and
`WINDOWS_PFX_PASSWORD` only in `desktop-windows-signing` when the certificate
issuer actually permits export/use that way. A hardware/cloud key requires its
reviewed integration; do not export or weaken it to fit this template.

Generate separate Ed25519 Windows QA/stable manifest keys. Commit **public keys
only** as `keys/windows-qa.pem` and `keys/windows-stable.pem`. Store their private
keys only in `desktop-windows-signing` as `EPIKUR_WINDOWS_QA_MANIFEST_KEY` and
`EPIKUR_WINDOWS_STABLE_MANIFEST_KEY`. Do not reuse Mac keys or fixture keys.

## Variables

| Repository | Variable | Value |
|---|---|---|
| public release | `EPIKUR_WINDOWS_CERTIFICATE_SHA256` | Verified Windows publisher leaf certificate DER SHA-256 |
| public release | `EPIKUR_WINDOWS_TRUSTED_SIGNER_SHA` | Reviewed private source commit containing signer/native verifier |
| public release | `EPIKUR_WINDOWS_RELEASE_ENABLED` | Keep absent/false until all prerequisites pass |
| private source | `EPIKUR_WINDOWS_RELEASE_AUTOMATION_SHA` | Reviewed public automation main commit |
| private source | `EPIKUR_WINDOWS_RELEASE_ENABLED` | Keep absent/false until all prerequisites pass |

The source queue uses its existing `EPIKUR_RELEASE_QUEUE_KEY` solely to create a
new `requests/windows-qa/<sha>` branch containing `windows-candidate.json`.
Both the base source CI and Windows CI must have passed for that exact current
main commit. Older successful runs cannot publish an older source.

## Artifact and approval binding

Windows manifests use `schema: 2`, `component: desktop_windows`,
`platform: win32-x64`, Windows app IDs, and explicit source SHA/tree. The
manifest signature binds both the payload ZIP and initial Setup.exe.

- Tags: `windows-qa-2.0.N-qa.1` and `windows-stable-2.0.N`.
- Feeds: `channels/windows/{qa,stable}.json`.
- QA assets: `Epikur-QA-Windows-<version>-win32-x64.zip`,
  `Epikur-QA-Windows-<version>-Setup.exe`, `manifest.json`,
  `windows-release.json`.
- Stable promotion requires the signed installed Windows QA tag, never a Mac
  tag or an arbitrary branch name. Stable publication waits for the separate
  `desktop-windows-live` reviewer gate.

Inspect/build/sign/publish run separately. Candidate source executes without
signing credentials. A pinned signer validates candidate bytes as data and
builds native helpers from reviewed signer source. Loader-override files next
to .NET wrappers are rejected; the credential-bearing job executes its verifier
only from pristine trusted scratch. Artifacts and signed public manifests are
read back and rehashed before only the selected Windows feed advances.

The source/build provenance model authenticates the selected approved build;
it is not a second independent reconstruction of vendor binaries/renderer
output. Production activation still requires actual Windows acceptance.

## Signing renewal and Artifact Signing

The immutable launcher v1 binds a certificate identity. A certificate change
needs an explicit trusted bootstrap migration; the current bootstrap refuses
to overwrite an existing installation and never removes user profiles.

Microsoft Artifact Signing renews leaf certificates daily and provides a
durable profile-specific EKU. Do not configure it by pinning today's leaf
certificate into this v1 launcher: subsequent releases would fail identity
checks. A durable profile-EKU trust implementation and cloud signing workflow
are a separate prerequisite for that provider. See [Microsoft documentation](https://learn.microsoft.com/en-us/azure/artifact-signing/concept-certificate-management).

No subscription, certificate purchase, production secret, external publication
or user-PC installation is performed by these files alone.
