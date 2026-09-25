// Creates the signing keystore for downloadable Loohar Android builds.
//
//   node scripts/android-keystore.mjs [--dir ~/.loohar/android]
//
// An Android app must be signed to be installable. The signature is also an identity: Android will
// refuse to update an installed app with a build signed by a different key, so losing this keystore
// means every restaurant has to uninstall and reinstall, losing local state. Back it up.
//
// The keystore and its passwords live outside the repository and are never printed. A committed
// keystore is a compromised keystore, and a password echoed to a terminal ends up in shell history
// and in scrollback.
//
// This key signs builds distributed directly to restaurants. Google Play additionally requires
// enrolment in Play App Signing, which is a separate owner action; the same keystore is used as the
// upload key there.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import crypto from "node:crypto";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
const directory = resolve(argument("dir", join(process.env.HOME || "", ".loohar/android")));
const keystorePath = join(directory, "loohar-release.keystore");
const propertiesPath = join(directory, "keystore.properties");
const alias = "loohar";

const javaHome = process.env.JAVA_HOME || "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home";
const keytool = join(javaHome, "bin/keytool");
if (!existsSync(keytool)) {
  console.error(`keytool not found at ${keytool}. Install JDK 21: brew install openjdk@21`);
  process.exit(2);
}

if (existsSync(keystorePath)) {
  console.log(`A keystore already exists at ${keystorePath}.`);
  console.log("Refusing to replace it: a new key would make every installed app un-updatable.");
  console.log("Delete it deliberately first if you really mean to start over.");
  process.exit(0);
}

mkdirSync(directory, { recursive: true, mode: 0o700 });

// Generated here so no human ever types, sees or pastes it. base64url avoids shell-quoting hazards.
const password = crypto.randomBytes(33).toString("base64url");

execFileSync(keytool, [
  "-genkeypair", "-v",
  "-keystore", keystorePath,
  "-alias", alias,
  "-keyalg", "RSA", "-keysize", "4096",
  // 10000 days: Google Play requires a key valid well beyond 2033, and re-keying later is painful.
  "-validity", "10000",
  "-storetype", "PKCS12",
  "-dname", "CN=Loohar, OU=Loohar, O=Loohar, L=Denver, ST=Colorado, C=US",
  "-storepass", password,
  "-keypass", password
], { stdio: ["ignore", "ignore", "pipe"] });
chmodSync(keystorePath, 0o600);

writeFileSync(propertiesPath, [
  "# Loohar Android signing. Never commit this file or the keystore it points at.",
  `storeFile=${keystorePath}`,
  `storePassword=${password}`,
  `keyAlias=${alias}`,
  `keyPassword=${password}`,
  ""
].join("\n"), { mode: 0o600 });

const fingerprint = execFileSync(keytool, [
  "-list", "-v", "-keystore", keystorePath, "-alias", alias, "-storepass", password
], { encoding: "utf8" }).split("\n").find((line) => line.includes("SHA256:")) || "";

console.log("Keystore created.\n");
console.log(`  keystore   ${keystorePath}`);
console.log(`  properties ${propertiesPath}  (contains the password; mode 600)`);
console.log(`  alias      ${alias}`);
console.log(`  ${fingerprint.trim()}`);
console.log("\nThe password was generated here and is written only to that properties file.");
console.log("It has not been printed and is not in your shell history.\n");
console.log("BACK BOTH FILES UP somewhere safe and private. If you lose them, installed apps can");
console.log("never be updated again — every restaurant would have to uninstall and reinstall.\n");
console.log("To build signed apps:");
console.log(`  export LOOHAR_ANDROID_KEYSTORE_PROPERTIES=${propertiesPath}`);
console.log("  npm run build:android -- --app all --env production --release");
