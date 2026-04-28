#!/usr/bin/env node
/*
 * Variant-level outcome reachability (sel-space).
 *
 * validate.js Phase 7 checks reachability at the TEMPLATE level (every
 * outcome template is hit at least once). But many templates expand
 * into multiple variants via `primaryDimension` — e.g. `the-mosaic`
 * has variants {robust, brittle, failed} keyed by `alignment`. The
 * template counts as reached as soon as ANY variant is hit, so a
 * variant that is structurally unreachable in sel-space silently
 * slips past Phase 7. The precompute catches this at the very end
 * (one reach file per variant, warn on empty), but only after a
 * ~20-minute precompute run.
 *
 * This test runs the same FlowPropagation.run that
 * tests/unreachable_clauses.js uses (~60s) and asserts that every
 * (templateId, variantKey) pair the outcomes.json schema declares
 * is hit by at least one runtime-reachable sel — using the SAME
 * sel-only variant determination the precompute does.
 *
 * What "variant key" means
 * ───────────────────────
 * For each template T:
 *   * If T.primaryDimension is set AND T.variants is non-empty: the
 *     variant key for a matched sel S is S[T.primaryDimension]. The
 *     test requires that for every key K in T.variants, some matched
 *     sel has S[T.primaryDimension] === K.
 *   * Otherwise: the template is treated as a single "no-variant"
 *     outcome and must be hit at least once (same as Phase 7).
 *
 * Sel-only is the right granularity for THIS test because that's
 * exactly how the precompute writes its per-variant reach files.
 * At runtime the UI determines the variant from fused state
 * (sel ∪ flavor), so an "undefined" variant in propagation is
 * usually a sign that some edge moved the primary-dim to flavor
 * after writing it — runtime renders correctly via narrEff but
 * the precompute reach file for the corresponding variant ends
 * up empty. This test reports such paths as
 * "INFO: undefined variant matches" so they're visible. Combined
 * with the per-variant unreached check, it surfaces both kinds
 * of bug: a declared variant that nothing reaches, AND a path
 * that matches a template but lacks sel-space attribution to a
 * specific variant.
 *
 * Whitelist
 * ─────────
 * Variants that are intentionally / structurally unreachable in
 * sel-space (typically because their primary-dim is moved to flavor
 * before any matching slot) can be documented in
 * `KNOWN_UNREACHABLE_VARIANTS` with a rationale. The test asserts
 * that whitelisted entries are ALSO unreachable in propagation — if
 * a whitelisted variant becomes reachable (e.g. after a graph
 * change), the rationale is stale and the entry must be removed.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

global.window = {
    location: { search: '', hash: '' },
    requestAnimationFrame: () => 0,
    addEventListener: () => {},
    Graph: require('../graph.js'),
    Engine: require('../engine.js'),
};
global.document = {
    addEventListener: () => {},
    readyState: 'complete',
    getElementById: () => null,
    querySelector: () => null,
};
new Function('window', fs.readFileSync(path.join(ROOT, 'graph-io.js'), 'utf8'))(global.window);
new Function('window', 'document', fs.readFileSync(path.join(ROOT, 'nodes.js'), 'utf8'))(global.window, global.document);
new Function('window', fs.readFileSync(path.join(ROOT, 'flow-propagation.js'), 'utf8'))(global.window);

const GraphIO = global.window.GraphIO;
const FlowPropagation = global.window.FlowPropagation;

const TEMPLATES = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/outcomes.json'), 'utf8')).templates;
GraphIO.registerOutcomes(TEMPLATES);

// ── Whitelist ──────────────────────────────────────────────────────
//
// Each entry maps `${templateId}--${variantKey}` (or just
// `${templateId}` for variant-less outcomes) → human-readable
// rationale. Keep this list short; every entry is asserting that a
// declared outcome is structurally unreachable, which usually means
// outcomes.json declares more variants than the graph can produce.
const KNOWN_UNREACHABLE_VARIANTS = {
    // (empty — every declared outcome variant is currently reachable
    // in sel-space. Add an entry here if a variant is intentionally
    // unreachable, with rationale explaining why and what would have
    // to change to make it reachable.)
};

// ── Build the expected (templateId, variantKey) inventory ──────────

const expected = new Map();   // outcomeKey ("tid" or "tid--vk") → { tid, vk }
for (const t of TEMPLATES) {
    if (!t || !t.id) continue;
    const variants = t.variants && typeof t.variants === 'object' && !Array.isArray(t.variants)
        ? Object.keys(t.variants)
        : [];
    if (t.primaryDimension && variants.length) {
        for (const vk of variants) {
            expected.set(`${t.id}--${vk}`, { tid: t.id, vk });
        }
    } else {
        expected.set(t.id, { tid: t.id, vk: null });
    }
}

// ── Run propagation, count matches per outcome key ─────────────────

const TEMPLATES_BY_ID = new Map(TEMPLATES.map(t => [t.id, t]));
const matchCounts = new Map();
for (const k of expected.keys()) matchCounts.set(k, 0);

// Variants seen at runtime that AREN'T in the template's declared
// variants — usually a bug (graph produces a primary-dim value that
// outcomes.json doesn't have a variant entry for, so the UI has no
// title/summary to render).
const unexpectedVariants = new Map(); // outcomeKey → { tid, vk, count }

const t0 = Date.now();
FlowPropagation.run({
    onOutcomeMatch(oid, sel) {
        const t = TEMPLATES_BY_ID.get(oid);
        if (!t) return;
        const variants = t.variants && typeof t.variants === 'object' && !Array.isArray(t.variants)
            ? Object.keys(t.variants)
            : [];
        if (t.primaryDimension && variants.length) {
            const v = sel[t.primaryDimension];
            const key = `${t.id}--${v}`;
            if (matchCounts.has(key)) {
                matchCounts.set(key, matchCounts.get(key) + 1);
            } else {
                const slot = unexpectedVariants.get(key) || { tid: t.id, vk: v, count: 0 };
                slot.count++;
                unexpectedVariants.set(key, slot);
            }
        } else {
            matchCounts.set(t.id, (matchCounts.get(t.id) || 0) + 1);
        }
    },
});
const dur = ((Date.now() - t0) / 1000).toFixed(1);

// ── Classify outcomes ──────────────────────────────────────────────

const unreached = [];        // declared but never hit, not whitelisted
const whitelistedDead = [];  // declared, never hit, whitelisted (expected)
const whitelistAlive = [];   // whitelisted but actually hit (stale entry)

for (const [key, info] of expected) {
    const hits = matchCounts.get(key) || 0;
    const isWhitelisted = KNOWN_UNREACHABLE_VARIANTS[key];
    if (hits === 0) {
        if (isWhitelisted) whitelistedDead.push({ key, info, rationale: isWhitelisted });
        else unreached.push({ key, info });
    } else if (isWhitelisted) {
        whitelistAlive.push({ key, info, hits, rationale: isWhitelisted });
    }
}

// Stale whitelist entries: keys in KNOWN_UNREACHABLE_VARIANTS that
// don't correspond to any declared outcome at all.
const staleWhitelist = [];
for (const key of Object.keys(KNOWN_UNREACHABLE_VARIANTS)) {
    if (!expected.has(key)) staleWhitelist.push(key);
}

// ── Report ─────────────────────────────────────────────────────────

console.log(`variant reachability audit (propagation: ${dur}s)`);
console.log(`  declared outcome variants: ${expected.size}`);
console.log(`  reached at least once:     ${expected.size - unreached.length - whitelistedDead.length}`);
console.log(`  whitelisted unreachable:   ${whitelistedDead.length}`);
for (const w of whitelistedDead) {
    console.log(`    ${w.key}`);
    console.log(`      ${w.rationale}`);
}
// Distinguish two flavors of unexpected variants:
//   undefined   — primary-dim is unset in sel (commonly: dim was
//                 moved to flavor before terminal). The runtime
//                 UI resolves these correctly via fused state, so
//                 we report as INFO (not a failure).
//   non-undef   — primary-dim has a value that outcomes.json
//                 doesn't declare a variant for. The UI has no
//                 title/summary; this is a real bug.
const undefinedVariants = [];
const truelyUnexpected = [];
for (const [k, v] of unexpectedVariants) {
    if (String(v.vk) === 'undefined') undefinedVariants.push({ k, v });
    else truelyUnexpected.push({ k, v });
}
if (undefinedVariants.length) {
    console.log(`  INFO: ${undefinedVariants.length} template(s) match with sel.<primaryDim>=undefined`);
    console.log('  (resolved at runtime via fused state — not a sel-space failure):');
    for (const { k, v } of undefinedVariants) {
        console.log(`    ${k}  (${v.count} match${v.count === 1 ? '' : 'es'}; primaryDim=${v.tid && (TEMPLATES_BY_ID.get(v.tid) || {}).primaryDimension || '?'})`);
    }
}
console.log('');

const failed = unreached.length || whitelistAlive.length || staleWhitelist.length || truelyUnexpected.length;

if (!failed) {
    console.log('all variants reachable: PASS');
    process.exit(0);
}

console.error('all variants reachable: FAIL');
console.error('');

if (unreached.length) {
    console.error(`  ${unreached.length} unreached variant(s):`);
    console.error('  Variant declared in outcomes.json (template.variants[k] or');
    console.error('  bare template id when no variants) but no propagation-walked');
    console.error('  sel matched it. Either the variant is over-constrained, the');
    console.error('  primary-dim value is unreachable on paths matching the');
    console.error('  template\'s reachable clauses, or the variant should be');
    console.error('  removed from outcomes.json.');
    console.error('');
    for (const u of unreached) {
        console.error(`    ${u.key}`);
    }
    console.error('');
}

if (whitelistAlive.length) {
    console.error(`  ${whitelistAlive.length} stale whitelist entr(ies) — variant IS reachable now:`);
    console.error('  KNOWN_UNREACHABLE_VARIANTS asserted this was unreachable, but');
    console.error('  propagation found at least one matching sel. Remove the entry');
    console.error('  from the whitelist (the rationale no longer holds).');
    console.error('');
    for (const w of whitelistAlive) {
        console.error(`    ${w.key}  (${w.hits} match${w.hits === 1 ? '' : 'es'})`);
        console.error(`      stale rationale: ${w.rationale}`);
    }
    console.error('');
}

if (staleWhitelist.length) {
    console.error(`  ${staleWhitelist.length} stale whitelist entr(ies) — outcome no longer declared:`);
    console.error('  KNOWN_UNREACHABLE_VARIANTS references an outcome key that');
    console.error('  outcomes.json doesn\'t declare. The variant was probably');
    console.error('  removed; delete the whitelist entry to keep the list honest.');
    console.error('');
    for (const k of staleWhitelist) {
        console.error(`    ${k}: remove from KNOWN_UNREACHABLE_VARIANTS`);
    }
    console.error('');
}

if (truelyUnexpected.length) {
    console.error(`  ${truelyUnexpected.length} unexpected variant key(s) at runtime:`);
    console.error('  A propagation-reachable sel matched a template with a');
    console.error('  defined sel.<primaryDim> value that is NOT a key in');
    console.error('  template.variants. The UI has no title/summary for this');
    console.error('  variant. Either add the missing entry to outcomes.json,');
    console.error('  or tighten the template reachable clauses so that');
    console.error('  primary-dim value cannot match.');
    console.error('');
    for (const { k, v } of truelyUnexpected) {
        console.error(`    ${k}  (${v.count} match${v.count === 1 ? '' : 'es'})`);
    }
    console.error('');
}

process.exit(1);
