// Shared personal vignette resolution utilities
// Used by tests/evaluate.js and tests/validate.js

(function () {

function getCountryBucket(countryName, personalData) {
    if (!personalData) return 'rest';
    const entry = personalData.countries.find(c => c.name === countryName);
    return entry ? entry.bucket : 'rest';
}

function resolveNarrativeVariant(variants, sel) {
    if (!variants || !sel) return null;
    for (const v of variants) {
        if (!v.when) return v;
        const match = Object.entries(v.when).every(
            ([k, vals]) => vals.includes(sel[k])
        );
        if (match) return v;
    }
    return null;
}

function resolvePersonalVignetteText(spec, ctx) {
    if (!spec) return null;
    if (typeof spec === 'string') return spec;
    if (spec._when && Array.isArray(spec._when)) {
        for (const rule of spec._when) {
            if (!rule.if) continue;
            const match = Object.entries(rule.if).every(([k, vals]) =>
                ctx[k] && Array.isArray(vals) && vals.includes(ctx[k])
            );
            if (match) return rule.text || null;
        }
    }
    return spec._default || null;
}

function resolvePersonalVignettes(sel, persona, personalData, narrative, nodes) {
    if (!persona || !persona.country || !persona.profession) return [];
    const bucket = getCountryBucket(persona.country, personalData);
    const ctx = Object.assign({}, sel, {
        profession: persona.profession,
        country_bucket: bucket,
        is_ai_geo: persona.is_ai_geo || 'no',
    });

    const profEntry = personalData && personalData.professions.find(p => p.id === persona.profession);
    const tokenReplace = (str) => {
        if (!str) return str;
        return str
            .replace(/\{country\}/g, persona.country || '')
            .replace(/\{profession\}/g, profEntry ? profEntry.label : (persona.profession || ''));
    };

    const vignettes = [];
    for (const node of nodes) {
        const value = sel[node.id];
        if (!value) continue;
        const edge = node.edges && node.edges.find(e => e.id === value);
        if (!edge) continue;

        const narr = narrative[node.id];
        const narrEdge = narr && narr.values && narr.values[value];
        if (!narrEdge) continue;

        let pv = null;
        let answerLabel = (narrEdge.answerLabel || edge.label);
        if (narrEdge.narrativeVariants && sel) {
            const variant = resolveNarrativeVariant(narrEdge.narrativeVariants, sel);
            if (variant) {
                if (variant.personalVignette) pv = variant.personalVignette;
                if (variant.answerLabel) answerLabel = variant.answerLabel;
            }
        }
        if (!pv && narrEdge.personalVignette) pv = narrEdge.personalVignette;
        if (!pv) continue;

        const text = resolvePersonalVignetteText(pv, ctx);
        if (!text) continue;

        vignettes.push({
            nodeId: node.id,
            heading: node.label || node.id,
            answerLabel: answerLabel || edge.label || value,
            text: tokenReplace(text),
        });
    }
    return vignettes;
}

const exported = {
    getCountryBucket,
    resolvePersonalVignetteText,
    resolvePersonalVignettes,
    resolveNarrativeVariant,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
}
if (typeof window !== 'undefined') {
    window.MilestoneUtils = exported;
}

})();
