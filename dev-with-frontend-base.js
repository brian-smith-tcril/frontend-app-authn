#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const APP_ROOT = process.cwd();
const PACK_DIR = path.resolve(APP_ROOT, "../frontend-base/.pack");
const PORT = Number(process.env.PORT || 1999);

// command to run your dev server
const DEV = ["npm", ["run", "dev"]];

// npm install args (tgz appended)
const INSTALL = ["npm", ["i", "--no-save"]];

// If set, use this exact tgz filename; else choose newest *.tgz
const STABLE_TGZ = process.env.FRONTEND_BASE_TGZ || "";

function newestTgz(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".tgz"))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files[0] ? path.join(dir, files[0].f) : null;
}

function tgzPath() {
  return STABLE_TGZ ? path.join(PACK_DIR, STABLE_TGZ) : newestTgz(PACK_DIR);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", shell: false, ...opts });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

function portInUse(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(true)); // EADDRINUSE etc
    s.once("listening", () => s.close(() => resolve(false)));
    s.listen(port, "127.0.0.1");
  });
}

async function waitForPortFree(port, ms = 8000) {
  const start = Date.now();
  while (await portInUse(port)) {
    if (Date.now() - start > ms) throw new Error(`Port ${port} still in use after ${ms}ms`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

let devProc = null;
function startDev() {
  console.log(`\n[dev] start: ${DEV[0]} ${DEV[1].join(" ")}\n`);
  devProc = spawn(DEV[0], DEV[1], {
    cwd: APP_ROOT,
    stdio: "inherit",
    shell: false,
    detached: true, // crucial: gives us a process group to kill
    env: process.env,
  });
  devProc.unref();
}

async function stopDev() {
  if (!devProc) return;
  console.log("\n[dev] stop\n");
  try {
    // kill the whole process group
    process.kill(-devProc.pid, "SIGTERM");
  } catch (_) {}
  // give it a moment, then hard kill if needed
  await new Promise((r) => setTimeout(r, 1200));
  try {
    process.kill(-devProc.pid, "SIGKILL");
  } catch (_) {}
  devProc = null;
  await waitForPortFree(PORT);
}

async function installBase() {
  const tgz = tgzPath();
  if (!tgz || !fs.existsSync(tgz)) throw new Error(`No tgz found in ${PACK_DIR}`);
  console.log(`\n[base] install: ${tgz}\n`);
  await run(INSTALL[0], [...INSTALL[1], tgz], { cwd: APP_ROOT });
}

let restarting = false;
let timer = null;

function scheduleRestart(reason) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => restart(reason), 350); // debounce duplicates
}

async function restart(reason) {
  if (restarting) return;
  restarting = true;
  try {
    console.log(`\n[watch] restart (${reason})`);
    await stopDev();
    await installBase();
    startDev();
  } catch (e) {
    console.error("\n[error]", e.message || e);
  } finally {
    restarting = false;
  }
}

function watchPackDir() {
  console.log(`[watch] ${PACK_DIR}`);
  fs.watch(PACK_DIR, (evt, file) => {
    if (!file || !file.endsWith(".tgz")) return;
    scheduleRestart(`${evt}:${file}`);
  });
}

(async function main() {
  await installBase();
  startDev();
  watchPackDir();

  const shutdown = async () => {
    console.log("\n[exit]");
    try {
      await stopDev();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
