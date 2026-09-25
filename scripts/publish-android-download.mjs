// Copies signed release APKs into the web app so loohar.com/download can serve them.
//
//   node scripts/publish-android-download.mjs [--allow-environment staging]
//
// Loohar distributes its Android apps directly rather than through a store, so this directory is
// the distribution channel. Whatever lands here is what a restaurant installs.
//
// Two things are therefore refused rather than warned about:
//
//   - An APK built against anything other than production. The API a build talks to is fixed at
//     build time and cannot be changed after install, so publishing a staging build would hand a
//     restaurant an app that quietly writes to test data. --allow-environment exists for a
//     deliberate pilot and must be typed out.
//   - An unsigned APK. Android cannot install one, so it would be a download that silently fails.
//
// Version and size on the page come from the manifest written here, so the page can never claim a
// version that was not actually published beside it.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const APPS = {
  pos: { package: "com.loohar.pos", file: "loohar-pos.apk" },
  driver: { package: "com.loohar.driver", file: "loohar-driver.apk" },
  restaurant: { package: "com.loohar.restaurant", file: "loohar-restaurant.apk" }
};

const root = resolve(import.meta.dirname, "..");
const destination = join(root, "apps/web/public/download");

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
const allowedEnvironment = argument("allow-environment", "production");

const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  || "/opt/homebrew/share/android-commandlinetools";
const buildTools = (() => {
  try {
    return readdirSync(join(androidHome, "build-tools")).sort().pop() || "";
  } catch {
    return "";
  }
})();
const aapt2 = join(androidHome, "build-tools", buildTools, "aapt2");
const apksigner = join(androidHome, "build-tools", buildTools, "apksigner");

// apksigner is a shell wrapper around a Java tool, and Homebrew's JDK is keg-only so `java` is not
// on PATH. Resolve it here rather than requiring every caller to export JAVA_HOME.
const javaHome = process.env.JAVA_HOME || [
  "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home",
  "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home"
].find((candidate) => existsSync(candidate)) || "";
const toolEnv = { ...process.env, ...(javaHome ? { JAVA_HOME: javaHome } : {}) };

function badging(apk) {
  return execFileSync(aapt2, ["dump", "badging", apk], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, env: toolEnv });
}

// The environment is written into the bundle at build time by scripts/write-web-version.mjs, so it
// is read back out of the APK rather than taken from a flag a person could get wrong.
function bundledEnvironment(apk) {
  const listed = execFileSync("unzip", ["-p", apk, "assets/public/version.json"], {
    encoding: "utf8", maxBuffer: 4 * 1024 * 1024
  });
  return JSON.parse(listed);
}

mkdirSync(destination, { recursive: true });
const problems = [];
const published = [];

for (const [app, meta] of Object.entries(APPS)) {
  const apk = join(root, "apps/mobile", app, "android/app/build/outputs/apk/release/app-release.apk");
  if (!existsSync(apk)) {
    problems.push(`${app}: no release APK. Build it with: npm run build:android -- --app ${app} --env production --release`);
    continue;
  }

  const verified = execFileSync(apksigner, ["verify", "--print-certs", apk], { encoding: "utf8", env: toolEnv });
  const certificate = (verified.match(/SHA-256 digest: (\S+)/) || [])[1] || "";
  if (!certificate) {
    problems.push(`${app}: the APK is not signed, so Android cannot install it.`);
    continue;
  }

  const version = bundledEnvironment(apk);
  if (version.environment !== allowedEnvironment) {
    problems.push(
      `${app}: built against ${version.environment}, refusing to publish. A restaurant installing ` +
      `this would write to ${version.environment} data. Rebuild with --env production, or pass ` +
      `--allow-environment ${version.environment} if that is genuinely what you want to hand out.`
    );
    continue;
  }

  const badge = badging(apk);
  const packageName = (badge.match(/package: name='([^']+)'/) || [])[1];
  if (packageName !== meta.package) {
    problems.push(`${app}: APK declares ${packageName}, expected ${meta.package}.`);
    continue;
  }

  copyFileSync(apk, join(destination, meta.file));
  const bytes = statSync(join(destination, meta.file)).size;
  writeFileSync(join(destination, `${meta.file}.json`), JSON.stringify({
    app,
    package: packageName,
    versionName: (badge.match(/versionName='([^']+)'/) || [])[1] || "",
    versionCode: (badge.match(/versionCode='([^']+)'/) || [])[1] || "",
    environment: version.environment,
    commitSha: version.commitSha,
    certificateSha256: certificate,
    bytes,
    builtAt: new Date().toISOString()
  }, null, 2) + "\n");
  published.push(`${meta.file}  ${(bytes / 1048576).toFixed(1)} MB  ${version.environment}  ${String(version.commitSha).slice(0, 12)}`);
}

for (const line of published) console.log(`published  ${line}`);
if (problems.length) {
  console.error(`\nRefused to publish ${problems.length} app(s):\n`);
  for (const problem of problems) console.error(`  - ${problem}\n`);
  process.exit(1);
}
console.log(`\n${published.length} app(s) in apps/web/public/download. They go live when main deploys.`);
