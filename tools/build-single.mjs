// build-single.mjs — bundle the standalone hyperpolygon widget into ONE
// HTML file.
//
// Node 12, ESM (.mjs), dependency-free. Run from anywhere:
//   node hyperpolygon-standalone/tools/build-single.mjs
//
// The page shell (markup, CSS, intro text, inline scripts) is read verbatim
// from index.html, so the two pages cannot drift; only the external
// references are swapped for inlined equivalents (logo -> data URI, the
// three.js/OrbitControls classic scripts and the ES-module widget bundle ->
// inlined <script> tags). MathJax stays a CDN <script> (its LaTeX math
// needs the network); everything else is self-contained.
//
// Approach: each ES module is wrapped in an IIFE that returns its exports
// (so modules with colliding top-level names cannot clash), and the
// imports are rewritten to destructuring bindings off the dependency
// IIFEs. three.min.js and OrbitControls.js are inlined as classic scripts
// before the module bundle so global THREE exists first.

import fs from "fs";
import path from "path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, ".."); // hyperpolygon-standalone/
const SRC = path.join(ROOT, "assets", "js", "hyperpolygon");
const OUT = path.join(ROOT, "hyperpolygon.html");

const MODULES = [
  "sideview-shared",
  "solver",
  "chambers",
  "orientation",
  "sideview",
  "tutorial",
  "widget",
];

// ---------------------------------------------------------------------------
// module graph
// ---------------------------------------------------------------------------

function moduleId(depPath) {
  const base = depPath.replace(/^.*\//, "").replace(/\.js$/, "");
  return base;
}

function varName(id) {
  return "__hp_mod_" + id.replace(/[^A-Za-z0-9_$]/g, "_");
}

// Parse the local "./x.js" dependencies of a module's source text.
function parseImports(src) {
  const deps = [];
  const re = /import\s+[\s\S]*?\s+from\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const p = m[1];
    if (/^\.\//.test(p)) deps.push(moduleId(p));
  }
  return deps;
}

// Topological sort of the module list from the parsed import graph.
function topoOrder(modules) {
  const src = {};
  for (const id of modules) {
    src[id] = fs.readFileSync(path.join(SRC, id + ".js"), "utf8");
  }
  const deps = {};
  for (const id of modules) deps[id] = parseImports(src[id]);
  const order = [];
  const state = {}; // 0 unseen, 1 visiting, 2 done
  function visit(id) {
    const s = state[id] || 0;
    if (s === 2) return;
    if (s === 1) throw new Error("cycle in module graph at " + id);
    if (!(id in src)) throw new Error("import of unknown module: " + id);
    state[id] = 1;
    for (const d of deps[id]) visit(d);
    state[id] = 2;
    order.push(id);
  }
  for (const id of modules) visit(id);
  return { order, src, deps };
}

// ---------------------------------------------------------------------------
// module transform: imports -> destructuring, exports -> returned object
// ---------------------------------------------------------------------------

function transformModule(id, code) {
  const exported = [];
  let body = code;

  // 1. imports -> destructuring bindings from dependency IIFEs.
  const bindings = [];
  body = body.replace(
    /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];?/g,
    (whole, clause, depPath) => {
      const depVar = varName(moduleId(depPath));
      const text = clause.trim();
      const named = text.match(/\{([\s\S]*)\}/);
      if (named) {
        const entries = named[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => {
            const parts = s.split(/\s+as\s+/);
            const from = parts[0].trim();
            const to = parts.length > 1 ? parts[1].trim() : from;
            return from === to ? from : from + ": " + to;
          });
        if (entries.length) {
          bindings.push("const { " + entries.join(", ") + " } = " + depVar + ";");
        }
      } else if (/^\*\s+as\s+/.test(text)) {
        bindings.push("const " + text.replace(/^\*\s+as\s+/, "") + " = " + depVar + ";");
      } else if (text) {
        // default import
        bindings.push("const " + text + " = " + depVar + ".default;");
      }
      return "";
    }
  );

  // 2. `export { A, B };` (plain re-export blocks) -> record names.
  body = body.replace(/export\s*\{([\s\S]*?)\}\s*;?/g, (whole, inner) => {
    inner
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => {
        const parts = s.split(/\s+as\s+/);
        exported.push(parts[parts.length - 1].trim());
      });
    return "";
  });

  // 3. `export <decl>` -> drop the keyword, record the name.
  body = body.replace(
    /export\s+(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g,
    (whole, kind, name) => {
      exported.push(name);
      return kind + " " + name;
    }
  );

  const returnNames = exported.join(", ");
  const iife =
    "const " +
    varName(id) +
    " = (function () {\n" +
    bindings.join("\n") +
    (bindings.length ? "\n" : "") +
    body +
    "\nreturn { " +
    returnNames +
    " };\n})();\n";

  return iife;
}

// ---------------------------------------------------------------------------
// escaping helpers
// ---------------------------------------------------------------------------

// Keep the produced HTML valid: no `</script>` may appear inside inlined
// JS, and `/` in URL literals is escaped (`\/`) so a literal `http://`
// never appears while the string value is unchanged.
function escapeForScript(js) {
  return js
    .replace(/<\/script/gi, "<\\/script")
    .replace(/https?:\/\//g, (m) => m.replace(/\//g, "\\/"));
}

// Replace exactly one occurrence, failing loudly if index.html drifted so
// the generated bundle can never silently reference a missing asset.
function replaceOnce(text, find, repl, label) {
  const i = text.indexOf(find);
  if (i === -1) {
    throw new Error(
      "build-single: could not find " +
        label +
        " in index.html; its markup changed, update the transform"
    );
  }
  return text.slice(0, i) + repl + text.slice(i + find.length);
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

function build() {
  const { order, src, deps } = topoOrder(MODULES);

  const moduleBundle = order
    .map((id) => "// ---- module: " + id + " ----\n" + transformModule(id, src[id]))
    .join("\n");

  const three = fs.readFileSync(path.join(SRC, "lib", "three.min.js"), "utf8");
  const orbit = fs.readFileSync(path.join(SRC, "lib", "OrbitControls.js"), "utf8");

  const logoSvg = fs.readFileSync(path.join(ROOT, "assets", "img", "hyperpolygon-logo.svg"));
  const logoURI = "data:image/svg+xml;base64," + logoSvg.toString("base64");

  // index.html is the single source of truth for the page shell: markup,
  // CSS, intro text, theme toggle, URL-param and embed-bridge scripts all
  // come straight from it. We only swap the external references for their
  // inlined equivalents. (MathJax stays a CDN <script> so its LaTeX math
  // needs the network; everything else is self-contained.)
  const INDEX = path.join(ROOT, "index.html");
  let html = fs.readFileSync(INDEX, "utf8");

  html = replaceOnce(
    html,
    'href="assets/img/hyperpolygon-logo.svg"',
    'href="' + logoURI + '"',
    "logo <link> icon"
  );
  html = replaceOnce(
    html,
    'src="assets/img/hyperpolygon-logo.svg"',
    'src="' + logoURI + '"',
    "hero <img> logo"
  );
  html = replaceOnce(
    html,
    '<script src="assets/js/hyperpolygon/lib/three.min.js"></script>',
    "<script>\n" + escapeForScript(three) + "\n</script>",
    "three.min.js <script>"
  );
  html = replaceOnce(
    html,
    '<script src="assets/js/hyperpolygon/lib/OrbitControls.js"></script>',
    "<script>\n" + escapeForScript(orbit) + "\n</script>",
    "OrbitControls.js <script>"
  );
  html = replaceOnce(
    html,
    '<script type="module" src="assets/js/hyperpolygon/widget.js"></script>',
    '<script type="module">\n' + escapeForScript(moduleBundle) + "\n</script>",
    "widget.js <script type=module>"
  );

  fs.writeFileSync(OUT, html);
  return { order, deps, bytes: Buffer.byteLength(html) };
}

const info = build();
console.log("wrote " + OUT);
console.log("module order: " + info.order.join(" -> "));
for (const id of info.order) {
  console.log("  " + id + " <- [" + info.deps[id].join(", ") + "]");
}
console.log("bytes: " + info.bytes);
