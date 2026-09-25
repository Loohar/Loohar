// Builds the Loohar web bundle for the native POS and/or Driver app and syncs it into that app's
// Capacitor project (apps/mobile/<app>). The apps are the web product in a native shell: same
// screens, same API, same server-computed money.
//
//   node scripts/build-native-apps.mjs --app pos|driver|all --env staging|production
//
// Inside the app the page origin is capacitor://localhost (iOS) or https://localhost (Android), so
// every API, health and realtime endpoint must be absolute. A relative "/health" would resolve to the
// app itself and the POS would believe the API is offline. The API must also run with
// ALLOW_NATIVE_APP_ORIGINS=true (see apps/api/src/config/corsPolicy.js).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const ENVIRONMENTS = {
  staging: "https://loohar-api-staging.onrender.com",
  production: "https://loohar-api.onrender.com"
};
const APPS = ["pos", "driver", "restaurant"];

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const environment = argument("env", "staging");
const selected = argument("app", "all");
const apiOrigin = ENVIRONMENTS[environment];
if (!apiOrigin) {
  console.error(`Unknown --env ${environment}. Use one of: ${Object.keys(ENVIRONMENTS).join(", ")}.`);
  process.exit(1);
}
const apps = selected === "all" ? APPS : [selected];
if (!apps.every((app) => APPS.includes(app))) {
  console.error(`Unknown --app ${selected}. Use pos, driver or all.`);
  process.exit(1);
}

const root = resolve(import.meta.dirname, "..");

// An installed app must be able to say which commit produced it. Nothing in a local native build
// sets the CI variables the version writer looks for, so every bundle recorded "unknown" and an
// artifact could not be tied back to a SHA.
function commitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}
const sha = commitSha();
if (!sha) console.warn("Warning: the git commit could not be read, so this build will not record its SHA.");

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    console.error(`${command} ${args.join(" ")} failed.`);
    process.exit(result.status || 1);
  }
}

for (const app of apps) {
  const appDir = join(root, "apps/mobile", app);
  const outDir = join(appDir, "www");
  console.log(`\n== Loohar ${app} (${environment}: ${apiOrigin}) at ${sha ? sha.slice(0, 12) : "unknown commit"} ==`);
  run("npm", ["run", "build", "--workspace", "apps/web", "--", "--outDir", outDir, "--emptyOutDir"], {
    cwd: root,
    env: {
      ...process.env,
      VITE_NATIVE_APP: app,
      GIT_COMMIT_SHA: sha,
      LOOHAR_BUILD_ENVIRONMENT: environment,
      VITE_API_URL: `${apiOrigin}/api`,
      VITE_API_HEALTH_URL: `${apiOrigin}/health`,
      VITE_REALTIME_URL: apiOrigin,
      // Passed through from the Android build so the bundle knows which build it belongs to.
      LOOHAR_APP_PACKAGE: process.env.LOOHAR_APP_PACKAGE || `com.loohar.${app}`,
      LOOHAR_VERSION_CODE: process.env.LOOHAR_VERSION_CODE || "",
      LOOHAR_VERSION_NAME: process.env.LOOHAR_VERSION_NAME || ""
    }
  });
  // apps/web/public holds the published APKs so loohar.com can serve them, and Vite copies
  // everything in public/ into the build. Left alone, each app would ship a copy of all three APKs
  // inside itself — 4.9 MB became 18.8 MB — and every release would compound it. The download page
  // belongs on the website, never inside an installed app.
  const bundledDownloads = join(outDir, "download");
  if (existsSync(bundledDownloads)) {
    rmSync(bundledDownloads, { recursive: true, force: true });
    console.log("Removed the website download directory from the app bundle.");
  }

  const platforms = ["ios", "android"].filter((platform) => existsSync(join(appDir, platform)));
  if (platforms.length) {
    run("npx", ["cap", "sync"], { cwd: appDir });
  } else {
    console.log(`No native platforms in apps/mobile/${app} yet; web bundle written to ${outDir}.`);
  }
}
