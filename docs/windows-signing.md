# Windows code signing

The Windows installers are not signed by default. Windows 11 **Smart App Control** blocks
unsigned installers outright (there is no "run anyway"), and SmartScreen shows a warning on
machines where Smart App Control is off. A trusted code signature is the only fix for Smart
App Control.

## How the workflow behaves

[`.github/workflows/windows-release.yml`](../.github/workflows/windows-release.yml) builds
the local (embedded server) installers for both platforms. It runs when you:

- start it manually from **Actions → Desktop installers → Run workflow**, or
- push a tag like `v1.0.0`.

Every run produces a Windows NSIS installer (`Tacos-Local-Setup-<version>.exe`, x64) and a
macOS disk image (`Tacos-Local-<version>-arm64.dmg`). If SignPath credentials are configured,
the Windows run also submits the installer for signing before uploading it. On tag pushes the
release job attaches both files to one GitHub Release.

macOS builds get an ad-hoc signature from `electron/after-pack.js`, which is enough for
Gatekeeper to accept the bundle, but they are not notarized: the first launch has to be
allowed under **System Settings → Privacy & Security → Open Anyway**. Seamless distribution
needs an Apple Developer ID certificate and notarization, which is a separate setup and not
covered here.

## SignPath Foundation (free for open source)

SignPath Foundation signs open-source projects at no cost. Apply at
<https://signpath.org/apply> with the repository URL
(<https://github.com/Lin-Yuying/tacos>) and point them at the MIT license. Projects must be
public and artifacts must be built from the project's own source, which is what this workflow
does.

After the application is approved:

1. In SignPath, create a project for `Lin-Yuying/tacos` and a signing policy for releases.
2. Create **two** artifact configurations, because Smart App Control checks every executable
   it launches and SignPath does not sign files nested inside an NSIS installer:
   - **Installer** — covers the NSIS installer `Tacos-Local-Setup-<version>.exe` as a
     `<pe-file>`.
   - **App executable** — covers `Tacos.exe` from the unpacked app directory as a
     `<pe-file>`.
3. Install the SignPath GitHub App on the repository so SignPath can verify the artifact's
   origin.
4. In the GitHub repository, open **Settings → Secrets and variables → Actions** and add:

   | Kind | Name | Value |
   | --- | --- | --- |
   | Secret | `SIGNPATH_API_TOKEN` | Token from SignPath (project-scoped) |
   | Variable | `SIGNPATH_ORGANIZATION_ID` | Organization ID shown in SignPath |
   | Variable | `SIGNPATH_PROJECT_SLUG` | Project slug in SignPath |
   | Variable | `SIGNPATH_SIGNING_POLICY_SLUG` | Signing policy slug, e.g. `release-signing` |
   | Variable | `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | Artifact configuration for the installer |
   | Variable | `SIGNPATH_APP_ARTIFACT_CONFIGURATION_SLUG` | Artifact configuration for `Tacos.exe` |

## Two-stage signing (required for Smart App Control)

A signed installer is not enough: it still contains an unsigned `Tacos.exe`, and Smart App
Control blocks that exe when the installed app starts. The installer has to be built around an
already-signed executable:

1. Package without the installer:
   `npx electron-builder --win --x64 --dir --publish never --config electron/builder.standalone.json`
   → `release-standalone/win-unpacked/Tacos.exe`.
2. Submit `win-unpacked/Tacos.exe` to SignPath with
   `SIGNPATH_APP_ARTIFACT_CONFIGURATION_SLUG`, then replace it with the signed download.
3. Build the installer from that directory:
   `npx electron-builder --win --x64 --prepackaged release-standalone/win-unpacked --publish never --config electron/builder.standalone.json`
   → `release-standalone/Tacos-Local-Setup-<version>.exe`.
4. Submit the installer to SignPath with `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG`.

The workflow currently submits only the NSIS installer (step 4) — the single-stage path is
kept so unsigned builds keep working before SignPath approves the project. Steps 1–3 must be
wired in before the signed build can pass Smart App Control.

## Verify a signed build

On Windows:

```powershell
Get-AuthenticodeSignature .\Tacos-Local-Setup-1.0.0.exe | Format-List Status, SignerCertificate
# After installing:
Get-AuthenticodeSignature "$env:LOCALAPPDATA\Programs\Tacos\Tacos.exe" | Format-List Status, SignerCertificate
```

`Status` must be `Valid` for both. A new certificate can still trigger a SmartScreen
reputation warning, but Smart App Control accepts signatures from a CA in the Microsoft
Trusted Root program.

## Other signing options

- **OV certificate with cloud signing** (SSL.com eSigner, DigiCert KeyLocker, Certum). Since
  June 2023 the CA/Browser Forum requires the private key to live in an HSM or a cloud
  signing service, so CAs no longer hand out exportable `.pfx` files. This path needs a
  custom signing step in the workflow.
- **EV certificate**: no longer buys SmartScreen reputation; not worth the extra cost.
- **Azure Trusted Signing**: not available to organizations outside the US/Canada.

macOS Developer ID signing and notarization are separate and not covered by this workflow.
