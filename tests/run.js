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
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const NODE_FLAGS = ['--max-old-space-size=16384'];

// Ordered cheapest → most expensive so failures surface fast.
const SUITE = [
    // ── Cheap contract tests (sub-second each) ──────────────────
    { label: 'tests/module_primitive',         file: 'tests/module_primitive.js' },
    { label: 'tests/decel_exit_evictions',     file: 'tests/decel_exit_evictions.js' },
    { label: 'tests/module_reads_complete',    file: 'tests/module_reads_complete.js' },
    { label: 'tests/post_write_dim_usage',     file: 'tests/post_write_dim_usage.js' },
    { label: 'tests/premature_outcomes',       file: 'tests/premature_outcomes.js' },
    { label: 'tests/unreachable_clauses',      file: 'tests/unreachable_clauses.js' },
    { label: 'tests/reach_parity',             file: 'tests/reach_parity.js' },

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
