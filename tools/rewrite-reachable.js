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

// "Escape doesn't matter if the AI stayed inert forever." Blocks any
// containment=escaped sel UNLESS inert_stays=yes. Hostile- and benevolent-
// escaped paths route to the-escape (their dedicated outcome); only the
// marginal-escaped-then-inert path treats the escape as a background non-
// event so the world-rollout outcomes (gilded / new-hierarchy / flourishing
// / capture / standoff / mosaic / failure) can still match on their other
// dims. the-ruin's destruction clause uses the same exclusion so a war-
// destroyed civilization with a dormant escapee in the background still
// lands in ruin (humans destroyed themselves over a non-threat).
const ESCAPED_NOT_INERT = { containment: ['escaped'], inert_stays: { not: ['yes'] } };

function humanityOk() { return { ...HUMANITY_OK_NOT }; }

// Build _not combining dict-form HUMANITY_OK with array-form ESCAPED_NOT_INERT.
// The matcher supports only ONE _not per clause — and conjunctive array vs
// disjunctive dict can't cohabit directly. Strategy: when we need BOTH, use
// array form and add single-key entries for HUMANITY_OK exclusions (each
// single-key conjunction rejects whenever that dim hits the excluded value).
function notBlock({ humanity = false, escapedNotInert = false } = {}) {
    if (!humanity && !escapedNotInert) return undefined;
    // Always use array form for uniformity + mix.
    const entries = [];
    if (humanity) {
        entries.push({ post_catch: ['ruined'] });
        entries.push({ conflict_result: ['destruction'] });
    }
    if (escapedNotInert) {
        entries.push({ ...ESCAPED_NOT_INERT });
    }
    return entries;
}

// Add additional per-clause exclusions (e.g., intent:[self_interest] for
// the-new-hierarchy) as single-key array entries.
function notBlockWithExtras({ humanity = false, escapedNotInert = false, extras = {} } = {}) {
    const entries = [];
    if (humanity) {
        entries.push({ post_catch: ['ruined'] });
        entries.push({ conflict_result: ['destruction'] });
    }
    if (escapedNotInert) {
        entries.push({ ...ESCAPED_NOT_INERT });
    }
    for (const [k, v] of Object.entries(extras)) {
        entries.push({ [k]: v });
    }
    return entries.length ? entries : undefined;
}

const REACHABLE = {
    'the-plateau': [
        { capability: ['plateau'], early_rollout_set: ['yes'] }
    ],
    'the-automation': [
        { capability: ['agi'], early_rollout_set: ['yes'] }
    ],
    'the-gilded-singularity': [
        {
            capability: ['asi'],
            benefit_distribution: ['unequal'],
            failure_mode: ['none'],
            _not: notBlockWithExtras({ humanity: true, escapedNotInert: true })
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
                escapedNotInert: true,
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
            _not: notBlockWithExtras({ humanity: true, escapedNotInert: true })
        }
    ],
    'the-capture': [
        {
            capability: ['asi'],
            benefit_distribution: ['extreme'],
            concentration_type: ['inner_circle'],
            _not: notBlockWithExtras({ humanity: true, escapedNotInert: true })
        },
        {
            capability: ['asi'],
            benefit_distribution: ['extreme'],
            concentration_type: ['singleton'],
            _not: notBlockWithExtras({ humanity: true, escapedNotInert: true })
        },
        {
            capability: ['asi'],
            benefit_distribution: ['extreme'],
            geo_spread: ['one'],
            intent: ['self_interest'],
            _not: notBlockWithExtras({ humanity: true, escapedNotInert: true })
        },
        {
            capability: ['asi'],
            benefit_distribution: ['extreme'],
            post_war_aims: ['self_interest'],
            _not: notBlockWithExtras({ humanity: true, escapedNotInert: true })
        }
    ],
    'the-standoff': [
        {
            capability: ['asi'],
            escalation_outcome: ['standoff'],
            rollout_set: ['yes'],
            _not: notBlockWithExtras({ humanity: true, escapedNotInert: true })
        }
    ],
    'the-ruin': [
        { capability: ['asi'], post_catch: ['ruined'] },
        {
            capability: ['asi'],
            conflict_result: ['destruction'],
            // Allow escape to land here when the escape itself wasn't the
            // root cause of destruction:
            //   - inert_stays=yes  → AI escaped but stayed dormant; humans
            //                        destroyed themselves over a non-threat.
            //   - ai_goals=benevolent → AI was actually benign; alignment
            //                        broke / humans panicked / war was the
            //                        tragedy of mistaken hostility.
            // Hostile escapes route to the-escape instead — escape there
            // IS the story.
            _not: [
                {
                    containment: ['escaped'],
                    inert_stays: { not: ['yes'] },
                    ai_goals: { not: ['benevolent'] }
                }
            ]
        }
    ],
    'the-mosaic': [
        {
            capability: ['asi'],
            benefit_distribution: ['equal'],
            failure_mode: ['none'],
            intent: ['coexistence'],
            _not: notBlockWithExtras({ humanity: true, escapedNotInert: true })
        }
    ],
    'the-failure': [
        {
            capability: ['asi'],
            failure_mode: ['drift'],
            _not: notBlockWithExtras({ humanity: true, escapedNotInert: true })
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
        },
        // AI-soft-takeover entry: humans handed the AI the world
        // (concentration_type=ai_itself) and it wields power
        // generously (power_use=generous derives ai_goals=
        // benevolent via collapseToFlavor on the power_use edge).
        // Same end-state as a benevolent runaway, reached via a
        // different door — flavor text already exists in the
        // template's concentration_type.ai_itself entry.
        // power_use=generous is included explicitly so the
        // premature-outcomes audit sees the matched state as
        // fully-pinned (without it the clause matches a sel
        // where power_use is still askable).
        {
            capability: ['asi'],
            ai_goals: ['benevolent'],
            concentration_type: ['ai_itself'],
            power_use: ['generous'],
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
        // Hostile-coexistence escape: AI's goals dominate, humans
        // are displaced rather than deployed-around. rollout's
        // internals (knowledge_rate / physical_rate / failure_mode)
        // are hidden for hostile-escaped AIs, so rollout_set never
        // gets pinned — same shape as the-escape's paperclip /
        // power_seeking clauses, which also omit it.
        {
            capability: ['asi'],
            ai_goals: ['alien_coexistence'],
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
