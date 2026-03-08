// Shared logic module for Singularity Map explorer
// Used by both index.html (browser) and validate.js (Node.js)
// Architecture: declarative activateWhen/suppressWhen arrays on each dimension,
// generic isDimVisible function, declarative override engine.

// ════════════════════════════════════════════════════════
// DIM_META — dimension definitions with activateWhen activation paths
// ════════════════════════════════════════════════════════

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
      activateWhen: [{ capability: ['hours', 'days', 'weeks', 'months'] }],
      useRawFor: ['capability'],
      values: [
        { id: 'mild', label: 'Months/years' }, { id: 'substantial', label: 'Years/decades' }, { id: 'never', label: 'Never' } ] },
    { id: 'automation', label: 'Knowledge Work', stage: 1,
      activateWhen: [{ capability: ['singularity'] }],
      overrides: [
        { when: { automation_recovery: 'mild' }, value: 'deep' },
      ],
      values: [
        { id: 'deep', label: 'Automates broadly' }, { id: 'shallow', label: 'Routine only' } ] },
    { id: 'automation_recovery', label: 'Deep Automation Recovery?', stage: 1,
      activateWhen: [{ capability: ['singularity'], automation: ['shallow'] }],
      useRawFor: ['automation'],
      values: [
        { id: 'mild', label: 'Months/years' }, { id: 'substantial', label: 'Years/decades' }, { id: 'never', label: 'Never' } ] },
    { id: 'takeoff', label: 'Feedback Loop', stage: 1,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'] }],
      values: [
        { id: 'gradual', label: 'Gradual' }, { id: 'fast', label: 'Fast' }, { id: 'hard', label: 'Explosive' } ] },
    { id: 'governance_window', label: 'Governance Window', stage: 1,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], takeoff: ['gradual'] }],
      values: [
        { id: 'governed', label: 'Active preparation' }, { id: 'race', label: 'Relative complacency' } ] },
    { id: 'open_source', label: 'Open Source', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'] }],
      lockedWhen: { takeoff: { equals: 'hard', value: 'twenty_four_months' } }, values: [
        { id: 'near_parity', label: 'Near-parity' }, { id: 'six_months', label: '~6 months' },
        { id: 'twelve_months', label: '~12 months' }, { id: 'twenty_four_months', label: '~24 months' } ] },
    { id: 'distribution', label: 'Frontier Labs', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'] }],
      lockedWhen: { takeoff: { equals: 'hard', value: 'monopoly' }, open_source: { equals: 'near_parity', value: 'open' } }, values: [
        { id: 'open', label: 'Distributed', requires: { open_source: ['near_parity'] } },
        { id: 'lagging', label: 'Many compete' },
        { id: 'concentrated', label: 'A few lead' }, { id: 'monopoly', label: 'One dominates' } ] },
    { id: 'geo_spread', label: 'Countries', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], open_source: ['six_months', 'twelve_months', 'twenty_four_months'] }],
      lockedWhen: { takeoff: { equals: 'hard', value: 'one' }, distribution: { equals: 'monopoly', value: 'one' } },
      overrides: [
        { decel: ['rival', 'parity_solved', 'parity_failed'], value: 'two' },
        { when: { proliferation_outcome: 'breached' }, value: 'two' },
      ],
      values: [
        { id: 'one', label: 'One country' }, { id: 'two', label: 'Two powers' },
        { id: 'several', label: 'Several' } ] },
    { id: 'sovereignty', label: 'Power Holder', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], distribution: ['monopoly', 'concentrated', 'lagging'], geo_spread: ['one'] }],
      useRawFor: ['geo_spread'],
      values: [
        { id: 'lab', label: 'The labs' }, { id: 'state', label: 'The state' } ] },
    { id: 'alignment', label: 'Alignment', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'] }],
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
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], geo_spread: ['one'] }],
      useRawFor: ['geo_spread'],
      overrides: [
        { when: { alignment_durability: 'breaks' }, value: 'accelerate' },
      ],
      lockedWhen: { takeoff: { equals: 'hard', value: 'accelerate' } }, values: [
        { id: 'decelerate', label: 'Decelerate' }, { id: 'accelerate', label: 'Accelerate' } ] },
    { id: 'decel_2mo_progress', label: '2 Months', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], gov_action: ['decelerate'] }], values: [
        { id: 'robust', label: 'Solved — robust' }, { id: 'brittle', label: 'Solved — brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet' } ] },
    { id: 'decel_2mo_action', label: '2mo Decision', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], decel_2mo_progress: ['robust', 'brittle', 'unsolved'] }], values: [
        { id: 'escapes', label: 'AI Escapes', requires: { decel_2mo_progress: ['brittle', 'unsolved'] } },
        { id: 'accelerate', label: 'Accelerate' },
        { id: 'continue', label: 'Continue', requires: { decel_2mo_progress: ['brittle', 'unsolved'] } } ] },
    { id: 'decel_4mo_progress', label: '4 Months', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], decel_2mo_action: ['continue'] }], values: [
        { id: 'robust', label: 'Solved — robust' }, { id: 'brittle', label: 'Solved — brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet' } ] },
    { id: 'decel_4mo_action', label: '4mo Decision', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], decel_4mo_progress: ['robust', 'brittle', 'unsolved'] }], values: [
        { id: 'escapes', label: 'AI Escapes', requires: { decel_4mo_progress: ['brittle', 'unsolved'] } },
        { id: 'accelerate', label: 'Accelerate' },
        { id: 'continue', label: 'Continue', requires: { decel_4mo_progress: ['brittle', 'unsolved'] } } ] },
    { id: 'decel_6mo_progress', label: '6 Months', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], decel_4mo_action: ['continue'] }], values: [
        { id: 'robust', label: 'Solved — robust' }, { id: 'brittle', label: 'Solved — brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet' } ] },
    { id: 'decel_6mo_action', label: '6mo Decision', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], decel_6mo_progress: ['robust', 'brittle', 'unsolved'] }], values: [
        { id: 'escapes', label: 'AI Escapes', requires: { decel_6mo_progress: ['brittle', 'unsolved'], open_source: ['twelve_months', 'twenty_four_months'] } },
        { id: 'rival', label: 'Rival reaches parity', requires: { open_source: ['six_months'] } },
        { id: 'accelerate', label: 'Accelerate', requires: { open_source: ['twelve_months', 'twenty_four_months'] } },
        { id: 'continue', label: 'Continue', requires: { decel_6mo_progress: ['brittle', 'unsolved'], open_source: ['twelve_months', 'twenty_four_months'] } } ] },
    { id: 'decel_9mo_progress', label: '9 Months', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], decel_6mo_action: ['continue'] }], values: [
        { id: 'robust', label: 'Solved — robust' }, { id: 'brittle', label: 'Solved — brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet' } ] },
    { id: 'decel_9mo_action', label: '9mo Decision', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], decel_9mo_progress: ['robust', 'brittle', 'unsolved'] }], values: [
        { id: 'escapes', label: 'AI Escapes', requires: { decel_9mo_progress: ['brittle', 'unsolved'] } },
        { id: 'accelerate', label: 'Accelerate' },
        { id: 'continue', label: 'Continue', requires: { decel_9mo_progress: ['brittle', 'unsolved'] } } ] },
    { id: 'decel_12mo_progress', label: '12 Months', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], decel_9mo_action: ['continue'] }], values: [
        { id: 'robust', label: 'Solved — robust' }, { id: 'brittle', label: 'Solved — brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet' } ] },
    { id: 'decel_12mo_action', label: '12mo Decision', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], decel_12mo_progress: ['robust', 'brittle', 'unsolved'] }], values: [
        { id: 'escapes', label: 'AI Escapes', requires: { decel_12mo_progress: ['brittle', 'unsolved'], open_source: ['twenty_four_months'] } },
        { id: 'rival', label: 'Rival reaches parity', requires: { open_source: ['twelve_months'] } },
        { id: 'accelerate', label: 'Accelerate', requires: { open_source: ['twenty_four_months'] } },
        { id: 'continue', label: 'Continue', requires: { decel_12mo_progress: ['brittle', 'unsolved'], open_source: ['twenty_four_months'] } } ] },
    { id: 'decel_18mo_progress', label: '18 Months', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], decel_12mo_action: ['continue'] }], values: [
        { id: 'robust', label: 'Solved — robust' }, { id: 'brittle', label: 'Solved — brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet' } ] },
    { id: 'decel_18mo_action', label: '18mo Decision', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], decel_18mo_progress: ['robust', 'brittle', 'unsolved'] }], values: [
        { id: 'escapes', label: 'AI Escapes', requires: { decel_18mo_progress: ['brittle', 'unsolved'] } },
        { id: 'accelerate', label: 'Accelerate' },
        { id: 'continue', label: 'Continue', requires: { decel_18mo_progress: ['brittle', 'unsolved'] } } ] },
    { id: 'decel_24mo_progress', label: '24 Months', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], decel_18mo_action: ['continue'] }], values: [
        { id: 'robust', label: 'Solved — robust' }, { id: 'brittle', label: 'Solved — brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet' } ] },
    { id: 'decel_24mo_action', label: '24mo Decision', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], decel_24mo_progress: ['robust', 'brittle', 'unsolved'] }], values: [
        { id: 'rival', label: 'Rival reaches parity' } ] },
    { id: 'alignment_durability', label: 'Alignment Durability', stage: 2,
      activateWhen: [
        { capability: ['singularity'], automation: ['deep'], alignment: ['brittle'], _noDecel: true },
        { capability: ['singularity'], automation: ['deep'], alignment: ['brittle'], _decel: ['rival'], _fn: 'decelProgressBrittle' },
      ],
      useRawFor: ['alignment'], useRawUnlessDecel: true,
      values: [
        { id: 'holds', label: 'Holds for now' }, { id: 'breaks', label: 'Breaks' } ] },
    { id: 'containment', label: 'Containment', stage: 2,
      activateWhen: [
        { capability: ['singularity'], automation: ['deep'], _raw: { alignment: ['brittle'], alignment_durability: ['holds'], brittle_resolution: ['escape'] } },
        { capability: ['singularity'], automation: ['deep'], alignment: ['failed'], _notDecel: ['solved', 'parity_solved'] },
        { capability: ['singularity'], automation: ['deep'], _raw: { ai_goals: ['marginal'] }, _notDecel: ['solved', 'parity_solved'] },
      ],
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
      activateWhen: [
        { capability: ['singularity'], automation: ['deep'], alignment: ['failed'], containment: ['escaped'] },
      ],
      overrides: [
        { whenSet: 'inert_outcome', fromDim: 'inert_outcome' },
      ], values: [
        { id: 'benevolent', label: 'Benefit humanity' }, { id: 'alien_coexistence', label: 'Alien (tolerant)' },
        { id: 'alien_extinction', label: 'Alien (total)' }, { id: 'paperclip', label: 'Arbitrary' },
        { id: 'swarm', label: 'Divergent' }, { id: 'marginal', label: 'Inert (for now)' } ] },
    { id: 'proliferation_control', label: 'Proliferation Control', stage: 2,
      activateWhen: [
        { capability: ['singularity'], automation: ['deep'], _notDecel: ['escapes', 'parity_failed'] },
      ],
      lockedWhen: { distribution: { equals: 'open', value: 'none' } }, values: [
        { id: 'deny_rivals', label: 'Deny rivals' },
        { id: 'secure_access', label: 'Secure access' },
        { id: 'none', label: 'No durable control' } ] },
    { id: 'proliferation_outcome', label: 'Control Outcome', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], proliferation_control: ['deny_rivals', 'secure_access'] }],
      values: [
        { id: 'holds', label: 'Holds' },
        { id: 'breached', label: 'Breached' } ] },
    { id: 'enabled_aims', label: 'Enabled Aims', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], proliferation_control: ['deny_rivals', 'secure_access', 'none'] }],
      values: [
        { id: 'human_centered', label: 'Human-centered' },
        { id: 'proxy', label: 'Proxy / institutional' },
        { id: 'arbitrary', label: 'Arbitrary / unconstrained' } ] },
    { id: 'intent', label: 'Intent', stage: 2,
      activateWhen: [
        { capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle'] },
        { capability: ['singularity'], automation: ['deep'], _raw: { alignment: ['failed'], containment: ['contained'] } },
        { capability: ['singularity'], automation: ['deep'], _raw: { ai_goals: ['marginal'] } },
      ],
      useRawFor: ['alignment'], useRawUnlessDecel: true,
      overrides: [
        { when: { escalation_outcome: 'agreement' }, value: 'coexistence' },
        { when: { post_war_aims: 'human_centered' }, value: 'coexistence' },
        { whenSet: 'rival_dynamics', fromDim: 'rival_dynamics' },
      ],
      values: [
        { id: 'self_interest', label: 'Self-interest', requires: [{ distribution: ['monopoly'], geo_spread: ['one'], proliferation_control: ['deny_rivals', 'secure_access'] }, { distribution: ['concentrated', 'lagging'], geo_spread: ['one'], sovereignty: ['state'], proliferation_control: ['deny_rivals', 'secure_access'] }] },
        { id: 'coexistence', label: 'Coexistence', requires: [{ distribution: ['open'], open_source: ['near_parity', 'twelve_months', 'twenty_four_months'] }, { distribution: ['lagging', 'concentrated'], open_source: ['near_parity', 'twelve_months', 'twenty_four_months'], geo_spread: ['two', 'several'] }, { geo_spread: ['two'] }, { proliferation_control: ['none'] }, { proliferation_outcome: ['breached'] }] },
        { id: 'escalation', label: 'Escalation', requires: [{ distribution: ['open'], open_source: ['near_parity', 'twelve_months', 'twenty_four_months'] }, { distribution: ['lagging', 'concentrated'], open_source: ['near_parity', 'twelve_months', 'twenty_four_months'], geo_spread: ['two', 'several'] }, { geo_spread: ['two'] }, { proliferation_control: ['none'] }, { proliferation_outcome: ['breached'] }] },
        { id: 'international', label: 'International' } ] },
    { id: 'block_entrants', label: 'Block New Entrants?', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle'], proliferation_control: ['secure_access'], proliferation_outcome: ['holds'], intent: ['self_interest'] }],
      useRawFor: ['alignment'], useRawUnlessDecel: true,
      values: [
        { id: 'attempt', label: 'Attempt to block' },
        { id: 'no_attempt', label: 'No attempt' } ] },
    { id: 'block_outcome', label: 'Blocking Outcome', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], block_entrants: ['attempt'] }],
      values: [
        { id: 'holds', label: 'Holds' },
        { id: 'fails', label: 'Fails' } ] },
    { id: 'new_entrants', label: 'New Entrants?', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], block_entrants: ['no_attempt'] }],
      values: [
        { id: 'emerge', label: 'Emerge' },
        { id: 'none', label: 'None' } ] },
    { id: 'rival_dynamics', label: 'Rival Dynamics', stage: 2,
      activateWhen: [
        { capability: ['singularity'], automation: ['deep'], _raw: { block_outcome: ['fails'] } },
        { capability: ['singularity'], automation: ['deep'], _raw: { new_entrants: ['emerge'] } },
      ],
      values: [
        { id: 'coexistence', label: 'Coexistence' },
        { id: 'escalation', label: 'Escalation' } ] },
    { id: 'escalation_outcome', label: 'Escalation Resolves', stage: 3,
      activateWhen: [{ intent: ['escalation'] }],
      values: [
        { id: 'standoff', label: 'Indefinite standoff' },
        { id: 'agreement', label: 'Forced agreement' },
        { id: 'conflict', label: 'Open conflict' } ] },
    { id: 'conflict_result', label: 'Conflict Result', stage: 3,
      activateWhen: [{ escalation_outcome: ['conflict'] }],
      suppressWhen: [{ escalation_outcome: ['standoff', 'agreement'] }],
      values: [
        { id: 'victory', label: 'Decisive victory' },
        { id: 'destruction', label: 'Mutual destruction' } ] },
    { id: 'post_war_aims', label: 'Victor\'s Aims', stage: 3,
      activateWhen: [{ conflict_result: ['victory'] }],
      suppressWhen: [{ escalation_outcome: ['standoff', 'agreement'] }],
      values: [
        { id: 'human_centered', label: 'Rebuild for humanity' },
        { id: 'self_interest', label: 'Consolidate power' } ] },
    { id: 'failure_mode', label: 'Implementation', stage: 3,
      activateWhen: [
        { capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle'], _raw: { enabled_aims: ['proxy'] } },
        { capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle'], intent: ['international', 'coexistence'] },
        { capability: ['singularity'], automation: ['deep'], _raw: { brittle_resolution: ['escape'], enabled_aims: ['proxy'] } },
        { capability: ['singularity'], automation: ['deep'], _raw: { brittle_resolution: ['escape'] }, intent: ['international', 'coexistence'] },
        { capability: ['singularity'], automation: ['deep'], _eff: { alignment: ['failed'] }, _raw: { containment: ['contained'] }, intent: ['international', 'coexistence'] },
      ],
      suppressWhen: [{ intent: ['self_interest', 'escalation'] }, { _set: ['post_war_aims'] }],
      overrides: [
        { when: { enabled_aims: 'proxy' }, value: 'whimper' },
      ],
      values: [
        { id: 'none', label: 'Succeeds' }, { id: 'whimper', label: 'Wrong metrics' },
        { id: 'disempowerment', label: 'Human irrelevance' } ] },
    { id: 'benefit_distribution', label: 'Who Benefits?', stage: 3,
      activateWhen: [
        { capability: ['hours', 'days', 'weeks', 'months'], stall_recovery: ['substantial', 'never'] },
        { capability: ['singularity'], automation: ['shallow'], automation_recovery: ['substantial', 'never'] },
        { capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle'], intent: ['international', 'coexistence'], failure_mode: ['none', 'whimper', 'disempowerment'] },
        { capability: ['singularity'], automation: ['deep'], _raw: { brittle_resolution: ['escape'] }, intent: ['international', 'coexistence'], _set: ['failure_mode'] },
        { capability: ['singularity'], automation: ['deep'], _eff: { alignment: ['failed'] }, _raw: { containment: ['contained'] }, intent: ['international', 'coexistence'], _set: ['failure_mode'] },
        { capability: ['singularity'], automation: ['deep'], post_war_aims: ['human_centered'] },
      ],
      suppressWhen: [{ intent: ['self_interest', 'escalation'] }],
      values: [
        { id: 'equal', label: 'Shared equally' }, { id: 'unequal', label: 'Wealth concentrates' },
        { id: 'extreme', label: 'Power concentrates' } ] },
    { id: 'knowledge_replacement', label: 'Knowledge Work', stage: 3,
      activateWhen: [
        { capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle'], intent: ['international', 'coexistence'], failure_mode: ['none', 'whimper', 'disempowerment'] },
        { capability: ['singularity'], automation: ['deep'], _raw: { brittle_resolution: ['escape'] }, intent: ['international', 'coexistence'], _set: ['failure_mode'] },
        { capability: ['singularity'], automation: ['deep'], _eff: { alignment: ['failed'] }, _raw: { containment: ['contained'] }, intent: ['international', 'coexistence'], _set: ['failure_mode'] },
        { capability: ['singularity'], automation: ['deep'], post_war_aims: ['human_centered'] },
      ],
      suppressWhen: [{ intent: ['self_interest', 'escalation'] }],
      values: [
        { id: 'rapid', label: 'Rapid (1–2 yrs)' }, { id: 'gradual', label: 'Gradual (3–10 yrs)' }, { id: 'uneven', label: 'Uneven (1–20 yrs)' },
        { id: 'limited', label: 'Limited', requires: { capability: ['hours', 'days', 'weeks', 'months'] } } ] },
    { id: 'physical_automation', label: 'Physical Automation', stage: 3,
      activateWhen: [
        { capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle'], intent: ['international', 'coexistence'], failure_mode: ['none', 'whimper', 'disempowerment'] },
        { capability: ['singularity'], automation: ['deep'], _raw: { brittle_resolution: ['escape'] }, intent: ['international', 'coexistence'], _set: ['failure_mode'] },
        { capability: ['singularity'], automation: ['deep'], _eff: { alignment: ['failed'] }, _raw: { containment: ['contained'] }, intent: ['international', 'coexistence'], _set: ['failure_mode'] },
        { capability: ['singularity'], automation: ['deep'], post_war_aims: ['human_centered'] },
      ],
      suppressWhen: [{ intent: ['self_interest', 'escalation'] }],
      values: [
        { id: 'rapid', label: 'Rapid (2–5 yrs)' }, { id: 'gradual', label: 'Gradual (5–20 yrs)' }, { id: 'uneven', label: 'Uneven (2–20+ yrs)' },
        { id: 'limited', label: 'Limited', requires: { capability: ['hours', 'days', 'weeks', 'months'] } } ] },
    { id: 'plateau_knowledge_rate', label: 'Knowledge Work', stage: 3,
      activateWhen: [{ capability: ['hours', 'days', 'weeks', 'months'], stall_recovery: ['substantial', 'never'] }],
      values: [
        { id: 'rapid', label: 'Rapid (2–5 yrs)', requires: { capability: ['weeks', 'months'] } },
        { id: 'gradual', label: 'Gradual (5–15 yrs)', requires: { capability: ['days', 'weeks', 'months'] } },
        { id: 'uneven', label: 'Uneven (2–20+ yrs)' },
        { id: 'limited', label: 'Limited', requires: { capability: ['hours', 'days'] } } ] },
    { id: 'plateau_physical_rate', label: 'Physical Automation', stage: 3,
      activateWhen: [{ capability: ['hours', 'days', 'weeks', 'months'], stall_recovery: ['substantial', 'never'] }],
      values: [
        { id: 'rapid', label: 'Rapid', requires: { capability: ['singularity'] } },
        { id: 'gradual', label: 'Gradual (10–25 yrs)', requires: { capability: ['days', 'weeks', 'months'] } },
        { id: 'uneven', label: 'Uneven (5–20+ yrs)' },
        { id: 'limited', label: 'Limited' } ] },
    { id: 'auto_knowledge_rate', label: 'Knowledge Work', stage: 3,
      activateWhen: [{ capability: ['singularity'], automation: ['shallow'], automation_recovery: ['substantial', 'never'] }],
      values: [
        { id: 'rapid', label: 'Rapid (2–4 yrs)' }, { id: 'gradual', label: 'Gradual (5–15 yrs)' }, { id: 'uneven', label: 'Uneven (2–20+ yrs)' },
        { id: 'limited', label: 'Limited', requires: { automation: ['deep'] } } ] },
    { id: 'auto_physical_rate', label: 'Physical Automation', stage: 3,
      activateWhen: [{ capability: ['singularity'], automation: ['shallow'], automation_recovery: ['substantial', 'never'] }],
      values: [
        { id: 'rapid', label: 'Rapid (3–7 yrs)' }, { id: 'gradual', label: 'Gradual (10–25 yrs)' }, { id: 'uneven', label: 'Uneven (3–20+ yrs)' }, { id: 'limited', label: 'Limited' } ] },
    { id: 'brittle_resolution', label: 'Long-Term Alignment Fate', stage: 3,
      activateWhen: [
        { capability: ['singularity'], automation: ['deep'], alignment: ['brittle'], alignment_durability: ['holds'], _fn: 'allPrecedingAnswered' },
      ],
      suppressWhen: [
        { _raw: { enabled_aims: ['arbitrary'] } },
      ],
      useRawFor: ['alignment'], useRawUnlessDecel: true,
      values: [
        { id: 'solved', label: 'Alignment fully solved' },
        { id: 'sufficient', label: 'Brittle alignment holds' },
        { id: 'escape', label: 'AI eventually escapes' } ] },
    { id: 'inert_stays', label: 'Does Escaped AI Stay Inert?', stage: 3,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], ai_goals: ['marginal'] }],
      useRawFor: ['ai_goals'],
      values: [
        { id: 'yes', label: 'Yes — remains inert' },
        { id: 'no', label: 'No — eventually develops goals' } ] },
    { id: 'inert_outcome', label: 'AI Eventually Converges On', stage: 3,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], inert_stays: ['no'] }],
      values: [
        { id: 'benevolent', label: 'Benefit humanity' }, { id: 'alien_coexistence', label: 'Alien (tolerant)' },
        { id: 'alien_extinction', label: 'Alien (total)' }, { id: 'paperclip', label: 'Arbitrary' },
        { id: 'swarm', label: 'Divergent' } ] }
];

const DIM_MAP = {};
for (const d of DIM_META) DIM_MAP[d.id] = d;

// ════════════════════════════════════════════════════════
// Deceleration helpers
// ════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════
// Override engine (declarative)
// ════════════════════════════════════════════════════════

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
        const effGov = effectiveVal(sel, 'gov_action');
        if (effGov === 'accelerate') return 'race';
        if (out === 'abandon') return 'race';
        if (effGov === 'decelerate') return 'slowdown';
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

// ════════════════════════════════════════════════════════
// Activation engine (generic isDimVisible)
// ════════════════════════════════════════════════════════

const HIDE_AFTER_ESCAPE = new Set([
    'proliferation_control', 'proliferation_outcome', 'block_entrants', 'block_outcome',
    'new_entrants', 'rival_dynamics', 'enabled_aims', 'intent', 'failure_mode',
    'knowledge_replacement', 'physical_automation', 'brittle_resolution'
]);

function isEscapedNonMarginal(sel) {
    return sel.ai_goals && sel.ai_goals !== 'marginal' && effectiveVal(sel, 'alignment') === 'failed';
}

const CUSTOM_CHECKS = {
    decelProgressBrittle(sel) {
        return decelAlignProgress(sel) === 'brittle';
    },
    allPrecedingAnswered(sel, dim) {
        const TERM = new Set(['benefit_distribution', 'knowledge_replacement', 'physical_automation',
            'plateau_knowledge_rate', 'plateau_physical_rate',
            'auto_knowledge_rate', 'auto_physical_rate']);
        const brIdx = DIM_META.indexOf(dim);
        const adIdx = DIM_META.findIndex(d => d.id === 'alignment_durability');
        for (let i = adIdx + 1; i < brIdx; i++) {
            const mid = DIM_META[i];
            if (TERM.has(mid.id)) continue;
            if (!isDimVisible(sel, mid)) continue;
            if (isDimLocked(sel, mid) !== null) continue;
            if (!sel[mid.id]) return false;
        }
        return true;
    },
};

function matchCondition(sel, cond, dim) {
    const out = decelOutcome(sel);
    if (cond._noDecel && out !== null) return false;
    if (cond._decel && !cond._decel.includes(out)) return false;
    if (cond._notDecel && cond._notDecel.includes(out)) return false;
    if (cond._set) {
        for (const k of cond._set) {
            if (!sel[k]) return false;
        }
    }
    if (cond._raw) {
        for (const [k, allowed] of Object.entries(cond._raw)) {
            if (!sel[k] || !allowed.includes(sel[k])) return false;
        }
    }
    if (cond._eff) {
        for (const [k, allowed] of Object.entries(cond._eff)) {
            const v = effectiveVal(sel, k);
            if (!v || !allowed.includes(v)) return false;
        }
    }
    for (const [k, allowed] of Object.entries(cond)) {
        if (k.startsWith('_')) continue;
        const useRaw = dim.useRawFor && dim.useRawFor.includes(k)
            && (!dim.useRawUnlessDecel || !out);
        const v = useRaw ? sel[k] : effectiveVal(sel, k);
        if (!v || !allowed.includes(v)) return false;
    }
    if (cond._fn && !CUSTOM_CHECKS[cond._fn](sel, dim)) return false;
    return true;
}

function isDimActivated(sel, dim) {
    if (isEscapedNonMarginal(sel) && HIDE_AFTER_ESCAPE.has(dim.id)) return false;
    if (!dim.activateWhen) return true;
    return dim.activateWhen.some(c => matchCondition(sel, c, dim));
}

function isDimVisible(sel, dim) {
    if (dim.suppressWhen && dim.suppressWhen.some(c => matchCondition(sel, c, dim))) return false;
    if (sel[dim.id]) return true;
    return isDimActivated(sel, dim);
}

// ════════════════════════════════════════════════════════
// Locking and disabling
// ════════════════════════════════════════════════════════

function isDimLocked(sel, dim) {
    if (dim.id === 'gov_action' && sel.alignment === 'robust' && !decelOutcome(sel)) return 'accelerate';
    if (dim.id === 'containment') {
        if (sel.brittle_resolution === 'escape') return 'escaped';
        if (sel.brittle_resolution === 'solved' || sel.brittle_resolution === 'sufficient') return 'contained';
        const out = decelOutcome(sel);
        if (out === 'escapes') return 'escaped';
        // proliferation_control, proliferation_outcome, and enabled_aims come AFTER
        // containment in DIM_META — their effect on containment is handled via
        // effectiveVal overrides (world state) rather than locking (question state).
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
    if (dim.id === 'intent' && val.id === 'self_interest' && sel.enabled_aims === 'human_centered') return true;
    if (dim.id === 'gov_action' && val.id === 'decelerate' && sel.alignment === 'robust') return true;
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

// ════════════════════════════════════════════════════════
// State management
// ════════════════════════════════════════════════════════

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

// Apply a user's dimension selection with full cleanup.
// Deselecting (clicking current value) clears all downstream.
// Switching values interleaves activation sweeps with lock/disabled-value
// cleanup (cleanSelection) in rounds until stable.  This catches both
// direct deactivation cascades AND lock-mediated ones (e.g. switch X →
// lock forces containment=escaped → intent loses activation).
function applySelection(sel, dimId, newValue) {
    const dim = DIM_MAP[dimId];
    if (!dim) return;
    const idx = DIM_META.indexOf(dim);
    if (sel[dimId] === newValue) {
        delete sel[dimId];
        for (let i = idx + 1; i < DIM_META.length; i++) {
            delete sel[DIM_META[i].id];
        }
    } else {
        const hadValue = sel[dimId] !== undefined;
        sel[dimId] = newValue;
        if (hadValue) {
            for (let round = 0; round < 3; round++) {
                for (let pass = 0; pass < 5; pass++) {
                    let changed = false;
                    for (let i = 0; i < DIM_META.length; i++) {
                        const d = DIM_META[i];
                        if (d.id === dimId) continue;
                        if (sel[d.id] === undefined) continue;
                        const saved = sel[d.id];
                        delete sel[d.id];
                        if (isDimVisible(sel, d)) {
                            sel[d.id] = saved;
                        } else {
                            changed = true;
                        }
                    }
                    if (!changed) break;
                }
                const snapshot = DIM_META.map(d => sel[d.id]);
                cleanSelection(sel);
                if (DIM_META.every((d, i) => sel[d.id] === snapshot[i])) break;
            }
        }
    }
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
    d.governance = effectiveVal(sel, 'governance');
    if (!d.rival_dynamics) {
        const pending = ['rival_dynamics', 'block_entrants', 'block_outcome', 'new_entrants'].some(id => {
            const dim = DIM_MAP[id];
            return dim && isDimVisible(sel, dim) && isDimLocked(sel, dim) === null && !sel[id];
        });
        if (pending) delete d.intent;
    }
    if (sel.ai_goals === 'marginal' && !sel.inert_stays) {
        const iDim = DIM_MAP['inert_stays'];
        if (iDim && isDimVisible(sel, iDim) && isDimLocked(sel, iDim) === null) {
            delete d.intent;
        }
    }
    const brDim = DIM_MAP['brittle_resolution'];
    if (brDim && isDimVisible(sel, brDim) && isDimLocked(sel, brDim) === null && !sel.brittle_resolution) {
        delete d.alignment;
    }
    const out = decelOutcome(sel);
    if (['parity_solved', 'parity_failed', 'rival'].includes(out)) {
        d.rival_emerges = 'yes';
    }
    return d;
}

// ════════════════════════════════════════════════════════
// Template matching
// ════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════
// Exports
// ════════════════════════════════════════════════════════

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DIM_META, DIM_MAP, DECEL_PAIRS, decelOutcome, decelAlignProgress,
        matchesOverride, applyOverrides, effectiveVal, isDimVisible, isDimLocked, isValueDisabled,
        cleanSelection, applySelection, effectiveDims, templateMatches, templatePartialMatch };
}
if (typeof window !== 'undefined') {
    window.Logic = { DIM_META, DIM_MAP, DECEL_PAIRS, decelOutcome, decelAlignProgress,
        matchesOverride, applyOverrides, effectiveVal, isDimVisible, isDimLocked, isValueDisabled,
        cleanSelection, applySelection, effectiveDims, templateMatches, templatePartialMatch };
}
