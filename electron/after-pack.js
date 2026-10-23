const { execFileSync } = require("node:child_process");
const path = require("node:path");

// Apple silicon refuses unsigned app bundles downloaded through Gatekeeper with
// "is damaged", so ad-hoc sign after packing. Developer ID signing, when
// configured, runs later and replaces this signature.
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );

  execFileSync(
    "/usr/bin/codesign",
    ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath],
    { stdio: "inherit" },
  );
  execFileSync(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", appPath],
    { stdio: "inherit" },
  );
};
