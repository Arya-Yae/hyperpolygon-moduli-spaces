#!/bin/bash
# Copies the live widget modules next to the batteries (Node ESM resolves
# "./solver.js" etc. relative to the importing file) and runs every battery.
set -e
cd "$(dirname "$0")"
cp ../assets/js/hyperpolygon/solver.js ./solver.js
cp ../assets/js/hyperpolygon/orientation.js ./orientation.js
cp ../assets/js/hyperpolygon/chambers.js ./chambers.js
cp ../assets/js/hyperpolygon/sideview.js ./sideview.js
cp ../assets/js/hyperpolygon/sideview-shared.js ./sideview-shared.js
node sweep.mjs
node walls.mjs
node sideview.mjs
node edge.mjs
node locus.mjs
node exterior.mjs
node stratum.mjs
node star.mjs
node cycle.mjs
node orient.mjs
node validate.mjs
