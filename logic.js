// Shared logic module for Singularity Map explorer
// Used by both index.html (browser) and test-explorer.js (Node.js)

const DIM_META = [
    { id: 'capability', label: 'AI Scaling', stage: 1, values: [
        { id: 'singularity', label: 'Trend continues' }, { id: 'hours', label: 'Stalls: hours' },
        { id: 'days', label: 'Stalls: days' }, { id: 'weeks', label: 'Stalls: weeks' },
        { id: 'months', label: 'Stalls: months' } ] },
    { id: 'stall_recovery', label: 'Recovery?', stage: 1,
      visibleWhen: { capability: ['hours', 'days', 'weeks', 'months'] }, values: [
        { id: 'mild', label: 'Months/years' }, { id: 'substantial', label: 'Years/decades' }, { id: 'never', label: 'Never' } ] },
    { id: 'automation', label: 'Knowledge Work', stage: 1,
      visibleWhen: { capability: ['singularity'] }, values: [
        { id: 'deep', label: 'Automates broadly' }, { id: 'shallow', label: 'Routine only' } ] },
    { id: 'automation_recovery', label: 'Deep Automation Recovery?', stage: 1,
      visibleWhen: { capability: ['singularity'], automation: ['shallow'] }, values: [
        { id: 'mild', label: 'Months/years' }, { id: 'substantial', label: 'Years/decades' }, { id: 'never', label: 'Never' } ] },
    { id: 'takeoff', label: 'Feedback Loop', stage: 1,
      visibleWhen: { capability: ['singularity'], automation: ['deep'] }, values: [
        { id: 'gradual', label: 'Gradual' }, { id: 'fast', label: 'Fast' }, { id: 'hard', label: 'Explosive' } ] },
    { id: 'governance_window', label: 'Governance Window', stage: 1,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], takeoff: ['gradual'] }, values: [
        { id: 'governed', label: 'Active preparation' }, { id: 'race', label: 'Relative complacency' } ] },
    { id: 'open_source', label: 'Open Source', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'] },
      lockedWhen: { takeoff: { equals: 'hard', value: 'twenty_four_months' } }, values: [
        { id: 'near_parity', label: 'Near-parity' }, { id: 'six_months', label: '~6 months' },
        { id: 'twelve_months', label: '~12 months' }, { id: 'twenty_four_months', label: '~24 months' } ] },
    { id: 'distribution', label: 'Frontier Labs', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'] },
      lockedWhen: { takeoff: { equals: 'hard', value: 'monopoly' }, open_source: { equals: 'near_parity', value: 'open' } }, values: [
        { id: 'open', label: 'Distributed', requires: { open_source: ['near_parity'] } },
        { id: 'lagging', label: 'Many compete' },
        { id: 'concentrated', label: 'A few lead' }, { id: 'monopoly', label: 'One dominates' } ] },
    { id: 'geo_spread', label: 'Countries', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], open_source: ['six_months', 'twelve_months', 'twenty_four_months'] },
      lockedWhen: { takeoff: { equals: 'hard', value: 'one' }, distribution: { equals: 'monopoly', value: 'one' } }, values: [
        { id: 'one', label: 'One country' }, { id: 'two', label: 'Two powers' },
        { id: 'several', label: 'Several' } ] },
    { id: 'sovereignty', label: 'Power Holder', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], distribution: ['monopoly', 'concentrated', 'lagging'], geo_spread: ['one'] }, values: [
        { id: 'lab', label: 'The labs' }, { id: 'state', label: 'The state' } ] },
    { id: 'gov_action', label: 'Deceleration', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], geo_spread: ['one'] },
      lockedWhen: { takeoff: { equals: 'hard', value: 'accelerate' } }, values: [
        { id: 'decelerate', label: 'Decelerate' }, { id: 'accelerate', label: 'Accelerate' } ] },
    { id: 'decel_2mo', label: '2 Months', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], gov_action: ['decelerate'] }, values: [
        { id: 'solved', label: 'Solved' }, { id: 'escapes', label: 'AI Escapes' },
        { id: 'abandon', label: 'Abandon & Accelerate' }, { id: 'rival', label: 'Rival Reaches Parity' },
        { id: 'continue', label: 'Continue' } ] },
    { id: 'decel_4mo', label: '4 Months', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], decel_2mo: ['continue'] }, values: [
        { id: 'solved', label: 'Solved' }, { id: 'escapes', label: 'AI Escapes' },
        { id: 'abandon', label: 'Abandon & Accelerate' }, { id: 'rival', label: 'Rival Reaches Parity' },
        { id: 'continue', label: 'Continue' } ] },
    { id: 'decel_6mo', label: '6 Months', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], decel_4mo: ['continue'] }, values: [
        { id: 'parity_solved', label: 'Parity — Solved', requires: { open_source: ['six_months'] } },
        { id: 'parity_failed', label: 'Parity — Failed', requires: { open_source: ['six_months'] } },
        { id: 'solved', label: 'Solved', requires: { open_source: ['twelve_months', 'twenty_four_months'] } },
        { id: 'escapes', label: 'AI Escapes', requires: { open_source: ['twelve_months', 'twenty_four_months'] } },
        { id: 'abandon', label: 'Abandon & Accelerate', requires: { open_source: ['twelve_months', 'twenty_four_months'] } },
        { id: 'rival', label: 'Rival Reaches Parity', requires: { open_source: ['twelve_months', 'twenty_four_months'] } },
        { id: 'continue', label: 'Continue', requires: { open_source: ['twelve_months', 'twenty_four_months'] } } ] },
    { id: 'decel_9mo', label: '9 Months', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], decel_6mo: ['continue'] }, values: [
        { id: 'solved', label: 'Solved' }, { id: 'escapes', label: 'AI Escapes' },
        { id: 'abandon', label: 'Abandon & Accelerate' }, { id: 'rival', label: 'Rival Reaches Parity' },
        { id: 'continue', label: 'Continue' } ] },
    { id: 'decel_12mo', label: '12 Months', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], decel_9mo: ['continue'] }, values: [
        { id: 'parity_solved', label: 'Parity — Solved', requires: { open_source: ['twelve_months'] } },
        { id: 'parity_failed', label: 'Parity — Failed', requires: { open_source: ['twelve_months'] } },
        { id: 'solved', label: 'Solved', requires: { open_source: ['twenty_four_months'] } },
        { id: 'escapes', label: 'AI Escapes', requires: { open_source: ['twenty_four_months'] } },
        { id: 'abandon', label: 'Abandon & Accelerate', requires: { open_source: ['twenty_four_months'] } },
        { id: 'rival', label: 'Rival Reaches Parity', requires: { open_source: ['twenty_four_months'] } },
        { id: 'continue', label: 'Continue', requires: { open_source: ['twenty_four_months'] } } ] },
    { id: 'decel_18mo', label: '18 Months', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], decel_12mo: ['continue'] }, values: [
        { id: 'solved', label: 'Solved' }, { id: 'escapes', label: 'AI Escapes' },
        { id: 'abandon', label: 'Abandon & Accelerate' }, { id: 'rival', label: 'Rival Reaches Parity' },
        { id: 'continue', label: 'Continue' } ] },
    { id: 'decel_24mo', label: '24 Months', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], decel_18mo: ['continue'] }, values: [
        { id: 'parity_solved', label: 'Parity — Solved' },
        { id: 'parity_failed', label: 'Parity — Failed' } ] },
    { id: 'proliferation_control', label: 'Proliferation Control', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'] },
      lockedWhen: { distribution: { equals: 'open', value: 'none' } }, values: [
        { id: 'deny_rivals', label: 'Deny rivals' },
        { id: 'secure_access', label: 'Secure access' },
        { id: 'none', label: 'No durable control' } ] },
    { id: 'proliferation_outcome', label: 'Control Outcome', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], proliferation_control: ['deny_rivals', 'secure_access'] }, values: [
        { id: 'holds', label: 'Holds' },
        { id: 'breached', label: 'Breached' } ] },
    { id: 'alignment', label: 'Alignment', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'] }, values: [
        { id: 'robust', label: 'Robust' }, { id: 'brittle', label: 'Brittle' },
        { id: 'partial', label: 'Bounded' }, { id: 'failed', label: 'Failed' } ] },
    { id: 'alignment_durability', label: 'Alignment Durability', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], alignment: ['brittle'] }, values: [
        { id: 'holds', label: 'Holds' }, { id: 'breaks', label: 'Breaks' } ] },
    { id: 'alignment_tax', label: 'Capability Constraints', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], alignment: ['partial'] }, values: [
        { id: 'accepted', label: 'Constraints hold' }, { id: 'eroded', label: 'Constraints erode' },
        { id: 'split', label: 'Split deployment' } ] },
    { id: 'intent', label: 'Intent', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle', 'partial'] }, values: [
        { id: 'self_interest', label: 'Self-interest', requires: [{ distribution: ['monopoly'], geo_spread: ['one'], proliferation_control: ['deny_rivals', 'secure_access'] }, { distribution: ['concentrated', 'lagging'], geo_spread: ['one'], sovereignty: ['state'], proliferation_control: ['deny_rivals', 'secure_access'] }] },
        { id: 'coexistence', label: 'Coexistence', requires: [{ distribution: ['open'], open_source: ['near_parity', 'twelve_months', 'twenty_four_months'] }, { distribution: ['lagging', 'concentrated'], open_source: ['near_parity', 'twelve_months', 'twenty_four_months'], geo_spread: ['two', 'several'] }, { geo_spread: ['two'] }, { proliferation_control: ['none'] }, { proliferation_outcome: ['breached'] }] },
        { id: 'rivalry', label: 'Rivalry', requires: [{ distribution: ['open'], open_source: ['near_parity', 'twelve_months', 'twenty_four_months'] }, { distribution: ['lagging', 'concentrated'], open_source: ['near_parity', 'twelve_months', 'twenty_four_months'], geo_spread: ['two', 'several'] }, { geo_spread: ['two'] }, { proliferation_control: ['none'] }, { proliferation_outcome: ['breached'] }] },
        { id: 'escalation', label: 'Escalation', requires: [{ distribution: ['open'], open_source: ['near_parity', 'twelve_months', 'twenty_four_months'] }, { distribution: ['lagging', 'concentrated'], open_source: ['near_parity', 'twelve_months', 'twenty_four_months'], geo_spread: ['two', 'several'] }, { geo_spread: ['two'] }, { proliferation_control: ['none'] }, { proliferation_outcome: ['breached'] }] },
        { id: 'international', label: 'International' } ] },
    { id: 'block_entrants', label: 'Block New Entrants?', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle', 'partial'], proliferation_control: ['secure_access'], proliferation_outcome: ['holds'] }, values: [
        { id: 'attempt', label: 'Attempt to block' },
        { id: 'no_attempt', label: 'No attempt' } ] },
    { id: 'block_outcome', label: 'Blocking Outcome', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], block_entrants: ['attempt'] }, values: [
        { id: 'holds', label: 'Holds' },
        { id: 'fails', label: 'Fails' } ] },
    { id: 'new_entrants', label: 'New Entrants?', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], block_entrants: ['no_attempt'] }, values: [
        { id: 'emerge', label: 'Emerge' },
        { id: 'none', label: 'None' } ] },
    { id: 'rival_dynamics', label: 'Rival Dynamics', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'] }, values: [
        { id: 'coexistence', label: 'Coexistence' },
        { id: 'rivalry', label: 'Rivalry' },
        { id: 'escalation', label: 'Escalation' } ] },
    { id: 'enabled_aims', label: 'Enabled Aims', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], proliferation_control: ['deny_rivals', 'secure_access', 'none'] }, values: [
        { id: 'human_centered', label: 'Human-centered' },
        { id: 'proxy', label: 'Proxy / institutional' },
        { id: 'arbitrary', label: 'Arbitrary / unconstrained', requires: [{ proliferation_control: ['none'] }, { proliferation_outcome: ['breached'] }] } ] },
    { id: 'containment', label: 'Containment', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], alignment: ['failed'] }, values: [
        { id: 'contained', label: 'Contained', requires: { distribution: ['lagging', 'concentrated', 'monopoly'] } },
        { id: 'escaped', label: 'Escapes' } ] },
    { id: 'ai_goals', label: 'AI Converges On', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], alignment: ['failed'], containment: ['escaped'] }, values: [
        { id: 'benevolent', label: 'Benefit humanity' }, { id: 'alien_coexistence', label: 'Alien (tolerant)' },
        { id: 'alien_extinction', label: 'Alien (total)' }, { id: 'paperclip', label: 'Arbitrary' },
        { id: 'swarm', label: 'Divergent' }, { id: 'marginal', label: 'Inert' } ] },
    { id: 'failure_mode', label: 'Implementation', stage: 3,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle', 'partial'] }, values: [
        { id: 'none', label: 'Succeeds' }, { id: 'whimper', label: 'Wrong metrics' },
        { id: 'disempowerment', label: 'Human irrelevance' } ] },
    { id: 'knowledge_replacement', label: 'Knowledge Work', stage: 3,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle', 'partial'], intent: ['international'], failure_mode: ['none', 'whimper', 'disempowerment'] }, values: [
        { id: 'rapid', label: 'Rapid (1–2 yrs)' }, { id: 'gradual', label: 'Gradual (3–10 yrs)' }, { id: 'uneven', label: 'Uneven (1–20 yrs)' },
        { id: 'limited', label: 'Limited', requires: { capability: ['hours', 'days', 'weeks', 'months'] } } ] },
    { id: 'physical_automation', label: 'Physical Automation', stage: 3,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle', 'partial'], intent: ['international'], failure_mode: ['none', 'whimper', 'disempowerment'] }, values: [
        { id: 'rapid', label: 'Rapid (2–5 yrs)' }, { id: 'gradual', label: 'Gradual (5–20 yrs)' }, { id: 'uneven', label: 'Uneven (2–20+ yrs)' },
        { id: 'limited', label: 'Limited', requires: { capability: ['hours', 'days', 'weeks', 'months'] } } ] },
    { id: 'economic_distribution', label: 'Who Benefits?', stage: 3,
      visibleWhen: { capability: ['hours', 'days', 'weeks', 'months'], stall_recovery: ['substantial', 'never'] }, values: [
        { id: 'broad', label: 'Broadly shared' }, { id: 'concentrated', label: 'Capital concentrates' },
        { id: 'uneven', label: 'Uneven by geography' } ] },
    { id: 'plateau_knowledge_rate', label: 'Knowledge Work', stage: 3,
      visibleWhen: { capability: ['hours', 'days', 'weeks', 'months'], stall_recovery: ['substantial', 'never'] }, values: [
        { id: 'rapid', label: 'Rapid (2–5 yrs)', requires: { capability: ['weeks', 'months'] } },
        { id: 'gradual', label: 'Gradual (5–15 yrs)', requires: { capability: ['days', 'weeks', 'months'] } },
        { id: 'uneven', label: 'Uneven (2–20+ yrs)' },
        { id: 'limited', label: 'Limited', requires: { capability: ['hours', 'days'] } } ] },
    { id: 'plateau_physical_rate', label: 'Physical Automation', stage: 3,
      visibleWhen: { capability: ['hours', 'days', 'weeks', 'months'], stall_recovery: ['substantial', 'never'] }, values: [
        { id: 'rapid', label: 'Rapid', requires: { capability: ['singularity'] } },
        { id: 'gradual', label: 'Gradual (10–25 yrs)', requires: { capability: ['days', 'weeks', 'months'] } },
        { id: 'uneven', label: 'Uneven (5–20+ yrs)' },
        { id: 'limited', label: 'Limited' } ] },
    { id: 'automation_distribution', label: 'Who Benefits?', stage: 3,
      visibleWhen: { capability: ['singularity'], automation: ['shallow'], automation_recovery: ['substantial', 'never'] }, values: [
        { id: 'broad', label: 'Broadly shared' }, { id: 'concentrated', label: 'Capital concentrates' },
        { id: 'uneven', label: 'Uneven by geography' } ] },
    { id: 'auto_knowledge_rate', label: 'Knowledge Work', stage: 3,
      visibleWhen: { capability: ['singularity'], automation: ['shallow'], automation_recovery: ['substantial', 'never'] }, values: [
        { id: 'rapid', label: 'Rapid (2–4 yrs)' }, { id: 'gradual', label: 'Gradual (5–15 yrs)' }, { id: 'uneven', label: 'Uneven (2–20+ yrs)' },
        { id: 'limited', label: 'Limited', requires: { automation: ['deep'] } } ] },
    { id: 'auto_physical_rate', label: 'Physical Automation', stage: 3,
      visibleWhen: { capability: ['singularity'], automation: ['shallow'], automation_recovery: ['substantial', 'never'] }, values: [
        { id: 'rapid', label: 'Rapid (3–7 yrs)' }, { id: 'gradual', label: 'Gradual (10–25 yrs)' }, { id: 'uneven', label: 'Uneven (3–20+ yrs)' }, { id: 'limited', label: 'Limited' } ] }
];

const DIM_MAP = {};
for (const d of DIM_META) DIM_MAP[d.id] = d;

function decelOutcome(sel) {
    if (sel.gov_action !== 'decelerate') return null;
    for (const cp of ['decel_2mo', 'decel_4mo', 'decel_6mo', 'decel_9mo', 'decel_12mo', 'decel_18mo', 'decel_24mo']) {
        const v = sel[cp];
        if (v && v !== 'continue') return v;
    }
    return null;
}

function effectiveVal(sel, k) {
    if (k === 'capability' && sel.stall_recovery === 'mild') return 'singularity';
    if (k === 'automation' && sel.automation_recovery === 'mild') return 'deep';
    const out = decelOutcome(sel);
    if (k === 'governance') {
        if (sel.gov_action === 'accelerate') return 'race';
        if (out === 'abandon') return 'race';
        if (sel.gov_action === 'decelerate') return 'slowdown';
        if (sel.governance_window) return sel.governance_window;
    }
    if (k === 'alignment') {
        if (['solved', 'parity_solved'].includes(out)) return 'robust';
        if (sel.ai_goals === 'marginal') return sel[k] === 'failed' ? 'partial' : sel[k];
        if (['escapes', 'abandon', 'rival', 'parity_failed'].includes(out)) return 'failed';
        if (sel.enabled_aims === 'arbitrary') return 'failed';
        if (sel.alignment_durability === 'breaks') return 'failed';
        if (sel.alignment_tax === 'eroded') return 'failed';
        if (['split', 'accepted'].includes(sel.alignment_tax) && sel.containment === 'escaped') return 'failed';
    }
    if (k === 'containment' && ['escapes', 'parity_failed'].includes(out)) return 'escaped';
    if (k === 'containment' && (sel.proliferation_control === 'none' || sel.proliferation_outcome === 'breached') && effectiveVal(sel, 'alignment') === 'failed') return 'escaped';
    if (k === 'containment' && sel.enabled_aims === 'arbitrary' && sel.ai_goals !== 'marginal') return 'escaped';
    if (k === 'intent' && sel.rival_dynamics) return sel.rival_dynamics;
    if (k === 'failure_mode' && sel.enabled_aims === 'proxy') return 'whimper';
    if (k === 'geo_spread') {
        if (['parity_solved', 'parity_failed', 'rival'].includes(out)) return 'two';
        if (sel.proliferation_outcome === 'breached') return 'two';
    }
    return sel[k];
}

function isDimVisible(sel, dim) {
    if (!dim.visibleWhen) return true;
    const out = decelOutcome(sel);
    if (dim.id === 'alignment_tax' && ['escapes', 'abandon', 'rival', 'parity_failed'].includes(out)) return false;
    if (dim.id === 'proliferation_control') {
        if (['escapes', 'parity_failed'].includes(out)) return false;
    }
    if (dim.id === 'containment') {
        if (['solved', 'parity_solved'].includes(out)) return false;
        const alignFailed = effectiveVal(sel, 'alignment') === 'failed';
        const partialEscapeRisk = ['split', 'accepted'].includes(sel.alignment_tax);
        const marginalEscape = sel.ai_goals === 'marginal';
        if (!alignFailed && !partialEscapeRisk && !marginalEscape) return false;
        if (!['escapes', 'parity_failed'].includes(out) && !sel.proliferation_control && !marginalEscape) return false;
        return effectiveVal(sel, 'capability') === 'singularity' && effectiveVal(sel, 'automation') === 'deep';
    }
    if (dim.id === 'ai_goals' && sel.ai_goals === 'marginal' && sel.containment === 'escaped') {
        return effectiveVal(sel, 'capability') === 'singularity' && effectiveVal(sel, 'automation') === 'deep';
    }
    if (dim.id === 'rival_dynamics') {
        if (sel.block_outcome !== 'fails' && sel.new_entrants !== 'emerge') return false;
    }
    if (dim.id === 'failure_mode' && sel.enabled_aims !== 'proxy' && effectiveVal(sel, 'intent') !== 'international') return false;
    const failedContained = effectiveVal(sel, 'alignment') === 'failed' && sel.containment === 'contained';
    if (dim.id === 'intent' && sel.alignment === 'failed' && sel.containment) return true;
    if (dim.id === 'failure_mode' && failedContained && effectiveVal(sel, 'intent') === 'international') return true;
    if ((dim.id === 'knowledge_replacement' || dim.id === 'physical_automation') && failedContained && effectiveVal(sel, 'intent') === 'international' && effectiveVal(sel, 'failure_mode')) return true;
    for (const [k, allowed] of Object.entries(dim.visibleWhen)) {
        const useRaw = (dim.id === 'stall_recovery' && k === 'capability')
            || (dim.id === 'automation_recovery' && k === 'automation')
            || (dim.id === 'sovereignty' && k === 'geo_spread')
            || (dim.id === 'gov_action' && k === 'geo_spread')
            || (dim.id === 'alignment_durability' && k === 'alignment')
            || (dim.id === 'alignment_tax' && k === 'alignment')
            || (dim.id === 'intent' && k === 'alignment')
            || (dim.id === 'block_entrants' && k === 'alignment');
        const v = useRaw ? sel[k] : effectiveVal(sel, k);
        if (!v || !allowed.includes(v)) return false;
    }
    return true;
}

function isDimLocked(sel, dim) {
    if (dim.id === 'alignment') {
        const out = decelOutcome(sel);
        if (['solved', 'parity_solved'].includes(out)) return 'robust';
        if (['escapes', 'abandon', 'rival', 'parity_failed'].includes(out)) {
            return sel.ai_goals === 'marginal' ? 'partial' : 'failed';
        }
    }
    if (dim.id === 'containment') {
        const out = decelOutcome(sel);
        if (['escapes', 'parity_failed'].includes(out)) return 'escaped';
        if ((sel.proliferation_control === 'none' || sel.proliferation_outcome === 'breached') && effectiveVal(sel, 'alignment') === 'failed') return 'escaped';
        if (sel.enabled_aims === 'arbitrary' && sel.ai_goals !== 'marginal') return 'escaped';
    }
    if (dim.id === 'failure_mode' && sel.enabled_aims === 'proxy') return 'whimper';
    if (!dim.lockedWhen) return null;
    for (const [triggerDim, rule] of Object.entries(dim.lockedWhen)) {
        if (effectiveVal(sel, triggerDim) === rule.equals) return rule.value;
    }
    return null;
}

function isValueDisabled(sel, dim, val) {
    if (dim.id === 'enabled_aims' && val.id === 'arbitrary') {
        const out = decelOutcome(sel);
        if (['solved', 'parity_solved'].includes(out)) return true;
    }
    if (!val.requires) return false;
    const condSets = Array.isArray(val.requires) ? val.requires : [val.requires];
    return condSets.every(conds => {
        for (const [k, allowed] of Object.entries(conds)) {
            const v = effectiveVal(sel, k);
            if (v && !allowed.includes(v)) return true;
        }
        return false;
    });
}

function cleanSelection(sel) {
    for (const dim of DIM_META) {
        if (!isDimVisible(sel, dim)) { delete sel[dim.id]; continue; }
        const locked = isDimLocked(sel, dim);
        if (locked !== null) { sel[dim.id] = locked; continue; }
        if (sel[dim.id]) {
            const val = dim.values.find(v => v.id === sel[dim.id]);
            if (val && isValueDisabled(sel, dim, val)) delete sel[dim.id];
        }
    }
    return sel;
}

function effectiveDims(sel) {
    const d = {};
    for (const dim of DIM_META) {
        if (!isDimVisible(sel, dim)) continue;
        const locked = isDimLocked(sel, dim);
        if (locked !== null) { d[dim.id] = locked; continue; }
        const v = effectiveVal(sel, dim.id);
        if (v) d[dim.id] = v;
    }
    const out = decelOutcome(sel);
    if (sel.gov_action === 'accelerate') d.governance = 'race';
    else if (out === 'abandon') d.governance = 'race';
    else if (sel.gov_action === 'decelerate') d.governance = 'slowdown';
    else if (sel.governance_window) d.governance = sel.governance_window;
    if (['solved', 'parity_solved'].includes(out)) d.alignment = 'robust';
    if (['escapes', 'abandon', 'rival', 'parity_failed'].includes(out) && d.ai_goals !== 'marginal') d.alignment = 'failed';
    if (d.enabled_aims === 'arbitrary' && d.ai_goals !== 'marginal') d.alignment = 'failed';
    if (['escapes', 'parity_failed'].includes(out)) d.containment = 'escaped';
    if ((d.proliferation_control === 'none' || d.proliferation_outcome === 'breached') && d.alignment === 'failed') d.containment = 'escaped';
    if (d.enabled_aims === 'arbitrary' && d.ai_goals !== 'marginal') d.containment = 'escaped';
    if (d.enabled_aims === 'proxy') d.failure_mode = 'whimper';
    if (d.rival_dynamics) d.intent = d.rival_dynamics;
    if (['parity_solved', 'parity_failed', 'rival'].includes(out)) {
        d.geo_spread = 'two';
        d.rival_emerges = 'yes';
    }
    if (d.proliferation_outcome === 'breached') d.geo_spread = 'two';
    return d;
}

function templateMatches(t, dims) {
    if (!t.reachable) return true;
    return t.reachable.some(cond => {
        for (const [k, allowed] of Object.entries(cond)) {
            if (!dims[k] || !allowed.includes(dims[k])) return false;
        }
        return true;
    });
}

function templatePartialMatch(t, dims) {
    if (!t.reachable) return true;
    return t.reachable.some(cond => {
        for (const [k, allowed] of Object.entries(cond)) {
            if (dims[k] && !allowed.includes(dims[k])) return false;
        }
        return true;
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DIM_META, DIM_MAP, decelOutcome, effectiveVal, isDimVisible, isDimLocked, isValueDisabled, cleanSelection, effectiveDims, templateMatches, templatePartialMatch };
}
