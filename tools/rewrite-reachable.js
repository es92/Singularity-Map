#!/usr/bin/env node
// Rewrite reachable clauses for every outcome template per the
// outcome-template-rewrite plan. Preserves narrative fields (variants,
// flavors, flavorHeadings, story, timeline) — only reachable changes.
//
// Run: node tools/rewrite-reachable.js

const fs = require('fs');
const path = require('path');

const HOSTILE = ['paperclip', 'power_seeking', 'swarm', 'alien_coexistence', 'alien_extinction'];

// Shared _not blocks
const HUMANITY_OK_NOT = { post_catch: ['ruined'], conflict_result: ['destruction'] };
const AI_NOT_HOSTILE = [{ containment: ['escaped'], ai_goals: HOSTILE }];

function humanityOk() { return { ...HUMANITY_OK_NOT }; }

// Build _not combining dict-form HUMANITY_OK with array-form AI_NOT_HOSTILE.
// The matcher supports only ONE _not per clause — and conjunctive array vs
// disjunctive dict can't cohabit directly. Strategy: when we need BOTH, use
// array form and add single-key entries for HUMANITY_OK exclusions (each
// single-key conjunction rejects whenever that dim hits the excluded value).
function notBlock({ humanity = false, aiNotHostile = false } = {}) {
    if (!humanity && !aiNotHostile) return undefined;
    // Always use array form for uniformity + mix.
    const entries = [];
    if (humanity) {
        entries.push({ post_catch: ['ruined'] });
        entries.push({ conflict_result: ['destruction'] });
    }
    if (aiNotHostile) {
        entries.push({ containment: ['escaped'], ai_goals: HOSTILE });
    }
    return entries;
}

// Add additional per-clause exclusions (e.g., intent:[self_interest] for
// the-new-hierarchy) as single-key array entries.
function notBlockWithExtras({ humanity = false, aiNotHostile = false, extras = {} } = {}) {
    const entries = [];
    if (humanity) {
        entries.push({ post_catch: ['ruined'] });
        entries.push({ conflict_result: ['destruction'] });
    }
    if (aiNotHostile) {
        entries.push({ containment: ['escaped'], ai_goals: HOSTILE });
    }
    for (const [k, v] of Object.entries(extras)) {
        entries.push({ [k]: v });
    }
    return entries.length ? entries : undefined;
}

const REACHABLE = {
    'the-plateau': [
        { capability: ['plateau'], who_benefits_set: ['yes'], rollout_set: ['yes'] }
    ],
    'the-automation': [
        { capability: ['agi'], who_benefits_set: ['yes'], rollout_set: ['yes'] }
    ],
    'the-gilded-singularity': [
        {
            capability: ['asi'],
            benefit_distribution: ['unequal'],
            failure_mode: ['none'],
            _not: notBlockWithExtras({ humanity: true, aiNotHostile: true })
        }
    ],
    'the-new-hierarchy': [
        {
            capability: ['asi'],
            benefit_distribution: ['extreme'],
            concentration_type: ['elites'],
            failure_mode: ['none'],
            _not: notBlockWithExtras({
                humanity: true,
                aiNotHostile: true,
                extras: {
                    intent: ['self_interest'],
                    post_war_aims: ['self_interest']
                }
            })
        }
    ],
    'the-flourishing': [
        {
            capability: ['asi'],
            benefit_distribution: ['equal'],
            failure_mode: ['none'],
            intent: ['international'],
            _not: notBlockWithExtras({ humanity: true, aiNotHostile: true })
        }
    ],
    'the-capture': [
        {
            capability: ['asi'],
            benefit_distribution: ['extreme'],
            concentration_type: ['inner_circle'],
            _not: notBlockWithExtras({ humanity: true, aiNotHostile: true })
        },
        {
            capability: ['asi'],
            benefit_distribution: ['extreme'],
            concentration_type: ['singleton'],
            _not: notBlockWithExtras({ humanity: true, aiNotHostile: true })
        },
        {
            capability: ['asi'],
            benefit_distribution: ['extreme'],
            geo_spread: ['one'],
            intent: ['self_interest'],
            _not: notBlockWithExtras({ humanity: true, aiNotHostile: true })
        },
        {
            capability: ['asi'],
            benefit_distribution: ['extreme'],
            post_war_aims: ['self_interest'],
            _not: notBlockWithExtras({ humanity: true, aiNotHostile: true })
        }
    ],
    'the-standoff': [
        {
            capability: ['asi'],
            escalation_outcome: ['standoff'],
            rollout_set: ['yes'],
            _not: notBlockWithExtras({ humanity: true, aiNotHostile: true })
        }
    ],
    'the-ruin': [
        { capability: ['asi'], post_catch: ['ruined'] },
        {
            capability: ['asi'],
            conflict_result: ['destruction'],
            _not: notBlockWithExtras({ aiNotHostile: true })
        }
    ],
    'the-mosaic': [
        {
            capability: ['asi'],
            benefit_distribution: ['equal'],
            failure_mode: ['none'],
            intent: ['coexistence'],
            _not: notBlockWithExtras({ humanity: true, aiNotHostile: true })
        }
    ],
    'the-failure': [
        {
            capability: ['asi'],
            failure_mode: ['drift'],
            _not: notBlockWithExtras({ humanity: true, aiNotHostile: true })
        }
    ],
    'the-escape': [
        {
            capability: ['asi'],
            ai_goals: ['paperclip', 'power_seeking'],
            _not: notBlockWithExtras({ extras: { post_catch: ['ruined'] } })
        },
        {
            capability: ['asi'],
            ai_goals: ['benevolent'],
            containment: ['escaped'],
            rollout_set: ['yes'],
            _not: notBlockWithExtras({ humanity: true })
        }
    ],
    'the-alien-ai': [
        {
            capability: ['asi'],
            ai_goals: ['alien_extinction'],
            _not: notBlockWithExtras({ extras: { post_catch: ['ruined'] } })
        },
        {
            capability: ['asi'],
            ai_goals: ['alien_coexistence'],
            rollout_set: ['yes'],
            _not: notBlockWithExtras({ extras: { post_catch: ['ruined'] } })
        }
    ],
    'the-chaos': [
        {
            capability: ['asi'],
            ai_goals: ['swarm'],
            _not: notBlockWithExtras({ extras: { post_catch: ['ruined'] } })
        }
    ]
};

function main() {
    const outcomesPath = path.join(__dirname, '..', 'data', 'outcomes.json');
    const raw = fs.readFileSync(outcomesPath, 'utf8');
    const data = JSON.parse(raw);

    let changed = 0;
    for (const t of data.templates) {
        if (!(t.id in REACHABLE)) {
            console.warn(`[warn] no rewrite for template "${t.id}"`);
            continue;
        }
        t.reachable = REACHABLE[t.id];
        changed++;
    }
    console.log(`rewrote reachable for ${changed} templates`);

    const out = JSON.stringify(data, null, 2) + '\n';
    fs.writeFileSync(outcomesPath, out, 'utf8');
    console.log(`wrote ${outcomesPath}`);
}

main();
