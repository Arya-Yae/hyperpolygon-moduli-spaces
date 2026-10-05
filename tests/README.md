# Hyperpolygon test suite

Node battery for the Hyperpolygon widget modules
(`../assets/js/hyperpolygon/`). Node is v12: `.mjs` scripts, ESM, no
top-level await, no dependencies. There is no build step.

## What it validates

The solver pipeline `makeHyperpolygon(r, theta, t, beta, permute)` is
checked from every angle:

- `sweep.mjs` — randomized robustness (200 pts x 3 beta sets) plus the
  `r = 1` edge.
- `edge.mjs` — endpoint battery: `r in {0,1}` grids, formerly-broken
  bands, `t = 0` corners, gauge-invariant continuity, seeded fuzz.
- `walls.mjs` — chamber-wall conditioning, clamp idempotency, drag-event
  and chamber-lock batteries, solver scale-robustness, cross-wall flop,
  widget permute call pattern, defaults sanity.
- `locus.mjs` — the `(1/2, 0)` degenerate-locus gate disk, chaotic band,
  and bit-exact offset identity.
- `exterior.mjs` — exterior-chamber `t = 0` branch (all dominant legs,
  wall sweep, continuity, widget path).
- `star.mjs` / `cycle.mjs` — star/cycle chamber reindexing: grids against
  USER beta, snap straightness, bitwise equivalence, classification and
  the constant `[7,5,6]` attachment map, cross-wall coherence, fuzz.
- `stratum.mjs` — I-stratum closed form: grid, approach comparison,
  product cancellation, permute pattern, on-wall degeneracy, perf.
- `sideview.mjs` — the Node-safe side-view layer: probe rule over all 8
  interior chambers, sizes, flow/paraboloid/exterior constraints, gamma
  level-circle invariants, stratum, capture, purity.
- `orient.mjs` — orientation servo (6 tests, ~39 slider paths): chord
  pinning, drag continuity vs a Kabsch baseline, jump smoothness, static
  stability, servo path-independence, quaternion sanity.
- `validate.mjs` — spot-checks against the 137 MB Mathematica reference
  `mathematica/hyperpolygonDataPolar`. That file is neither present nor
  committed; when it is absent the battery prints `SKIP` and exits 0.

## Running

```bash
bash tests/run.sh          # from the repo root
bash run.sh                # from tests/
```

`run.sh` copies the five live modules next to the batteries (Node ESM
resolves `./solver.js` relative to the importing file), then runs every
battery. `set -e`: the first failing battery stops the gate and the script
exits non-zero. This is the gate to run after ANY change. Expect ~20-30 s.

### Manual tools (not part of the gate)

```bash
node tests/fingerprint.mjs check    # bit-exact behavioral fingerprint
node tests/fingerprint.mjs golden   # regenerate the golden (ENUMERATED changes only)
node tests/bench.mjs                # hot-path micro-benchmarks (no pass/fail)
```

`fingerprint` compares a full-precision dump of solver / chambers /
orientation / side-view behavior on a fixed grid against
`tests/fingerprint-golden.json`. It prints `bit-identical` on success and
exits 1 on any diff. The golden is **machine-local** (V8 version and
platform FP behavior enter the bits), is not committed, and must be
regenerated only for intentional, enumerated behavior changes.

`bench` reports per-op ms for the solve, vertices, residuals, orientor and
flow probes; compare before/after.

## Invariants (do not break)

- **Gauge freedom.** The solver output is defined only up to a residual
  `U(2) x U(1)^4` gauge. NEVER compare raw `(x, y)` matrices between
  versions or datasets. Compare gauge-invariant quantities only: per-leg
  `|y_i|^2`, per-vertex norms and edge lengths of the su(2) polygon, and
  the moment-map residuals of both representations.
- **Bit-exact historical paths.** The star-3 / cycle-0 chambers and the
  default STAR ansatz must stay bit-exact across any solver change;
  `star.mjs`, `cycle.mjs` and `fingerprint.mjs` assert this.
- **`beta_U1` = user beta** under either `PERMUTE_23` setting: the widget
  pre-swap and the solver's `permute` output swap cancel in the display,
  so displayed leg `j` IS user leg `j` either way.

## Accepted duplication

`cAbs2` is re-declared in several battery files and `fmtBeta` in two
(`sideview.mjs`, `walls.mjs`). Each battery is deliberately a
self-contained checker; sharing helpers would couple their failure modes
and the duplication is trivial. Do not "fix" without a reason.
