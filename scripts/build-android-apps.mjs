// Builds installable Android artifacts for the Loohar apps.
//
//   node scripts/build-android-apps.mjs --app pos|driver|restaurant|all --env staging|production [--release]
//
// Debug builds produce an APK that can be installed on an emulator or a device with USB debugging.
// --release produces an AAB for Play, which needs an upload keystore (owner action) and is refused
// here unless one is configured, so an unsigned artifact can never be mistaken for a releasable one.
//
// Everything this script needs is installed except the Android SDK licence, which must be accepted
// by a person. The script checks for it first and prints the exact command rather than failing deep
// inside Gradle.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const APPS = ["pos", "driver", "restaurant"];
const root = resolve(import.meta.dirname, "..");

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
const release = process.argv.includes("--release");
const environment = argument("env", "staging");
const selected = argument("app", "all");
const apps = selected === "all" ? APPS : [selected];
if (!apps.every((app) => APPS.includes(app))) {
  console.error(`Unknown --app ${selected}. Use ${APPS.join(", ")} or all.`);
  process.exit(1);
}

function firstExisting(paths) {
  return paths.find((candidate) => candidate && existsSync(candidate)) || "";
}

const javaHome = process.env.JAVA_HOME || firstExisting([
  "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home",
  "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home"
]);
const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || firstExisting([
  "/opt/homebrew/share/android-commandlinetools",
  join(process.env.HOME || "", "Library/Android/sdk")
]);

const problems = [];
if (!javaHome) problems.push("JDK 21 not found. Install it with: brew install openjdk@21");
if (!androidHome) problems.push("Android SDK not found. Install it with: brew install --cask android-commandlinetools");

// The licence is recorded as files under <sdk>/licenses. Only a person may accept it.
const licenceDir = androidHome ? join(androidHome, "licenses") : "";
const licencesAccepted = licenceDir && existsSync(licenceDir) && readdirSync(licenceDir).length > 0;
if (androidHome && !licencesAccepted) {
  problems.push([
    "The Android SDK licence has not been accepted. This is an owner action: Loohar will not accept a",
    "licence agreement on the owner's behalf. Run this once, read it, and accept:",
    "",
    `  yes | ${join(androidHome, "cmdline-tools/latest/bin/sdkmanager")} --licenses`,
    "",
    "then install the build packages:",
    "",
    `  ${join(androidHome, "cmdline-tools/latest/bin/sdkmanager")} "platform-tools" "platforms;android-36" "build-tools;36.0.0"`
  ].join("\n"));
}

if (problems.length) {
  console.error("Android builds are not ready yet:\n");
  for (const problem of problems) console.error(`- ${problem}\n`);
  console.error("Everything else is prepared: once the above is done, this same command builds the APKs.");
  process.exit(2);
}

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) process.exit(result.status || 1);
}

for (const app of apps) {
  const appDir = join(root, "apps/mobile", app);
  console.log(`\n== Loohar ${app} (Android, ${environment}) ==`);
  run("node", ["scripts/build-native-apps.mjs", "--app", app, "--env", environment], { cwd: root });

  const keystore = process.env.LOOHAR_ANDROID_KEYSTORE || "";
  if (release && !keystore) {
    console.error("A release AAB needs an upload keystore. Set LOOHAR_ANDROID_KEYSTORE (owner action).");
    process.exit(2);
  }
  const task = release ? "bundleRelease" : "assembleDebug";
  run("./gradlew", [task, "--no-daemon"], {
    cwd: join(appDir, "android"),
    env: { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: androidHome, ANDROID_SDK_ROOT: androidHome }
  });

  const outputs = release
    ? join(appDir, "android/app/build/outputs/bundle/release")
    : join(appDir, "android/app/build/outputs/apk/debug");
  const artifacts = existsSync(outputs) ? readdirSync(outputs).filter((name) => /\.(apk|aab)$/.test(name)) : [];
  let sha = "";
  try {
    sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim().slice(0, 12);
  } catch {
    sha = "unknown";
  }
  for (const artifact of artifacts) {
    console.log(`Built ${join(outputs, artifact)}  (${environment}, ${sha})`);
  }
  if (!artifacts.length) console.warn(`No artifact found in ${outputs}.`);
}
