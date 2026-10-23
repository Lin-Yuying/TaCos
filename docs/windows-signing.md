# Windows code signing

The Windows installers are not signed by default. Windows 11 **Smart App Control** blocks
unsigned installers outright (there is no "run anyway"), and SmartScreen shows a warning on
machines where Smart App Control is off. A trusted code signature is the only fix for Smart
App Control.

## How the workflow behaves

[`.github/workflows/windows-release.yml`](../.github/workflows/windows-release.yml) builds
the local (embedded server) installer on `windows-latest`. It runs when you:

- start it manually from **Actions → Windows installer → Run workflow**, or
- push a tag like `v0.1.0`.

Every run uploads an **unsigned** artifact. If SignPath credentials are configured, the same
run also submits the installer for signing and uploads a **signed** artifact. On tag pushes
the signed installer (or the unsigned one when signing is skipped) is attached to a GitHub
Release.

## SignPath Foundation (free for open source)

SignPath Foundation signs open-source projects at no cost. Apply at
<https://signpath.org/apply> with the repository URL
(<https://github.com/Lin-Yuying/tacos>) and point them at the MIT license. Projects must be
public and artifacts must be built from the project's own source, which is what this workflow
does.

After the application is approved:

1. In SignPath, create a project for `Lin-Yuying/tacos` and a signing policy for releases.
2. Create an artifact configuration that covers the NSIS installer
   (`Tacos-Local-Setup-<version>.exe`) and the application executable inside it
   (`Tacos.exe`). Both executables need a signature, because Smart App Control checks every
   executable it launches.
3. Install the SignPath GitHub App on the repository so SignPath can verify the artifact's
   origin.
4. In the GitHub repository, open **Settings → Secrets and variables → Actions** and add:

   | Kind | Name | Value |
   | --- | --- | --- |
   | Secret | `SIGNPATH_API_TOKEN` | Token from SignPath (project-scoped) |
   | Variable | `SIGNPATH_ORGANIZATION_ID` | Organization ID shown in SignPath |
   | Variable | `SIGNPATH_PROJECT_SLUG` | Project slug in SignPath |
   | Variable | `SIGNPATH_SIGNING_POLICY_SLUG` | Signing policy slug, e.g. `release-signing` |
   | Variable | `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | Artifact configuration slug (may be left empty if the project has a default) |

5. Re-run the workflow (or push a tag). When `SIGNPATH_API_TOKEN` exists, the workflow signs
   the uploaded installer and waits for the signing request to finish.

## Verify a signed build

On Windows:

```powershell
Get-AuthenticodeSignature .\Tacos-Local-Setup-0.1.0.exe | Format-List Status, SignerCertificate
```

`Status` must be `Valid`. A new certificate can still trigger a SmartScreen reputation
warning, but Smart App Control accepts signatures from a CA in the Microsoft Trusted Root
program.

## Other signing options

- **OV certificate with cloud signing** (SSL.com eSigner, DigiCert KeyLocker, Certum). Since
  June 2023 the CA/Browser Forum requires the private key to live in an HSM or a cloud
  signing service, so CAs no longer hand out exportable `.pfx` files. This path needs a
  custom signing step in the workflow.
- **EV certificate**: no longer buys SmartScreen reputation; not worth the extra cost.
- **Azure Trusted Signing**: not available to organizations outside the US/Canada.

macOS signing and notarization are separate and not covered by this workflow.
