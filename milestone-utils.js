// Shared milestone resolution utilities
// Used by index.html (browser), validate.js, and evaluate.js

(function () {

function resolveMilestoneText(textSpec, ctx) {
    if (typeof textSpec === 'string') return textSpec;
    if (!textSpec || typeof textSpec !== 'object') return null;
    for (const [dimKey, variants] of Object.entries(textSpec)) {
        const val = ctx[dimKey];
        if (!val) continue;
        const resolved = variants[val];
        if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
            const nested = resolveMilestoneText(resolved, ctx);
            if (nested) return nested;
        }
        if (typeof resolved === 'string') return resolved;
        if (variants._default) {
            if (typeof variants._default === 'string') return variants._default;
            const nested = resolveMilestoneText(variants._default, ctx);
            if (nested) return nested;
        }
        return null;
    }
    if (textSpec._default) return typeof textSpec._default === 'string' ? textSpec._default : null;
    return null;
}

function filterMilestones(milestones, worldState) {
    if (!milestones) return [];
    return milestones.filter(m => {
        if (!m.when) return true;
        return Object.entries(m.when).every(([k, vals]) =>
            worldState[k] && vals.includes(worldState[k])
        );
    });
}

function resolvePersonalMilestones(milestones, answers, worldState, personalData) {
    if (!milestones || !answers) return [];
    const bucket = getCountryBucket(answers.country, personalData);
    const ctx = Object.assign({}, worldState, {
        profession: answers.profession,
        country_bucket: bucket,
        position: answers.position || null,
    });

    const filtered = filterMilestones(milestones, worldState);

    return filtered
        .map(m => {
            const text = resolveMilestoneText(m.text, ctx) || resolveMilestoneText(m.text, { _default: true });
            if (!text) return null;
            return {
                offsetMonths: m.offsetMonths || 0,
                headline: m.headline || '',
                text,
            };
        })
        .filter(Boolean);
}

function getCountryBucket(countryName, personalData) {
    if (!personalData) return 'rest';
    const entry = personalData.countries.find(c => c.name === countryName);
    return entry ? entry.bucket : 'rest';
}

function collectDimensions(textSpec, depth) {
    const dims = new Set();
    if (!textSpec || typeof textSpec !== 'object' || typeof textSpec === 'string') return dims;
    for (const [k, v] of Object.entries(textSpec)) {
        if (k === '_default') continue;
        if (depth % 2 === 0) dims.add(k);
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            for (const d of collectDimensions(v, depth + 1)) dims.add(d);
        }
    }
    return dims;
}

const exported = {
    resolveMilestoneText,
    filterMilestones,
    resolvePersonalMilestones,
    getCountryBucket,
    collectDimensions,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
}
if (typeof window !== 'undefined') {
    window.MilestoneUtils = exported;
}

})();
