// precompute-reachability.js — Generate per-variant reachability maps in a single graph walk
// Run: node precompute-reachability.js
// Output: data/reach/<templateId>--<variantKey>.json (variant-specific)
//         data/reach/<templateId>.json (templates without variants)

const fs = require('fs');
const path = require('path');
const { createGzip } = require('zlib');
const { pipeline } = require('stream/promises');

const { templateMatches } = require('./engine.js');
const { computeReachability, resolvedState, setTemplates } = require('./graph-walker.js');

function buildMatchersAndCompute(templates, opts = {}) {
    const primaryDims = new Set();
    const entries = [];
    for (const t of templates) {
        const variants = t.variants && typeof t.variants === 'object' ? Object.keys(t.variants) : null;
        if (variants && variants.length > 0 && t.primaryDimension) {
            primaryDims.add(t.primaryDimension);
            for (const vk of variants) {
                entries.push({
                    id: t.id + '--' + vk,
                    matcher: (sel) => {
                        const state = resolvedState(sel);
                        return templateMatches(t, state) && state[t.primaryDimension] === vk;
                    },
                });
            }
        } else {
            entries.push({
                id: t.id,
                matcher: (sel) => templateMatches(t, resolvedState(sel)),
            });
        }
    }

    if (entries.length > 31) throw new Error(`${entries.length} matchers exceeds 31-bit bitmask limit`);

    const matchers = entries.map(e => e.matcher);
    const quiet = opts.quiet || false;
    if (!quiet) {
        console.log(`Single walk with ${matchers.length} variant-aware matchers...`);
    }

    setTemplates(templates);
    const result = computeReachability({ matchers, quiet });
    return { ...result, entries, primaryDims };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildMatchersAndCompute };
}

if (require.main === module) {

const outcomes = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'outcomes.json'), 'utf8'));
const outDir = path.join(__dirname, 'data', 'reach');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const { reachMap, entries } = buildMatchersAndCompute(outcomes.templates);

console.log(`\nWriting ${entries.length} files (reachable irrKeys only)...`);

let totalRaw = 0, totalGz = 0;
const writes = [];

for (let i = 0; i < entries.length; i++) {
    const { id } = entries[i];
    const bit = 1 << i;
    const reachable = [];
    for (const [ik, mask] of reachMap) {
        if (mask & bit) reachable.push(ik);
    }
    const json = JSON.stringify(reachable);
    const outPath = path.join(outDir, id + '.json');
    fs.writeFileSync(outPath, json);
    totalRaw += json.length;

    const gzPath = outPath + '.gz';
    writes.push(
        pipeline(
            require('stream').Readable.from(json),
            createGzip({ level: 9 }),
            fs.createWriteStream(gzPath)
        ).then(() => {
            const gzSize = fs.statSync(gzPath).size;
            totalGz += gzSize;
            console.log(`  ${id}: ${reachable.length} reachable, ${(json.length / 1024).toFixed(0)}KB raw, ${(gzSize / 1024).toFixed(0)}KB gzipped`);
        })
    );
}

Promise.all(writes).then(() => {
    console.log(`\nDone. ${entries.length} files, ${reachMap.size} irrKeys`);
    console.log(`  Raw total: ${(totalRaw / 1024).toFixed(0)}KB`);
    console.log(`  Gzipped total: ${(totalGz / 1024).toFixed(0)}KB`);
});

}
