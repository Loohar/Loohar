// Drives the installed Loohar apps through their real interface on an iOS Simulator.
//
//   node scripts/test-native-ui.mjs --app pos|driver|restaurant|all [--env staging|production]
//
// A launch screenshot proves only that a process started. This builds the app, installs it on a
// simulator, and runs XCUITest against the live view hierarchy: the sign-in screen the app routes
// to, the fields a person types into, and the app's own live-API indicator, which it fills in from a
// real request to the environment it was built for.
//
// The tests live in apps/mobile/uitests, deliberately outside the Capacitor projects, because
// `npx cap add ios` regenerates those from a template and would discard a target added there. The
// Xcode project is generated from project.yml by XcodeGen, so it is a build artifact, not source.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const APPS = { pos: "com.loohar.pos", driver: "com.loohar.driver", restaurant: "com.loohar.restaurant" };
const root = resolve(import.meta.dirname, "..");
const uiTestDir = join(root, "apps/mobile/uitests");

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
const environment = argument("env", "staging");
const selected = argument("app", "all");
const apps = selected === "all" ? Object.keys(APPS) : [selected];
if (!apps.every((app) => APPS[app])) {
  console.error(`Unknown --app ${selected}. Use ${Object.keys(APPS).join(", ")} or all.`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) process.exit(result.status || 1);
}
function capture(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", ...options }).trim();
}

if (!existsSync("/Applications/Xcode.app")) {
  console.error("Xcode is required to drive the apps. Install it, or run the network-contract certification instead:");
  console.error("  node scripts/certify-pilot-staging.mjs --as-native-app capacitor://localhost");
  process.exit(2);
}
try {
  capture("which", ["xcodegen"]);
} catch {
  console.error("XcodeGen is required to generate the UI test project: brew install xcodegen");
  process.exit(2);
}

// Reuse a booted simulator when there is one, so a person watching can see the run.
function simulatorUdid() {
  const devices = JSON.parse(capture("xcrun", ["simctl", "list", "devices", "available", "-j"])).devices;
  const all = Object.entries(devices).filter(([runtime]) => runtime.includes("iOS")).flatMap(([, list]) => list);
  const booted = all.find((device) => device.state === "Booted");
  if (booted) return booted.udid;
  const iphone = all.find((device) => device.name.startsWith("iPhone"));
  if (!iphone) {
    console.error("No iOS Simulator is available. Install an iOS runtime in Xcode.");
    process.exit(2);
  }
  run("xcrun", ["simctl", "boot", iphone.udid]);
  spawnSync("xcrun", ["simctl", "bootstatus", iphone.udid, "-b"], { stdio: "ignore" });
  return iphone.udid;
}

const udid = simulatorUdid();
run("xcodegen", ["generate"], { cwd: uiTestDir });

const failures = [];
for (const app of apps) {
  const bundleId = APPS[app];
  console.log(`\n== Loohar ${app} (${bundleId}, ${environment}) ==`);
  run("node", ["scripts/build-native-apps.mjs", "--app", app, "--env", environment], { cwd: root });

  const derivedData = join(tmpdir(), `loohar-ui-${app}`);
  run("xcodebuild", [
    "-project", "App.xcodeproj", "-scheme", "App", "-configuration", "Debug",
    "-sdk", "iphonesimulator", "-destination", "generic/platform=iOS Simulator",
    "-derivedDataPath", derivedData,
    // Without this, a non-interactive xcodebuild waits silently on a Keychain prompt.
    "-packageAuthorizationProvider", "netrc",
    "-skipPackagePluginValidation", "-skipMacroValidation",
    "CODE_SIGNING_ALLOWED=NO", "build"
  ], { cwd: join(root, "apps/mobile", app, "ios/App"), stdio: "ignore" });

  const appBundle = join(derivedData, "Build/Products/Debug-iphonesimulator/App.app");
  run("xcrun", ["simctl", "install", udid, appBundle]);

  const test = spawnSync("xcodebuild", [
    "test", "-project", "LooharUITests.xcodeproj", "-scheme", "LooharUITests",
    "-destination", `platform=iOS Simulator,id=${udid}`,
    "-derivedDataPath", join(tmpdir(), "loohar-ui-runner"),
    "CODE_SIGNING_ALLOWED=NO", `TEST_RUNNER_LOOHAR_APP_BUNDLE_ID=${bundleId}`
  ], { cwd: uiTestDir, encoding: "utf8" });

  const passed = [...String(test.stdout).matchAll(/Test Case '-\[\S+ (\w+)\]' passed/g)].map((match) => match[1]);
  const failed = [...String(test.stdout).matchAll(/Test Case '-\[\S+ (\w+)\]' failed/g)].map((match) => match[1]);
  for (const name of passed) console.log(`  PASS  ${name}`);
  for (const name of failed) console.log(`  FAIL  ${name}`);
  if (test.status !== 0 || failed.length) {
    failures.push(app);
    console.error(`  ${app}: UI tests failed. Full log follows.\n${String(test.stdout).slice(-4000)}`);
  }
}

if (failures.length) {
  console.error(`\nUI certification failed for: ${failures.join(", ")}`);
  process.exit(1);
}
console.log(`\nUI certification passed for: ${apps.join(", ")}`);
