// Shared logic module for Singularity Map explorer
// Used by both index.html (browser) and test-explorer.js (Node.js)

const DIM_META = [
    { id: 'capability', label: 'AI Scaling', stage: 1,
      overrides: [
        { when: { stall_recovery: 'mild' }, value: 'singularity' },
      ],
      values: [
        { id: 'singularity', label: 'Trend continues' }, { id: 'hours', label: 'Stalls: hours' },
        { id: 'days', label: 'Stalls: days' }, { id: 'weeks', label: 'Stalls: weeks' },
        { id: 'months', label: 'Stalls: months' } ] },
    { id: 'stall_recovery', label: 'Recovery?', stage: 1,
      visibleWhen: { capability: ['hours', 'days', 'weeks', 'months'] },
      useRawFor: ['capability'],
      values: [
        { id: 'mild', label: 'Months/years' }, { id: 'substantial', label: 'Years/decades' }, { id: 'never', label: 'Never' } ] },
    { id: 'automation', label: 'Knowledge Work', stage: 1,
      visibleWhen: { capability: ['singularity'] },
      overrides: [
        { when: { automation_recovery: 'mild' }, value: 'deep' },
      ],
      values: [
        { id: 'deep', label: 'Automates broadly' }, { id: 'shallow', label: 'Routine only' } ] },
    { id: 'automation_recovery', label: 'Deep Automation Recovery?', stage: 1,
      visibleWhen: { capability: ['singularity'], automation: ['shallow'] },
      useRawFor: ['automation'],
      values: [
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
      lockedWhen: { takeoff: { equals: 'hard', value: 'one' }, distribution: { equals: 'monopoly', value: 'one' } },
      overrides: [
        { decel: ['rival', 'parity_solved', 'parity_failed'], value: 'two' },
        { when: { proliferation_outcome: 'breached' }, value: 'two' },
      ],
      values: [
        { id: 'one', label: 'One country' }, { id: 'two', label: 'Two powers' },
        { id: 'several', label: 'Several' } ] },
    { id: 'sovereignty', label: 'Power Holder', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], distribution: ['monopoly', 'concentrated', 'lagging'], geo_spread: ['one'] },
      useRawFor: ['geo_spread'],
      values: [
        { id: 'lab', label: 'The labs' }, { id: 'state', label: 'The state' } ] },
    { id: 'alignment', label: 'Alignment', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'] },
      overrides: [
        { decel: ['solved', 'parity_solved'], value: 'robust' },
        { when: { brittle_resolution: 'solved' }, value: 'robust' },
        { when: { brittle_resolution: 'sufficient' }, valueMap: { failed: 'brittle' } },
        { when: { inert_stays: 'no' }, value: 'failed' },
        { when: { ai_goals: 'marginal' }, unless: { brittle_resolution: 'solved' }, valueMap: { failed: 'brittle' } },
        { when: { alignment_durability: 'breaks' }, value: 'failed' },
        { when: { brittle_resolution: 'escape' }, value: 'failed' },
        { when: { enabled_aims: 'arbitrary' }, value: 'failed' },
        { decel: ['rival'], value: 'brittle' },
        { decel: ['escapes', 'abandon', 'parity_failed'], value: 'failed' },
      ],
      values: [
        { id: 'robust', label: 'Robust' }, { id: 'brittle', label: 'Brittle / Partial' },
        { id: 'failed', label: 'Unsolved' } ] },
    { id: 'gov_action', label: 'Deceleration', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], geo_spread: ['one'] },
      useRawFor: ['geo_spread'],
      lockedWhen: { takeoff: { equals: 'hard', value: 'accelerate' } }, values: [
        { id: 'decelerate', label: 'Decelerate' }, { id: 'accelerate', label: 'Accelerate' } ] },
    { id: 'decel_2mo_progress', label: '2 Months', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], gov_action: ['decelerate'] }, values: [
        { id: 'robust', label: 'Solved — robust' }, { id: 'brittle', label: 'Solved — brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet' } ] },
    { id: 'decel_2mo_action', label: '2mo Decision', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], decel_2mo_progress: ['robust', 'brittle', 'unsolved'] }, values: [
        { id: 'escapes', label: 'AI Escapes', requires: { decel_2mo_progress: ['brittle', 'unsolved'] } },
        { id: 'accelerate', label: 'Accelerate' },
        { id: 'continue', label: 'Continue', requires: { decel_2mo_progress: ['brittle', 'unsolved'] } } ] },
    { id: 'decel_4mo_progress', label: '4 Months', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], decel_2mo_action: ['continue'] }, values: [
        { id: 'robust', label: 'Solved — robust' }, { id: 'brittle', label: 'Solved — brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet' } ] },
    { id: 'decel_4mo_action', label: '4mo Decision', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], decel_4mo_progress: ['robust', 'brittle', 'unsolved'] }, values: [
        { id: 'escapes', label: 'AI Escapes', requires: { decel_4mo_progress: ['brittle', 'unsolved'] } },
        { id: 'accelerate', label: 'Accelerate' },
        { id: 'continue', label: 'Continue', requires: { decel_4mo_progress: ['brittle', 'unsolved'] } } ] },
    { id: 'decel_6mo_progress', label: '6 Months', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], decel_4mo_action: ['continue'] }, values: [
        { id: 'robust', label: 'Solved — robust' }, { id: 'brittle', label: 'Solved — brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet' } ] },
    { id: 'decel_6mo_action', label: '6mo Decision', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], decel_6mo_progress: ['robust', 'brittle', 'unsolved'] }, values: [
        { id: 'escapes', label: 'AI Escapes', requires: { decel_6mo_progress: ['brittle', 'unsolved'], open_source: ['twelve_months', 'twenty_four_months'] } },
        { id: 'rival', label: 'Rival reaches parity', requires: { open_source: ['six_months'] } },
        { id: 'accelerate', label: 'Accelerate', requires: { open_source: ['twelve_months', 'twenty_four_months'] } },
        { id: 'continue', label: 'Continue', requires: { decel_6mo_progress: ['brittle', 'unsolved'], open_source: ['twelve_months', 'twenty_four_months'] } } ] },
    { id: 'decel_9mo_progress', label: '9 Months', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], decel_6mo_action: ['continue'] }, values: [
        { id: 'robust', label: 'Solved — robust' }, { id: 'brittle', label: 'Solved — brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet' } ] },
    { id: 'decel_9mo_action', label: '9mo Decision', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], decel_9mo_progress: ['robust', 'brittle', 'unsolved'] }, values: [
        { id: 'escapes', label: 'AI Escapes', requires: { decel_9mo_progress: ['brittle', 'unsolved'] } },
        { id: 'accelerate', label: 'Accelerate' },
        { id: 'continue', label: 'Continue', requires: { decel_9mo_progress: ['brittle', 'unsolved'] } } ] },
    { id: 'decel_12mo_progress', label: '12 Months', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], decel_9mo_action: ['continue'] }, values: [
        { id: 'robust', label: 'Solved — robust' }, { id: 'brittle', label: 'Solved — brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet' } ] },
    { id: 'decel_12mo_action', label: '12mo Decision', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], decel_12mo_progress: ['robust', 'brittle', 'unsolved'] }, values: [
        { id: 'escapes', label: 'AI Escapes', requires: { decel_12mo_progress: ['brittle', 'unsolved'], open_source: ['twenty_four_months'] } },
        { id: 'rival', label: 'Rival reaches parity', requires: { open_source: ['twelve_months'] } },
        { id: 'accelerate', label: 'Accelerate', requires: { open_source: ['twenty_four_months'] } },
        { id: 'continue', label: 'Continue', requires: { decel_12mo_progress: ['brittle', 'unsolved'], open_source: ['twenty_four_months'] } } ] },
    { id: 'decel_18mo_progress', label: '18 Months', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], decel_12mo_action: ['continue'] }, values: [
        { id: 'robust', label: 'Solved — robust' }, { id: 'brittle', label: 'Solved — brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet' } ] },
    { id: 'decel_18mo_action', label: '18mo Decision', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], decel_18mo_progress: ['robust', 'brittle', 'unsolved'] }, values: [
        { id: 'escapes', label: 'AI Escapes', requires: { decel_18mo_progress: ['brittle', 'unsolved'] } },
        { id: 'accelerate', label: 'Accelerate' },
        { id: 'continue', label: 'Continue', requires: { decel_18mo_progress: ['brittle', 'unsolved'] } } ] },
    { id: 'decel_24mo_progress', label: '24 Months', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], decel_18mo_action: ['continue'] }, values: [
        { id: 'robust', label: 'Solved — robust' }, { id: 'brittle', label: 'Solved — brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet' } ] },
    { id: 'decel_24mo_action', label: '24mo Decision', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], decel_24mo_progress: ['robust', 'brittle', 'unsolved'] }, values: [
        { id: 'rival', label: 'Rival reaches parity' } ] },
    { id: 'alignment_durability', label: 'Alignment Durability', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], alignment: ['brittle'] },
      useRawFor: ['alignment'], useRawUnlessDecel: true,
      values: [
        { id: 'holds', label: 'Holds for now' }, { id: 'breaks', label: 'Breaks' } ] },
    { id: 'containment', label: 'Containment', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], alignment: ['failed'] },
      overrides: [
        { decel: ['escapes'], value: 'escaped' },
        { when: { proliferation_control: 'none' }, effective: { alignment: 'failed' }, value: 'escaped' },
        { when: { proliferation_outcome: 'breached' }, effective: { alignment: 'failed' }, value: 'escaped' },
        { when: { enabled_aims: 'arbitrary' }, unless: { ai_goals: 'marginal' }, value: 'escaped' },
        { when: { brittle_resolution: 'escape' }, value: 'escaped' },
        { when: { inert_stays: 'no' }, value: 'escaped' },
      ],
      values: [
        { id: 'contained', label: 'Contained', requires: { distribution: ['lagging', 'concentrated', 'monopoly'] } },
        { id: 'escaped', label: 'Escapes' } ] },
    { id: 'ai_goals', label: 'AI Converges On', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], alignment: ['failed'], containment: ['escaped'] },
      overrides: [
        { whenSet: 'inert_outcome', fromDim: 'inert_outcome' },
      ], values: [
        { id: 'benevolent', label: 'Benefit humanity' }, { id: 'alien_coexistence', label: 'Alien (tolerant)' },
        { id: 'alien_extinction', label: 'Alien (total)' }, { id: 'paperclip', label: 'Arbitrary' },
        { id: 'swarm', label: 'Divergent' }, { id: 'marginal', label: 'Inert (for now)' } ] },
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
    { id: 'block_entrants', label: 'Block New Entrants?', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle'], proliferation_control: ['secure_access'], proliferation_outcome: ['holds'] },
      useRawFor: ['alignment'], useRawUnlessDecel: true,
      values: [
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
        { id: 'arbitrary', label: 'Arbitrary / unconstrained' } ] },
    { id: 'intent', label: 'Intent', stage: 2,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle'] },
      useRawFor: ['alignment'], useRawUnlessDecel: true,
      overrides: [
        { whenSet: 'rival_dynamics', fromDim: 'rival_dynamics' },
      ],
      values: [
        { id: 'self_interest', label: 'Self-interest', requires: [{ distribution: ['monopoly'], geo_spread: ['one'], proliferation_control: ['deny_rivals', 'secure_access'] }, { distribution: ['concentrated', 'lagging'], geo_spread: ['one'], sovereignty: ['state'], proliferation_control: ['deny_rivals', 'secure_access'] }] },
        { id: 'coexistence', label: 'Coexistence', requires: [{ distribution: ['open'], open_source: ['near_parity', 'twelve_months', 'twenty_four_months'] }, { distribution: ['lagging', 'concentrated'], open_source: ['near_parity', 'twelve_months', 'twenty_four_months'], geo_spread: ['two', 'several'] }, { geo_spread: ['two'] }, { proliferation_control: ['none'] }, { proliferation_outcome: ['breached'] }] },
        { id: 'rivalry', label: 'Rivalry', requires: [{ distribution: ['open'], open_source: ['near_parity', 'twelve_months', 'twenty_four_months'] }, { distribution: ['lagging', 'concentrated'], open_source: ['near_parity', 'twelve_months', 'twenty_four_months'], geo_spread: ['two', 'several'] }, { geo_spread: ['two'] }, { proliferation_control: ['none'] }, { proliferation_outcome: ['breached'] }] },
        { id: 'escalation', label: 'Escalation', requires: [{ distribution: ['open'], open_source: ['near_parity', 'twelve_months', 'twenty_four_months'] }, { distribution: ['lagging', 'concentrated'], open_source: ['near_parity', 'twelve_months', 'twenty_four_months'], geo_spread: ['two', 'several'] }, { geo_spread: ['two'] }, { proliferation_control: ['none'] }, { proliferation_outcome: ['breached'] }] },
        { id: 'international', label: 'International' } ] },
    { id: 'failure_mode', label: 'Implementation', stage: 3,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle'] },
      overrides: [
        { when: { enabled_aims: 'proxy' }, value: 'whimper' },
      ],
      values: [
        { id: 'none', label: 'Succeeds' }, { id: 'whimper', label: 'Wrong metrics' },
        { id: 'disempowerment', label: 'Human irrelevance' } ] },
    { id: 'knowledge_replacement', label: 'Knowledge Work', stage: 3,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle'], intent: ['international'], failure_mode: ['none', 'whimper', 'disempowerment'] }, values: [
        { id: 'rapid', label: 'Rapid (1–2 yrs)' }, { id: 'gradual', label: 'Gradual (3–10 yrs)' }, { id: 'uneven', label: 'Uneven (1–20 yrs)' },
        { id: 'limited', label: 'Limited', requires: { capability: ['hours', 'days', 'weeks', 'months'] } } ] },
    { id: 'physical_automation', label: 'Physical Automation', stage: 3,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle'], intent: ['international'], failure_mode: ['none', 'whimper', 'disempowerment'] }, values: [
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
        { id: 'rapid', label: 'Rapid (3–7 yrs)' }, { id: 'gradual', label: 'Gradual (10–25 yrs)' }, { id: 'uneven', label: 'Uneven (3–20+ yrs)' }, { id: 'limited', label: 'Limited' } ] },
    { id: 'brittle_resolution', label: 'Long-Term Alignment Fate', stage: 3,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], alignment: ['brittle'], alignment_durability: ['holds'] },
      useRawFor: ['alignment'], useRawUnlessDecel: true,
      values: [
        { id: 'solved', label: 'Alignment fully solved' },
        { id: 'sufficient', label: 'Brittle alignment holds' },
        { id: 'escape', label: 'AI eventually escapes' } ] },
    { id: 'inert_stays', label: 'Does Escaped AI Stay Inert?', stage: 3,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], ai_goals: ['marginal'] },
      useRawFor: ['ai_goals'],
      values: [
        { id: 'yes', label: 'Yes — remains inert' },
        { id: 'no', label: 'No — eventually develops goals' } ] },
    { id: 'inert_outcome', label: 'AI Eventually Converges On', stage: 3,
      visibleWhen: { capability: ['singularity'], automation: ['deep'], inert_stays: ['no'] },
      values: [
        { id: 'benevolent', label: 'Benefit humanity' }, { id: 'alien_coexistence', label: 'Alien (tolerant)' },
        { id: 'alien_extinction', label: 'Alien (total)' }, { id: 'paperclip', label: 'Arbitrary' },
        { id: 'swarm', label: 'Divergent' } ] }
];

const DIM_MAP = {};
for (const d of DIM_META) DIM_MAP[d.id] = d;

const DECEL_PAIRS = [
    ['decel_2mo_progress', 'decel_2mo_action'],
    ['decel_4mo_progress', 'decel_4mo_action'],
    ['decel_6mo_progress', 'decel_6mo_action'],
    ['decel_9mo_progress', 'decel_9mo_action'],
    ['decel_12mo_progress', 'decel_12mo_action'],
    ['decel_18mo_progress', 'decel_18mo_action'],
    ['decel_24mo_progress', 'decel_24mo_action'],
];

function decelOutcome(sel) {
    if (sel.gov_action !== 'decelerate') return null;
    for (const [pKey, aKey] of DECEL_PAIRS) {
        const progress = sel[pKey], action = sel[aKey];
        if (!progress || !action) return null;
        if (action === 'continue') continue;
        if (action === 'accelerate') return progress === 'robust' ? 'solved' : 'abandon';
        if (action === 'rival') {
            if (progress === 'robust') return 'parity_solved';
            if (progress === 'unsolved') return 'parity_failed';
            return 'rival';
        }
        if (action === 'escapes') return 'escapes';
    }
    return null;
}

function decelAlignProgress(sel) {
    if (sel.gov_action !== 'decelerate') return null;
    for (const [pKey, aKey] of DECEL_PAIRS) {
        const progress = sel[pKey], action = sel[aKey];
        if (!progress || !action) return null;
        if (action === 'continue') continue;
        return progress;
    }
    return null;
}

function matchesOverride(rule, sel, decel) {
    if (rule.decel && !rule.decel.includes(decel)) return false;
    if (rule.when) {
        for (const [key, val] of Object.entries(rule.when)) {
            if (sel[key] !== val) return false;
        }
    }
    if (rule.whenSet && !sel[rule.whenSet]) return false;
    if (rule.effective) {
        for (const [key, val] of Object.entries(rule.effective)) {
            if (effectiveVal(sel, key) !== val) return false;
        }
    }
    if (rule.unless) {
        for (const [key, val] of Object.entries(rule.unless)) {
            if (sel[key] === val) return false;
        }
    }
    return true;
}

function applyOverrides(overrides, sel, k, decel) {
    for (const rule of overrides) {
        if (!matchesOverride(rule, sel, decel)) continue;
        if (rule.fromDim) return sel[rule.fromDim];
        if (rule.valueMap) return rule.valueMap[sel[k]] ?? sel[k];
        return rule.value;
    }
    return undefined;
}

function effectiveVal(sel, k) {
    if (k === 'governance') {
        const out = decelOutcome(sel);
        if (sel.gov_action === 'accelerate') return 'race';
        if (out === 'abandon') return 'race';
        if (sel.gov_action === 'decelerate') return 'slowdown';
        if (sel.governance_window) return sel.governance_window;
        return sel[k];
    }
    const dim = DIM_MAP[k];
    if (dim && dim.overrides) {
        const result = applyOverrides(dim.overrides, sel, k, decelOutcome(sel));
        if (result !== undefined) return result;
    }
    return sel[k];
}

function isDimVisible(sel, dim) {
    if (!dim.visibleWhen) return true;
    const escapedNonMarginal = sel.ai_goals && sel.ai_goals !== 'marginal' && effectiveVal(sel, 'alignment') === 'failed';
    if (escapedNonMarginal) {
        const hiddenAfterEscape = ['proliferation_control', 'proliferation_outcome', 'block_entrants', 'block_outcome',
            'new_entrants', 'rival_dynamics', 'enabled_aims', 'intent', 'failure_mode', 'knowledge_replacement',
            'physical_automation', 'brittle_resolution'];
        if (hiddenAfterEscape.includes(dim.id) && !sel[dim.id]) return false;
    }
    if (dim.id === 'brittle_resolution' && sel.brittle_resolution) return true;
    if (dim.id === 'containment' && sel.containment) return true;
    if (dim.id === 'ai_goals' && sel.ai_goals) return true;
    if (dim.id === 'intent' && sel.intent) return true;
    if (dim.id === 'enabled_aims' && sel.enabled_aims) return true;
    if (dim.id === 'failure_mode' && sel.failure_mode) return true;
    if (dim.id === 'knowledge_replacement' && sel.knowledge_replacement) return true;
    if (dim.id === 'physical_automation' && sel.physical_automation) return true;
    if (dim.id === 'proliferation_control' && sel.proliferation_control) return true;
    if (dim.id === 'block_entrants' && sel.block_entrants) return true;
    if (dim.id === 'new_entrants' && sel.new_entrants) return true;
    if (dim.id === 'rival_dynamics' && sel.rival_dynamics) return true;
    if (dim.id === 'inert_stays' && sel.inert_stays) return true;
    if (dim.id === 'inert_outcome' && sel.inert_outcome) return true;
    if (dim.id === 'gov_action' && sel.gov_action) return true;
    if (dim.id.startsWith('decel_') && sel[dim.id]) return true;
    if (dim.id === 'alignment_durability') {
        if (sel.alignment_durability) return true;
        const out = decelOutcome(sel);
        if (out && !(out === 'rival' && decelAlignProgress(sel) === 'brittle')) return false;
    }
    const out = decelOutcome(sel);
    if (dim.id === 'proliferation_control') {
        if (['escapes', 'parity_failed'].includes(out)) return false;
    }
    if (dim.id === 'containment') {
        if (sel.alignment === 'brittle' && sel.alignment_durability === 'holds' && sel.brittle_resolution
            && (sel.brittle_resolution === 'escape' || sel.containment))
            return effectiveVal(sel, 'capability') === 'singularity' && effectiveVal(sel, 'automation') === 'deep';
        if (['solved', 'parity_solved'].includes(out)) return false;
        const alignFailed = effectiveVal(sel, 'alignment') === 'failed';
        const marginalEscape = sel.ai_goals === 'marginal';
        if (!alignFailed && !marginalEscape) return false;
        return effectiveVal(sel, 'capability') === 'singularity' && effectiveVal(sel, 'automation') === 'deep';
    }
    if (dim.id === 'ai_goals' && sel.ai_goals === 'marginal' && sel.containment === 'escaped') {
        return effectiveVal(sel, 'capability') === 'singularity' && effectiveVal(sel, 'automation') === 'deep';
    }
    if (dim.id === 'rival_dynamics') {
        if (sel.block_outcome !== 'fails' && sel.new_entrants !== 'emerge') return false;
    }
    if (dim.id === 'brittle_resolution') {
        if (sel.enabled_aims === 'arbitrary') return false;
        if (!sel.brittle_resolution) {
            const TERM = new Set(['knowledge_replacement','physical_automation','economic_distribution','plateau_knowledge_rate','plateau_physical_rate','automation_distribution','auto_knowledge_rate','auto_physical_rate']);
            const brIdx = DIM_META.indexOf(dim);
            const adIdx = DIM_META.findIndex(d => d.id === 'alignment_durability');
            for (let i = adIdx + 1; i < brIdx; i++) {
                const mid = DIM_META[i];
                if (TERM.has(mid.id)) continue;
                if (!isDimVisible(sel, mid)) continue;
                if (isDimLocked(sel, mid) !== null) continue;
                if (!sel[mid.id]) return false;
            }
        }
    }
    if (dim.id === 'ai_goals' && sel.alignment === 'brittle' && sel.alignment_durability === 'holds' && sel.brittle_resolution
        && (sel.brittle_resolution === 'escape' || sel.containment)) {
        return effectiveVal(sel, 'capability') === 'singularity' && effectiveVal(sel, 'automation') === 'deep';
    }
    if (sel.brittle_resolution === 'escape' && dim.id === 'failure_mode') {
        if (sel.enabled_aims === 'proxy' || effectiveVal(sel, 'intent') === 'international')
            return effectiveVal(sel, 'capability') === 'singularity' && effectiveVal(sel, 'automation') === 'deep';
    }
    if (sel.brittle_resolution === 'escape' && (dim.id === 'knowledge_replacement' || dim.id === 'physical_automation')) {
        if (effectiveVal(sel, 'intent') === 'international' && effectiveVal(sel, 'failure_mode'))
            return effectiveVal(sel, 'capability') === 'singularity' && effectiveVal(sel, 'automation') === 'deep';
    }
    if (dim.id === 'failure_mode' && sel.enabled_aims !== 'proxy' && effectiveVal(sel, 'intent') !== 'international') return false;
    const failedContained = effectiveVal(sel, 'alignment') === 'failed' && sel.containment === 'contained';
    if (dim.id === 'intent' && sel.alignment === 'failed' && sel.containment === 'contained') return true;
    if (dim.id === 'intent' && sel.ai_goals === 'marginal') {
        return effectiveVal(sel, 'capability') === 'singularity' && effectiveVal(sel, 'automation') === 'deep';
    }
    if (dim.id === 'failure_mode' && failedContained && effectiveVal(sel, 'intent') === 'international') return true;
    if ((dim.id === 'knowledge_replacement' || dim.id === 'physical_automation') && failedContained && effectiveVal(sel, 'intent') === 'international' && effectiveVal(sel, 'failure_mode')) return true;
    for (const [k, allowed] of Object.entries(dim.visibleWhen)) {
        const useRaw = dim.useRawFor && dim.useRawFor.includes(k)
            && (!dim.useRawUnlessDecel || !out);
        const v = useRaw ? sel[k] : effectiveVal(sel, k);
        if (!v || !allowed.includes(v)) return false;
    }
    return true;
}

function isDimLocked(sel, dim) {
    if (dim.id === 'gov_action' && sel.alignment === 'robust' && sel.gov_action !== 'decelerate' && !decelOutcome(sel)) return 'accelerate';
    if (dim.id === 'gov_action' && sel.alignment_durability === 'breaks') return 'accelerate';
    if (dim.id === 'alignment') {
        const out = decelOutcome(sel);
        if (['solved', 'parity_solved'].includes(out)) return 'robust';
        if (sel.brittle_resolution === 'solved') return 'robust';
        if (sel.brittle_resolution === 'sufficient') return 'brittle';
        if (out === 'rival') return 'brittle';
        if (['escapes', 'abandon', 'parity_failed'].includes(out)) {
            return sel.ai_goals === 'marginal' ? 'brittle' : 'failed';
        }
    }
    if (dim.id === 'containment') {
        if (sel.brittle_resolution === 'escape') return 'escaped';
        if (sel.brittle_resolution === 'solved' || sel.brittle_resolution === 'sufficient') return 'contained';
        const out = decelOutcome(sel);
        if (out === 'escapes') return 'escaped';
        if ((sel.proliferation_control === 'none' || sel.proliferation_outcome === 'breached') && effectiveVal(sel, 'alignment') === 'failed') return 'escaped';
        if (sel.enabled_aims === 'arbitrary' && sel.ai_goals !== 'marginal') return 'escaped';
        if (effectiveVal(sel, 'alignment') === 'robust') return 'contained';
    }
    if (dim.id === 'ai_goals' && sel.alignment === 'brittle' && sel.alignment_durability === 'holds') {
        if (sel.brittle_resolution === 'solved' || sel.brittle_resolution === 'sufficient') return 'benevolent';
    }
    if (dim.id === 'failure_mode' && sel.enabled_aims === 'proxy') return 'whimper';
    if (!dim.lockedWhen) {
        const enabled = dim.values.filter(v => !isValueDisabled(sel, dim, v));
        return enabled.length === 1 ? enabled[0].id : null;
    }
    for (const [triggerDim, rule] of Object.entries(dim.lockedWhen)) {
        if (effectiveVal(sel, triggerDim) === rule.equals) return rule.value;
    }
    const enabled = dim.values.filter(v => !isValueDisabled(sel, dim, v));
    return enabled.length === 1 ? enabled[0].id : null;
}

function isValueDisabled(sel, dim, val) {
    if (dim.id === 'enabled_aims' && val.id === 'arbitrary') {
        const out = decelOutcome(sel);
        if (['solved', 'parity_solved'].includes(out)) return true;
    }
    if (dim.id === 'enabled_aims' && val.id === 'human_centered' && effectiveVal(sel, 'intent') === 'self_interest') return true;
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
    for (let pass = 0; pass < 5; pass++) {
        let changed = false;
        for (const dim of DIM_META) {
            if (!isDimVisible(sel, dim)) {
                if (sel[dim.id] !== undefined) { delete sel[dim.id]; changed = true; }
                continue;
            }
            const locked = isDimLocked(sel, dim);
            if (locked !== null) {
                if (sel[dim.id] !== locked) { sel[dim.id] = locked; changed = true; }
                continue;
            }
            if (sel[dim.id]) {
                const val = dim.values.find(v => v.id === sel[dim.id]);
                if (val && isValueDisabled(sel, dim, val)) { delete sel[dim.id]; changed = true; }
            }
        }
        if (!changed) break;
    }
    return sel;
}

function effectiveDims(sel) {
    const d = {};
    for (const dim of DIM_META) {
        if (!isDimVisible(sel, dim)) continue;
        const ev = effectiveVal(sel, dim.id);
        if (ev) { d[dim.id] = ev; continue; }
        const locked = isDimLocked(sel, dim);
        if (locked !== null) d[dim.id] = locked;
    }
    // Virtual governance dimension (not in DIM_META)
    d.governance = effectiveVal(sel, 'governance');
    // Pending rival_dynamics: suppress intent until the rival path is resolved
    if (!d.rival_dynamics) {
        const pending = ['rival_dynamics', 'block_entrants', 'block_outcome', 'new_entrants'].some(id => {
            const dim = DIM_MAP[id];
            return dim && isDimVisible(sel, dim) && isDimLocked(sel, dim) === null && !sel[id];
        });
        if (pending) delete d.intent;
    }
    // Pending inert_stays: suppress intent until resolved
    if (sel.ai_goals === 'marginal' && !sel.inert_stays) {
        const isDim = DIM_MAP['inert_stays'];
        if (isDim && isDimVisible(sel, isDim) && isDimLocked(sel, isDim) === null) {
            delete d.intent;
        }
    }
    // Pending brittle_resolution: suppress alignment until resolved
    const brDim = DIM_MAP['brittle_resolution'];
    if (brDim && isDimVisible(sel, brDim) && isDimLocked(sel, brDim) === null && !sel.brittle_resolution) {
        delete d.alignment;
    }
    // Virtual rival_emerges for outcome matching
    const out = decelOutcome(sel);
    if (['parity_solved', 'parity_failed', 'rival'].includes(out)) {
        d.rival_emerges = 'yes';
    }
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
    module.exports = { DIM_META, DIM_MAP, DECEL_PAIRS, decelOutcome, decelAlignProgress, matchesOverride, applyOverrides, effectiveVal, isDimVisible, isDimLocked, isValueDisabled, cleanSelection, effectiveDims, templateMatches, templatePartialMatch };
}
if (typeof window !== 'undefined') {
    window.Logic = { DIM_META, DIM_MAP, DECEL_PAIRS, decelOutcome, decelAlignProgress, matchesOverride, applyOverrides, effectiveVal, isDimVisible, isDimLocked, isValueDisabled, cleanSelection, effectiveDims, templateMatches, templatePartialMatch };
}
