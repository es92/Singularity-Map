// Shared personal vignette resolution utilities
// Used by tests/evaluate.js

(function () {

function matchWhen(when, sel) {
    for (const [k, vals] of Object.entries(when)) {
        if (k === '_raw') {
            for (const [rk, rv] of Object.entries(vals)) {
                if (!sel[rk] || !rv.includes(sel[rk])) return false;
            }
        } else if (k === '_eff') {
            for (const [ek, ev] of Object.entries(vals)) {
                const v = sel[ek];
                if (!v || !ev.includes(v)) return false;
            }
        } else if (k.startsWith('_')) {
            continue;
        } else {
            if (!Array.isArray(vals)) continue;
            if (!vals.includes(sel[k])) return false;
        }
    }
    return true;
}

function resolveNarrativeVariant(variants, sel) {
    if (!variants || !sel) return null;
    for (const v of variants) {
        if (!v.when) return v;
        if (matchWhen(v.when, sel)) return v;
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

// State-iteration variant. Walks every node and checks `state[node.id]`.
// `state` is typically `Engine.narrativeState(stack)` (sel layered with
// flavor) so dims that effects.move evicted from sel still resolve. Used
// by the audit path which passes synthetic states (no stack available).
//
// CAUTION: this can double-count when a stack pick is `early_X=v` and
// effects writes the canonical `X=v` — both nodes will have state[id]=v
// and emit vignettes. For walks where you have a stack, prefer
// `resolvePersonalVignettesFromStack` (eval path).
function resolvePersonalVignettes(state, persona, personalData, narrative, nodes) {
    if (!persona || !persona.profession) return [];
    const ctx = Object.assign({}, state, {
        profession: persona.profession,
    });

    const profEntry = personalData && personalData.professions.find(p => p.id === persona.profession);
    const tokenReplace = (str) => {
        if (!str) return str;
        return str.replace(/\{profession\}/g, profEntry ? profEntry.label : (persona.profession || ''));
    };

    const vignettes = [];
    for (const node of nodes) {
        const value = state[node.id];
        if (!value) continue;
        // Don't require value to match a node.edges entry: an edge upstream
        // (e.g. early_knowledge_rate.limited) can write a canonical dim
        // value via effects.set that the canonical node itself doesn't
        // expose as an edge. The narrative.values lookup below is the
        // authoritative source for whether a vignette exists.
        const edge = node.edges && node.edges.find(e => e.id === value);

        const narr = narrative[node.id];
        const narrEdge = narr && narr.values && narr.values[value];
        if (!narrEdge) continue;

        let pv = null;
        let answerLabel = narrEdge.answerLabel || (edge && edge.label) || value;
        if (narrEdge.narrativeVariants && state) {
            const variant = resolveNarrativeVariant(narrEdge.narrativeVariants, state);
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
            answerLabel: answerLabel || (edge && edge.label) || value,
            text: tokenReplace(text),
        });
    }
    return vignettes;
}

// Stack-iteration variant. Walks user picks (stack entries) and looks up
// narrative content directly by node.id + edge.id. This mirrors the UI's
// behavior in index.html: only show vignettes for the user's actual
// choices, not for canonical dims that effects rewrote (e.g., walking
// stack avoids the early_knowledge_rate / knowledge_rate duplicate).
//
// `state` should be `Engine.narrativeState(stack)` so narrativeVariants
// matching can observe both sel and flavor dims.
function resolvePersonalVignettesFromStack(stack, state, persona, personalData, narrative, nodeMap) {
    if (!persona || !persona.profession) return [];
    const ctx = Object.assign({}, state, {
        profession: persona.profession,
    });

    const profEntry = personalData && personalData.professions.find(p => p.id === persona.profession);
    const tokenReplace = (str) => {
        if (!str) return str;
        return str.replace(/\{profession\}/g, profEntry ? profEntry.label : (persona.profession || ''));
    };

    const vignettes = [];
    for (const entry of stack) {
        if (!entry || !entry.nodeId) continue;
        const node = nodeMap[entry.nodeId];
        if (!node || node.derived) continue;
        const value = entry.edgeId;
        if (!value) continue;

        const narr = narrative[node.id];
        const narrEdge = narr && narr.values && narr.values[value];
        if (!narrEdge) continue;

        const edge = node.edges && node.edges.find(e => e.id === value);
        let pv = null;
        let answerLabel = narrEdge.answerLabel || (edge && edge.label) || value;
        if (narrEdge.narrativeVariants && state) {
            const variant = resolveNarrativeVariant(narrEdge.narrativeVariants, state);
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
            answerLabel,
            text: tokenReplace(text),
        });
    }
    return vignettes;
}

const exported = {
    resolvePersonalVignetteText,
    resolvePersonalVignettes,
    resolvePersonalVignettesFromStack,
    resolveNarrativeVariant,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
}
if (typeof window !== 'undefined') {
    window.MilestoneUtils = exported;
}

})();
