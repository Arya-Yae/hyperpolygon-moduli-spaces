// build-single.mjs — bundle the standalone hyperpolygon widget into ONE
// self-contained, offline HTML file.
//
// Node 12, ESM (.mjs), dependency-free. Run from anywhere:
//   node hyperpolygon-standalone/tools/build-single.mjs
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

  const html = [
    "<!DOCTYPE html>",
    '<html lang="en" data-theme="dark">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Hyperpolygon Moduli Spaces</title>",
    '<meta name="description" content="Interactive browser solver for the moduli space of four-sided star-quiver hyperpolygons.">',
    '<link rel="icon" href="' + logoURI + '">',
    "<style>",
    CSS,
    "</style>",
    "</head>",
    "<body>",
    '<div class="wrap">',
    '  <div class="topbar"><button class="theme-toggle" id="theme-toggle" type="button">Light / dark</button></div>',
    "",
    '  <header class="hero">',
    '    <img src="' + logoURI + '" alt="Hyperpolygon logo">',
    "    <div>",
    "      <h1>Hyperpolygon Moduli Spaces</h1>",
    '      <p class="sub">A live browser solver for the four-sided star quiver</p>',
    "    </div>",
    "  </header>",
    "",
    '  <div class="intro">',
    "    <p>",
    "      Let Q be the four-sided star quiver with dimension vector (2,1,1,1,1).",
    "      A representation of Q consists of a 2&times;4 matrix x with columns",
    "      x<sub>1</sub>,&hellip;,x<sub>4</sub>, and a 4&times;2 matrix y with rows",
    "      y<sub>1</sub>,&hellip;,y<sub>4</sub>. The <em>hyperpolygon space</em>",
    "      X(&beta;&#8407;) is the four-dimensional moduli space of solutions to the",
    "      moment map equations",
    "    </p>",
    '    <p class="eq">',
    "      &mu;<sub>SL(2,&#8450;)</sub>(x,y) = &sum;<sub>i=1</sub><sup>4</sup> x<sub>i</sub> y<sub>i</sub> = 0,",
    "    </p>",
    "    <p class=\"eq\">",
    "      &mu;<sub>GL(1,&#8450;),i</sub>(x,y) = y<sub>i</sub> x<sub>i</sub> = 0,",
    "    </p>",
    "    <p class=\"eq\">",
    "      &mu;<sub>SU(2)</sub>(x,y) = &sum;<sub>i=1</sub><sup>4</sup> (x<sub>i</sub>x<sub>i</sub><sup>&dagger;</sup>)<sub>0</sub> &minus; (y<sub>i</sub><sup>&dagger;</sup>y<sub>i</sub>)<sub>0</sub> = 0,",
    "    </p>",
    "    <p class=\"eq\">",
    "      &mu;<sub>U(1),i</sub>(x,y) = &frac12; ( |x<sub>i</sub>|<sup>2</sup> &minus; |y<sub>i</sub>|<sup>2</sup> ) = &beta;<sub>i</sub>,",
    "    </p>",
    "    <p>",
    "      up to the action of the symmetry group G = SU(2) &times; U(1)<sup>4</sup>.",
    "      Set v<sub>i</sub> = (x<sub>i</sub>x<sub>i</sub><sup>&dagger;</sup>)<sub>0</sub> and",
    "      w<sub>i</sub> = (y<sub>i</sub><sup>&dagger;</sup>y<sub>i</sub>)<sub>0</sub>. Then",
    "      &mu;<sub>GL(1,&#8450;),i</sub> = 0 makes v<sub>i</sub> and w<sub>i</sub> point in opposite",
    "      directions, &mu;<sub>U(1),i</sub> = &beta;<sub>i</sub> constrains the side lengths",
    "      |v<sub>i</sub>| &minus; |w<sub>i</sub>| = &radic;2 &beta;<sub>i</sub>, and",
    "      &mu;<sub>su(2)</sub> = 0 is the closure condition &sum;<sub>i</sub>(v<sub>i</sub> &minus; w<sub>i</sub>) = 0.",
    "      The v<sub>i</sub> and w<sub>i</sub> therefore assemble into a telescoping polygon in",
    "      su(2) &cong; &#8477;<sup>3</sup>, taken up to SO(3) rotations.",
    "    </p>",
    "    <p>",
    "      This simulation solves the moment map equations live as you vary the sliders.",
    "      The right view shows your position within the four-dimensional moduli space; the",
    "      left view displays the corresponding hyperpolygon. Click <strong>Tutorial</strong>",
    "      for a guided tour.",
    "    </p>",
    '    <p class="controls-hint">',
    "      Drag the sliders (<em>r</em>, <em>&theta;</em>, <em>t</em>, <em>&phi;</em> and the",
    "      stability parameters &beta;<sub>i</sub>) to walk the moduli space, and use",
    "      <strong>Cross&nbsp;Wall</strong> to flop between stability chambers.",
    "    </p>",
    "  </div>",
    "",
    '  <div id="hyperpolygon-widget"></div>',
    "",
    "  <footer>",
    "    Interactive simulation of the moduli space of hyperpolygons. See the repository",
    "    README for the mathematical background, architecture and tests.",
    "  </footer>",
    "</div>",
    "",
    "<script>",
    escapeForScript(three),
    "</script>",
    "<script>",
    escapeForScript(orbit),
    "</script>",
    '<script type="module">',
    escapeForScript(moduleBundle),
    "</script>",
    "<script>",
    PARAMS_SCRIPT,
    "</script>",
    "</body>",
    "</html>",
    "",
  ].join("\n");

  fs.writeFileSync(OUT, html);
  return { order, deps, bytes: Buffer.byteLength(html) };
}

const CSS = `  :root {
    --bg: #0e1116;
    --fg: #e6e9ee;
    --muted: #9aa4b2;
    --panel: #151a22;
    --border: #2a313c;
    --accent: #6ea8fe;
  }
  [data-theme="light"] {
    --bg: #f7f8fa;
    --fg: #151a22;
    --muted: #5b6572;
    --panel: #ffffff;
    --border: #d7dce3;
    --accent: #2f6fd0;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    background: var(--bg);
    color: var(--fg);
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 32px 20px 72px; }
  header.hero { display: flex; align-items: center; gap: 18px; margin-bottom: 8px; }
  header.hero img { width: 64px; height: 64px; }
  header.hero h1 { font-size: 1.9rem; margin: 0; letter-spacing: -0.01em; }
  header.hero .sub { color: var(--muted); margin: 2px 0 0; font-size: 0.95rem; }
  .intro { max-width: 820px; color: var(--fg); margin: 18px 0 8px; }
  .intro p { margin: 0.7em 0; }
  .intro p.eq { text-align: center; font-size: 1.05rem; margin: 0.45em 0; }
  .controls-hint { color: var(--muted); font-size: 0.92rem; }
  #hyperpolygon-widget { margin-top: 22px; }
  body.hp-bare { background: var(--bg); }
  body.hp-bare .topbar,
  body.hp-bare header.hero,
  body.hp-bare .intro,
  body.hp-bare footer { display: none; }
  body.hp-bare .wrap { padding: 0; max-width: none; }
  body.hp-bare #hyperpolygon-widget { margin-top: 0; }
  footer { margin-top: 40px; color: var(--muted); font-size: 0.85rem; border-top: 1px solid var(--border); padding-top: 16px; }
  footer a { color: var(--accent); }
  .topbar { display: flex; justify-content: flex-end; }
  button.theme-toggle {
    background: var(--panel); color: var(--fg); border: 1px solid var(--border);
    border-radius: 8px; padding: 6px 12px; cursor: pointer; font: inherit; font-size: 0.85rem;
  }
  button.theme-toggle:hover { border-color: var(--accent); }`;

const PARAMS_SCRIPT = `  (function () {
    var toggle = document.getElementById("theme-toggle");
    toggle.addEventListener("click", function () {
      var root = document.documentElement;
      root.setAttribute("data-theme", root.getAttribute("data-theme") === "dark" ? "light" : "dark");
    });

    // URL parameters freeze the widget at a chosen state:
    //   ?r=0.5&theta=0&t=0.4&phi=0&beta=0.4,0.5,0.5,0.25&theme=dark
    var params = new URLSearchParams(location.search);
    if (params.get("theme")) document.documentElement.setAttribute("data-theme", params.get("theme"));
    if (params.has("bare")) document.body.classList.add("hp-bare");
    var hasState = ["r", "theta", "t", "phi", "beta"].some(function (k) { return params.has(k); });
    if (!hasState) return;

    function apply() {
      var sliders = document.querySelectorAll("#hyperpolygon-widget .hp-slider");
      if (!sliders.length) { setTimeout(apply, 50); return; }
      function set(i, v) {
        if (i >= sliders.length || v == null) return;
        sliders[i].value = v;
        sliders[i].dispatchEvent(new Event("input", { bubbles: true }));
      }
      set(0, params.get("r"));
      set(1, params.get("theta"));
      set(2, params.get("t"));
      set(3, params.get("phi"));
      var beta = params.get("beta");
      if (beta) beta.split(",").forEach(function (v, k) { set(4 + k, v); });
      window.__hpReady = true;
      document.documentElement.setAttribute("data-hp-ready", "1");
    }
    apply();
  })();`;

const info = build();
console.log("wrote " + OUT);
console.log("module order: " + info.order.join(" -> "));
for (const id of info.order) {
  console.log("  " + id + " <- [" + info.deps[id].join(", ") + "]");
}
console.log("bytes: " + info.bytes);
