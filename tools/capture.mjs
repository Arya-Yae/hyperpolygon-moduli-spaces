// Reusable headless-Chromium capture tool for the standalone hyperpolygon widget.
//
//   node tools/capture.mjs            # regenerate every README asset
//   node tools/capture.mjs pngs       # only the two PNG previews
//   node tools/capture.mjs theta      # only sweep-theta.gif
//   node tools/capture.mjs t          # only sweep-t.gif
//   node tools/capture.mjs probe      # capturion-determinism smoke test
//
// Node 12, ESM, no dependencies. ImageMagick `convert` must be on PATH.
//
// By default the tool starts its own tiny static server for the standalone
// repo (served from a child process, since chromium runs synchronously). The
// served orientation.js has its idle twist servo disabled: that servo spins
// the display pose whenever the widget has been idle for 250 ms, which makes
// screenshots depend on capture wall-time. With it off the rendered pose
// depends only on the frozen URL parameters, so frames are reproducible.
// Set HP_BASE_URL to capture against an external server with no such edit.

import { execFileSync, spawn, spawnSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "fs";
import { join, dirname, extname, sep, normalize } from "path";
import { fileURLToPath } from "url";
import http from "http";
import os from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "assets", "img");
const WORK_DIR = process.env.HP_WORK_DIR || join(os.tmpdir(), "hp-capture");

// Widget content is ~1085px tall at width 1180.
const CROP = "1180x1085+0+0";
const GIF_RESIZE = "720x";
const GIF_COLORS = "128";
const FRAME_DELAY = 10; // ImageMagick ticks (1/100 s) -> 100 ms

const CHROME_FLAGS = [
  "--headless",
  "--no-sandbox",
  "--hide-scrollbars",
  "--use-angle=swiftshader",
  "--use-gl=angle",
  "--window-size=1180,1180",
  "--timeout=3000",
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

function rmrf(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) rmrf(p);
    else execFileSync("rm", ["-f", p]);
  }
  execFileSync("rmdir", [dir]);
}

function resolveChrome() {
  const candidates = [];
  if (process.env.CHROME) candidates.push(process.env.CHROME);

  const pwCache = join(os.homedir(), ".cache", "ms-playwright");
  if (existsSync(pwCache)) {
    for (const v of readdirSync(pwCache).filter((n) => /^chromium/.test(n)).sort()) {
      candidates.push(join(pwCache, v, "chrome-linux64", "chrome"));
      candidates.push(join(pwCache, v, "chrome-linux", "chrome"));
    }
  }

  for (const bin of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    try {
      const p = execFileSync("which", [bin], { encoding: "utf8" }).trim();
      if (p) candidates.push(p);
    } catch (e) {
      /* not on PATH */
    }
  }

  for (const c of candidates) if (c && existsSync(c)) return c;
  throw new Error(
    "No Chromium/Chrome binary found. Set the CHROME env var to a chromium " +
      "executable, or install Playwright's chromium. Searched:\n  " +
      candidates.join("\n  ")
  );
}

const CHROME = resolveChrome();
let BASE_URL = process.env.HP_BASE_URL || null;

// Capture-local static server for the standalone repo. It serves the real
// files unchanged except for two capture-only edits:
//   * index.html gets a hook that keeps the widget's input clock fresh;
//   * orientation.js gets SERVO_TWIST disabled, so the idle display spin
//     (an aesthetic servo, not solver data) cannot make the rendered pose
//     depend on capture wall-time.
function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent((req.url || "/").split("?")[0]);
      const target = normalize(join(ROOT, rel === "/" ? "index.html" : rel));
      if (target !== ROOT && !target.startsWith(ROOT + sep)) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      let data;
      try {
        data = readFileSync(target);
      } catch (e) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const type = MIME[extname(target)];
      if (/orientation\.js$/.test(target)) {
        data = Buffer.from(
          String(data).replace(/export const SERVO_TWIST = true;/, "export const SERVO_TWIST = false;")
        );
      }
      res.writeHead(200, { "Content-Type": type || "application/octet-stream" });
      res.end(data);
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      BASE_URL = "http://127.0.0.1:" + server.address().port + "/index.html";
      resolve(server);
    });
  });
}

// chromium runs via execFileSync, which blocks this process's event loop, so
// the server must live in a separate child process. The parent learns the
// chosen URL from the child's LISTEN line.
function startServerProcess() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "serve"], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    let done = false;
    child.stdout.on("data", (d) => {
      buf += d;
      const m = buf.match(/LISTEN (\S+)/);
      if (m && !done) {
        done = true;
        BASE_URL = m[1];
        resolve(child);
      }
    });
    child.stderr.on("data", (d) => process.stderr.write(d));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (!done && code) reject(new Error("capture server exited with code " + code));
    });
  });
}

function query(params) {
  const parts = [];
  for (const k of Object.keys(params)) {
    const v = params[k];
    if (v === undefined || v === null) continue;
    parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
  }
  return parts.join("&");
}

function shot(params, outPng) {
  const url = BASE_URL + "?" + query(params);
  execFileSync(CHROME, [...CHROME_FLAGS, "--screenshot=" + outPng, url], {
    stdio: ["ignore", "ignore", "ignore"],
    timeout: 90000,
  });
}

function convert(args) {
  execFileSync("convert", args, { stdio: ["ignore", "ignore", "inherit"] });
}

function captureFrame(params, outPng, resize) {
  const raw = join(WORK_DIR, outPng.replace(/\.png$/, ".raw.png").replace(/^.*[\\/]/, ""));
  shot(params, raw);
  const args = [raw, "-crop", CROP, "+repage"];
  if (resize) args.push("-resize", resize);
  args.push(outPng);
  convert(args);
}

// Forward sequence, then reverse without duplicating either endpoint, so the
// last frame flows back into the first and the GIF loops seamlessly.
function pingPong(vals) {
  return vals.concat(vals.slice(1, vals.length - 1).reverse());
}

function linspace(a, b, n) {
  if (n < 2) return [a];
  const out = [];
  for (let i = 0; i < n; i++) out.push(a + ((b - a) * i) / (n - 1));
  return out;
}

function pad(i) {
  return String(i).padStart(3, "0");
}

function buildPng(name, params) {
  mkdirSync(OUT_DIR, { recursive: true });
  captureFrame(params, join(OUT_DIR, name), null);
  console.log("  wrote " + name);
}

function buildGif(name, values, baseParams, delay) {
  const dir = join(WORK_DIR, name.replace(/\W/g, "_"));
  rmrf(dir);
  mkdirSync(dir, { recursive: true });

  const files = [];
  values.forEach((v, i) => {
    const params = Object.assign({}, baseParams, v);
    const file = join(dir, "f" + pad(i) + ".png");
    captureFrame(params, file, GIF_RESIZE);
    files.push(file);
    process.stdout.write("\r  " + name + " frame " + (i + 1) + "/" + values.length);
  });
  process.stdout.write("\n");

  mkdirSync(OUT_DIR, { recursive: true });
  convert(["-delay", String(delay), "-loop", "0"].concat(files, ["-colors", GIF_COLORS, join(OUT_DIR, name)]));
  console.log("  wrote " + name + " (" + files.length + " frames, delay " + delay + ")");
}

function buildPngs() {
  console.log("PNG previews:");
  const state = { bare: "1", r: "0.5", theta: "0.3", t: "0.6" };
  buildPng("preview-dark.png", Object.assign({ theme: "dark" }, state));
  buildPng("preview-light.png", Object.assign({ theme: "light" }, state));
}

function buildTheta() {
  console.log("sweep-theta.gif:");
  const base = { theme: "dark", bare: "1", r: "0.5", t: "0.5" };
  const forward = linspace(-1, 1, 24).map((theta) => ({ theta: theta.toFixed(4) }));
  buildGif("sweep-theta.gif", pingPong(forward), base, FRAME_DELAY);
}

function buildT() {
  console.log("sweep-t.gif:");
  const base = { theme: "dark", bare: "1", r: "0.5", theta: "0.3" };
  const forward = linspace(0.1, 0.9, 20).map((t) => ({ t: t.toFixed(4) }));
  buildGif("sweep-t.gif", pingPong(forward), base, FRAME_DELAY);
}

// Capture the same state three times and report pixel differences, so a
// broken determinism assumption is caught before rendering 80 frames.
function probe() {
  const params = { theme: "dark", bare: "1", r: "0.5", theta: "0.3", t: "0.6" };
  const files = [];
  for (let i = 0; i < 3; i++) {
    const f = join(WORK_DIR, "probe" + i + ".png");
    captureFrame(params, f, null);
    files.push(f);
  }
  function metric(m, a, b) {
    const r = spawnSync("compare", ["-metric", m, a, b, "null:"], { encoding: "utf8" });
    return ((r.stdout || "") + (r.stderr || "")).trim();
  }
  console.log("probe same-state pixel deltas (AE 0, RMSE ~0 => deterministic):");
  console.log("  0 vs 1: AE=" + metric("AE", files[0], files[1]) + "  RMSE=" + metric("RMSE", files[0], files[1]));
  console.log("  0 vs 2: AE=" + metric("AE", files[0], files[2]) + "  RMSE=" + metric("RMSE", files[0], files[2]));
  console.log("  1 vs 2: AE=" + metric("AE", files[1], files[2]) + "  RMSE=" + metric("RMSE", files[1], files[2]));
}

async function main() {
  const target = (process.argv[2] || "all").toLowerCase();

  if (target === "serve") {
    await startServer();
    console.log("chromium: " + CHROME);
    console.log("LISTEN " + BASE_URL);
    console.log("serving capture-local copy; Ctrl-C to stop");
    return;
  }

  rmrf(WORK_DIR);
  mkdirSync(WORK_DIR, { recursive: true });

  let serverProc = null;
  if (!BASE_URL) serverProc = await startServerProcess();

  console.log("chromium: " + CHROME);
  console.log("server:   " + BASE_URL + (serverProc ? " (capture-local)" : " (external)"));

  if (target === "pngs" || target === "png" || target === "all") buildPngs();
  if (target === "theta" || target === "all") buildTheta();
  if (target === "t" || target === "all") buildT();
  if (target === "probe") probe();
  console.log("done.");

  if (serverProc) serverProc.kill();
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
