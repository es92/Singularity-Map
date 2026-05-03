#!/usr/bin/env node
// tests/run.js — aggregator that runs the full local test suite.
//
// Each test is invoked as a child process with the same memory budget
// `npm test` uses for `validate.js`. On pass we emit a one-line summary;
// on fail we replay the full captured stdout/stderr so the failure is
// debuggable without re-running.
//
// Excluded by design:
//   * tests/evaluate.js — LLM-based persona simulator. Requires
//     ANTHROPIC_API_KEY and burns budget; run manually when wanted.
//
// Usage:
//   node tests/run.js              # full suite (~3 min)
//   npm run test:all               # same, via package.json

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const NODE_FLAGS = ['--max-old-space-size=16384'];

// ─── Prereq: explore-cache must exist ─────────────────────────────
// Several tests below (reach_parity, derive_reach_parity,
// runtime_cache_parity, outcome_parity, random_walks_locked) read
// data/explore-cache/*.full.bin produced by the reach precompute
// pipeline. The cache is gitignored (regenerating churns ~50 MB on
// every graph change), so first-time clones won't have it. Detect
// and run the pipeline once before the suite — adds ~4 min on cold
// start, no-op on warm.
const META_PATH = path.join(REPO_ROOT, 'data', 'explore-cache', '_meta.json');
if (!fs.existsSync(META_PATH)) {
    console.log('data/explore-cache missing — running precompute pipeline (~4 min, one-time)...\n');
    const pre = spawnSync('npm', ['run', 'precompute'], {
        stdio: 'inherit', cwd: REPO_ROOT,
    });
    if (pre.status !== 0) {
        console.error('\nprecompute failed; aborting test suite.');
        process.exit(pre.status || 1);
    }
    console.log('\nprecompute complete.\n');
}

// Ordered cheapest → most expensive so failures surface fast.
const SUITE = [
    // ── Cheap contract tests (sub-second each) ──────────────────
    { label: 'tests/module_primitive',         file: 'tests/module_primitive.js' },
    { label: 'tests/decel_exit_evictions',     file: 'tests/decel_exit_evictions.js' },
    { label: 'tests/module_reads_complete',    file: 'tests/module_reads_complete.js' },
    { label: 'tests/post_write_dim_usage',     file: 'tests/post_write_dim_usage.js' },
    { label: 'tests/random_walks',             file: 'tests/random_walks.js' },
    { label: 'tests/premature_outcomes',       file: 'tests/premature_outcomes.js' },
    { label: 'tests/unreachable_clauses',      file: 'tests/unreachable_clauses.js' },
    { label: 'tests/reach_parity',             file: 'tests/reach_parity.js' },
    { label: 'tests/derive_reach_parity',      file: 'tests/derive_reach_parity.js' },
    { label: 'tests/runtime_cache_parity',     file: 'tests/runtime_cache_parity.js' },
    { label: 'tests/outcome_parity',           file: 'tests/outcome_parity.js' },
    { label: 'tests/random_walks_locked',      file: 'tests/random_walks_locked.js' },
    { label: 'tests/module_no_repeat_questions', file: 'tests/module_no_repeat_questions.js' },

    // ── Heavier static-analysis tests (~minute each) ────────────
    { label: 'validate.js',                    file: 'validate.js' },
    { label: 'tests/flow_next_parity',         file: 'tests/flow_next_parity.js' },
    { label: 'tests/all_variants_reachable',   file: 'tests/all_variants_reachable.js' },
    { label: 'tests/narrative_coverage',       file: 'tests/narrative_coverage.js' },
];

function pad(s, n) { return s + ' '.repeat(Math.max(0, n - s.length)); }

const labelWidth = SUITE.reduce((m, t) => Math.max(m, t.label.length), 0);
const t0 = Date.now();
const failures = [];

console.log(`Running ${SUITE.length} tests...\n`);

for (const t of SUITE) {
    const start = Date.now();
    const result = spawnSync(
        'node',
        [...NODE_FLAGS, path.join(REPO_ROOT, t.file)],
        { stdio: ['ignore', 'pipe', 'pipe'], cwd: REPO_ROOT }
    );
    const dt = ((Date.now() - start) / 1000).toFixed(1);
    const ok = result.status === 0;

    if (ok) {
        console.log(`  PASS  ${pad(t.label, labelWidth)}  (${dt}s)`);
    } else {
        console.log(`  FAIL  ${pad(t.label, labelWidth)}  (${dt}s)`);
        failures.push({ ...t, dt, stdout: result.stdout, stderr: result.stderr });
    }
}

const total = ((Date.now() - t0) / 1000).toFixed(1);
const passed = SUITE.length - failures.length;

console.log();
console.log('━'.repeat(60));
if (failures.length === 0) {
    console.log(`PASS  ${passed}/${SUITE.length} tests in ${total}s`);
    process.exit(0);
} else {
    console.log(`FAIL  ${passed}/${SUITE.length} tests passed, ${failures.length} failed (${total}s)`);
    console.log('━'.repeat(60));
    for (const f of failures) {
        console.log();
        console.log(`── ${f.label} ──`);
        if (f.stdout && f.stdout.length) process.stdout.write(f.stdout);
        if (f.stderr && f.stderr.length) process.stderr.write(f.stderr);
    }
    process.exit(1);
}
