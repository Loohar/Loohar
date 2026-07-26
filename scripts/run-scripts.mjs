import { spawn } from "node:child_process";

const [mode, ...scripts] = process.argv.slice(2);

if (!["--serial", "--parallel"].includes(mode) || scripts.length === 0) {
  console.error("Usage: node scripts/run-scripts.mjs --serial|--parallel <script> [script...]");
  process.exit(1);
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function runScript(script) {
  return new Promise((resolve) => {
    const child = spawn(npmCommand, ["run", script], {
      stdio: "inherit",
      env: process.env
    });
    child.on("exit", (code, signal) => resolve({ script, code: code ?? 1, signal, child }));
    child.on("error", () => resolve({ script, code: 1, signal: null, child }));
  });
}

if (mode === "--serial") {
  for (const script of scripts) {
    const result = await runScript(script);
    if (result.code !== 0) process.exit(result.code);
  }
  process.exit(0);
}

const children = new Set();
let exiting = false;

function spawnScript(script) {
  const child = spawn(npmCommand, ["run", script], {
    stdio: "inherit",
    env: process.env
  });
  children.add(child);
  return { script, child };
}

function stopChildren(signal = "SIGTERM") {
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

process.on("SIGINT", () => {
  stopChildren("SIGINT");
});
process.on("SIGTERM", () => {
  stopChildren("SIGTERM");
});

await new Promise((resolve) => {
  const running = scripts.map(spawnScript);
  let remaining = running.length;

  for (const { script, child } of running) {
    child.on("exit", (code, signal) => {
      children.delete(child);
      if (!exiting && code !== 0) {
        exiting = true;
        console.error(`${script} exited with ${signal || code}`);
        stopChildren();
        process.exitCode = code ?? 1;
      }
      remaining -= 1;
      if (remaining === 0) resolve();
    });
    child.on("error", () => {
      if (!exiting) {
        exiting = true;
        stopChildren();
        process.exitCode = 1;
      }
      remaining -= 1;
      if (remaining === 0) resolve();
    });
  }
});

process.exit(process.exitCode ?? 0);
