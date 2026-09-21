// Drives the installed Loohar apps through their real interface on an Android emulator.
//
//   node scripts/test-android-ui.mjs --app pos|driver|restaurant|all [--env staging|production]
//
// The Android counterpart of scripts/test-native-ui.mjs. Installing an APK proves only that it
// parses; this installs it on a running emulator, launches it, and asserts against the live DOM
// inside the WebView: the sign-in screen the app routes to, the fields a person types into, and the
// app's own live-API indicator, which it fills in from a real request to the environment it was
// built for. A refused CORS origin or a wrong API URL fails that assertion.
//
// The DOM is read over the Chrome DevTools Protocol rather than `uiautomator dump`, because Chromium
// only populates the accessibility tree when an accessibility service is attached, so a uiautomator
// dump of a Capacitor app contains the WebView node and no text at all. Debug builds enable the
// devtools socket, which is why this certifies the debug APK.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const APPS = { pos: "com.loohar.pos", driver: "com.loohar.driver", restaurant: "com.loohar.restaurant" };
const AVD_NAME = "loohar-cert";
const DEVTOOLS_PORT = 9222;
const root = resolve(import.meta.dirname, "..");

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

function firstExisting(paths) {
  return paths.find((candidate) => candidate && existsSync(candidate)) || "";
}
const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || firstExisting([
  "/opt/homebrew/share/android-commandlinetools",
  join(process.env.HOME || "", "Library/Android/sdk")
]);
const javaHome = process.env.JAVA_HOME || firstExisting([
  "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home",
  "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home"
]);
if (!androidHome || !javaHome) {
  console.error("Android builds are not ready. Run: node scripts/build-android-apps.mjs --app pos");
  process.exit(2);
}
const adb = join(androidHome, "platform-tools/adb");
const emulator = join(androidHome, "emulator/emulator");
if (!existsSync(adb)) {
  console.error(`adb not found at ${adb}. Install it: sdkmanager "platform-tools"`);
  process.exit(2);
}
const environmentWithSdk = { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: androidHome, ANDROID_SDK_ROOT: androidHome };

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", env: environmentWithSdk, ...options });
  if (result.status !== 0) process.exit(result.status || 1);
}
function capture(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", env: environmentWithSdk, ...options });
  return String(result.stdout || "").trim();
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Reuse a running emulator when there is one, so a person watching can see the run.
async function ensureEmulator() {
  const attached = capture(adb, ["devices"]).split("\n").slice(1).some((line) => line.includes("\tdevice"));
  if (attached) return;
  if (!existsSync(emulator)) {
    console.error(`No emulator is running and none is installed. Install one:\n  sdkmanager "emulator" "system-images;android-36;google_apis;arm64-v8a"\n  avdmanager create avd -n ${AVD_NAME} -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_7`);
    process.exit(2);
  }
  const available = capture(emulator, ["-list-avds"]).split("\n").map((name) => name.trim()).filter(Boolean);
  const avd = available.includes(AVD_NAME) ? AVD_NAME : available[0];
  if (!avd) {
    console.error(`No AVD exists. Create one:\n  avdmanager create avd -n ${AVD_NAME} -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_7`);
    process.exit(2);
  }
  console.log(`Booting emulator ${avd}...`);
  spawnSync("sh", ["-c", `"${emulator}" -avd ${avd} -no-window -no-audio -no-boot-anim -no-snapshot >/dev/null 2>&1 &`], { env: environmentWithSdk });
  run(adb, ["wait-for-device"], { stdio: "ignore" });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (capture(adb, ["shell", "getprop", "sys.boot_completed"]) === "1") return;
    await sleep(2000);
  }
  console.error("The emulator did not finish booting.");
  process.exit(1);
}

// One CDP connection per app, used to read the page the way a person sees it.
async function connectToWebView(packageName) {
  const pid = capture(adb, ["shell", "pidof", packageName]);
  if (!pid) throw new Error(`${packageName} is not running`);
  capture(adb, ["forward", "--remove", `tcp:${DEVTOOLS_PORT}`]);
  run(adb, ["forward", `tcp:${DEVTOOLS_PORT}`, `localabstract:webview_devtools_remote_${pid}`], { stdio: "ignore" });

  let page = null;
  for (let attempt = 0; attempt < 30 && !page; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json/list`)).json();
      page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
    } catch {
      page = null;
    }
    if (!page) await sleep(1000);
  }
  if (!page) throw new Error("the app's WebView never exposed a devtools target");

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 0;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", () => reject(new Error("could not attach to the WebView")));
  });
  const evaluate = async (expression) => {
    const id = ++nextId;
    const reply = await new Promise((resolve) => {
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.text);
    return reply.result?.result?.value;
  };
  return { evaluate, close: () => socket.close() };
}

// The app fills its own indicator in from a real request, so it can lag the first paint.
async function waitFor(evaluate, expression, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await evaluate(expression);
    if (last) return last;
    await sleep(1000);
  }
  return last;
}

const results = [];
function check(app, name, passed, detail) {
  results.push({ app, name, passed });
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${passed || !detail ? "" : ` — ${detail}`}`);
}

await ensureEmulator();
console.log(`Emulator: ${capture(adb, ["shell", "getprop", "ro.product.model"])} / Android ${capture(adb, ["shell", "getprop", "ro.build.version.release"])} (${capture(adb, ["shell", "getprop", "ro.product.cpu.abi"])})`);

for (const app of apps) {
  const packageName = APPS[app];
  console.log(`\n== Loohar ${app} (${packageName}, ${environment}) ==`);
  run("node", ["scripts/build-android-apps.mjs", "--app", app, "--env", environment], { cwd: root });

  const apk = join(root, "apps/mobile", app, "android/app/build/outputs/apk/debug/app-debug.apk");
  if (!existsSync(apk)) {
    check(app, "the APK was built", false, apk);
    continue;
  }
  capture(adb, ["uninstall", packageName]);
  run(adb, ["install", "-r", apk], { stdio: "ignore" });
  capture(adb, ["logcat", "-c"]);
  // `monkey` reports success without starting a Capacitor activity; an explicit start does not.
  const started = capture(adb, ["shell", "am", "start", "-W", "-n", `${packageName}/${packageName}.MainActivity`]);
  check(app, "the app launches", /Status: ok/.test(started) && Boolean(capture(adb, ["shell", "pidof", packageName])), started.slice(0, 200));

  let session = null;
  try {
    session = await connectToWebView(packageName);
  } catch (error) {
    check(app, "the app renders a web view", false, error.message);
    continue;
  }

  try {
    const url = await waitFor(session.evaluate, "location.pathname.includes('/login') ? location.href : ''");
    check(app, "it routes to its own sign-in screen", Boolean(url), `at ${await session.evaluate("location.href")}`);

    const fields = await session.evaluate(`JSON.stringify([...document.querySelectorAll("input")].map((input) => input.type))`);
    const types = JSON.parse(fields || "[]");
    check(app, "the sign-in form has an email and a password field", types.includes("email") && types.includes("password"), fields);

    // The app writes "Connected" only after a real request to the API it was built against.
    const indicator = await waitFor(session.evaluate, `/Live API\\s*Connected/i.test(document.body.innerText) ? "Connected" : ""`);
    const shown = await session.evaluate(`(document.body.innerText.match(/Live API\\s*\\S+/i) || ["not shown"])[0]`);
    check(app, `it reaches the ${environment} API it was built against`, indicator === "Connected", shown);

    const typed = await session.evaluate(`(() => {
      const setValue = (element, value) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
      };
      const email = document.querySelector('input[type="email"]');
      const password = document.querySelector('input[type="password"]');
      if (!email || !password) return "";
      setValue(email, "certification@loohar.test");
      setValue(password, "not-a-real-password");
      return JSON.stringify({ email: email.value, masked: password.type === "password" });
    })()`);
    const entry = typed ? JSON.parse(typed) : {};
    check(app, "the form accepts typing and masks the password", entry.email === "certification@loohar.test" && entry.masked === true, typed);

    const crashes = capture(adb, ["logcat", "-d", "-b", "crash"]);
    check(app, "nothing crashed while it ran", !crashes.includes(packageName), crashes.split("\n").slice(-3).join(" "));
  } finally {
    session.close();
    capture(adb, ["forward", "--remove", `tcp:${DEVTOOLS_PORT}`]);
    capture(adb, ["shell", "am", "force-stop", packageName]);
    capture(adb, ["uninstall", packageName]);
  }
}

const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed across: ${apps.join(", ")}`);
if (failed.length) {
  console.error(`Android UI certification failed: ${failed.map((result) => `${result.app}/${result.name}`).join("; ")}`);
  process.exit(1);
}
console.log(`Android UI certification passed for: ${apps.join(", ")}`);
