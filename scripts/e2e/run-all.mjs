// End-to-end harness: real Postgres (PGlite over the wire protocol), local stand-ins for Supabase
// Storage and the Gemini REST API, the production build of the app, HTTP checks, a restart-recovery
// check and browser checks in the locally installed Chrome. No real credentials are needed.
//
//   npm run e2e               # full run (builds the app first)
//   npm run e2e -- --no-build # reuse the existing .next build
//   CHROME_PATH=/path/to/chrome npm run e2e   # if Chrome isn't found automatically
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const HERE = import.meta.dirname;
const APP_PORT = 3100;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const noBuild = process.argv.includes("--no-build");

const env = {
  ...process.env,
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5433/postgres",
  DATABASE_POOL_MAX: "1", // PGlite executes one query at a time
  SUPABASE_URL: "http://127.0.0.1:5544",
  SUPABASE_SECRET_KEY: "sb_secret_local_fake",
  SUPABASE_STORAGE_BUCKET: "documents",
  GEMINI_BASE_URL: "http://127.0.0.1:5544",
  GEMINI_API_KEY: "local-fake-key",
  GEMINI_MODEL: "gemini-flash-latest",
  ENABLE_DEBUG_TOGGLES: "true",
  PORT: String(APP_PORT),
  E2E_BASE: BASE,
};

const children = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isWin = process.platform === "win32";

function start(name, cmd, args, { logFile } = {}) {
  const out = fs.openSync(path.join(ROOT, ".e2e", logFile ?? `${name}.log`), "a");
  const child = spawn(cmd, args, { cwd: ROOT, env, stdio: ["ignore", out, out], detached: !isWin });
  children.push({ name, child });
  return child;
}

/** Kill a process and everything it started (Next.js forks workers). */
function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (isWin) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

function stopAll() {
  for (const { child } of children.reverse()) killTree(child);
}

async function waitFor(url, what, ms = 60_000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.status < 500 || what === "any") return r;
    } catch {
      /* not up yet */
    }
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(500);
  }
}

async function waitForTcp(port, ms = 30_000) {
  const net = await import("node:net");
  const t0 = Date.now();
  for (;;) {
    const ok = await new Promise((resolve) => {
      const s = net.connect(port, "127.0.0.1", () => {
        s.destroy();
        resolve(true);
      });
      s.on("error", () => resolve(false));
    });
    if (ok) return;
    if (Date.now() - t0 > ms) throw new Error(`port ${port} never opened`);
    await sleep(300);
  }
}

function run(label, cmd, args) {
  console.log(`\n▶ ${label}`);
  // npx needs a shell on Windows; node (a path that may contain spaces) must not go through one.
  const r = spawnSync(cmd, args, { cwd: ROOT, env, stdio: "inherit", shell: isWin && cmd === "npx" });
  return r.status === 0;
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find((c) => fs.existsSync(c));
}

const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
const startApp = () => start("app", process.execPath, [nextBin, "start"]);

async function upload(file, name = file) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(path.join(ROOT, "tests/fixtures", file))]), name);
  return (await (await fetch(`${BASE}/api/documents`, { method: "POST", body: form })).json()).document;
}

/** Kill the whole server while a 149-page PDF is processing, restart it, and expect recovery. */
async function restartRecovery(app) {
  console.log("\n▶ Restart recovery");
  const doc = await upload("long_msa.pdf", "restart_test.pdf");
  for (;;) {
    const d = (await (await fetch(`${BASE}/api/documents/${doc.id}`)).json()).document;
    if (d.status === "processing" && d.progress >= 10) {
      console.log(`  killing the server at "${d.stage}" (${d.progress}%)`);
      break;
    }
    if (d.status === "ready") {
      console.log("FAIL  processing finished before the server could be killed");
      return { ok: false, app };
    }
    await sleep(40);
  }
  killTree(app);
  await sleep(1500);
  const restarted = startApp();
  await waitFor(`${BASE}/api/health`, "app restart");
  // The dead worker's lease (2 min) must expire before the job is reclaimed.
  const t0 = Date.now();
  for (;;) {
    const d = (await (await fetch(`${BASE}/api/documents/${doc.id}`)).json()).document;
    if (d.status === "ready") {
      console.log(`PASS  document recovered after restart (ready ${Math.round((Date.now() - t0) / 1000)} s after restart)`);
      return { ok: true, app: restarted };
    }
    if (d.status === "failed" || Date.now() - t0 > 240_000) {
      console.log(`FAIL  document did not recover (${d.status}: ${d.errorMessage ?? d.stage})`);
      return { ok: false, app: restarted };
    }
    await sleep(3000);
  }
}

async function main() {
  fs.rmSync(path.join(ROOT, ".e2e"), { recursive: true, force: true });
  fs.mkdirSync(path.join(ROOT, ".e2e"), { recursive: true });
  let ok = true;
  try {
    start("db", process.execPath, [path.join(HERE, "db.mjs")]);
    start("fakes", process.execPath, [path.join(HERE, "fakes.mjs")]);
    await waitForTcp(5433);
    await waitForTcp(5544);
    if (!run("Migrations", "npx", ["tsx", "scripts/migrate.ts"])) throw new Error("migrations failed");
    if (!noBuild && !run("Build", "npx", ["next", "build"])) throw new Error("build failed");
    let app = startApp();
    await waitFor(`${BASE}/api/health`, "app");

    ok = run("API checks", process.execPath, [path.join(HERE, "api-checks.mjs")]) && ok;
    const rr = await restartRecovery(app);
    app = rr.app;
    ok = rr.ok && ok;

    const chrome = findChrome();
    if (!chrome) {
      console.log("\nSKIP  browser checks: no Chrome/Edge found (set CHROME_PATH)");
    } else {
      // The API checks delete msa_v2; the UI checks need it again.
      await upload("msa_v2.docx");
      await sleep(4000);
      env.CHROME_PATH = chrome;
      ok = run("Browser checks", process.execPath, [path.join(HERE, "ui-checks.mjs")]) && ok;
    }
  } catch (err) {
    console.error(`\nE2E aborted: ${err instanceof Error ? err.message : err}`);
    ok = false;
  } finally {
    stopAll();
  }
  console.log(`\nE2E ${ok ? "PASSED" : "FAILED"} (logs in .e2e/)`);
  process.exit(ok ? 0 : 1);
}

process.on("SIGINT", () => {
  stopAll();
  process.exit(130);
});

main();
