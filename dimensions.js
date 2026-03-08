// Singularity Map — Dimension definitions
// Pure declarative data: the graph of dimensions, their values, and rules.
// No functions — just the structure that the engine interprets.

(function() {

const DIMENSIONS = [
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
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle'], proliferation_control: ['secure_access'], proliferation_outcome: ['holds'], intent: ['self_interest', 'international'] }],
      useRawFor: ['alignment', 'intent'], useRawUnlessDecel: true,
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
        { id: 'rapid', label: 'Rapid (1–2 yrs)' }, { id: 'gradual', label: 'Gradual (3–10 yrs)' }, { id: 'uneven', label: 'Uneven (1–20 yrs)' } ] },
    { id: 'physical_automation', label: 'Physical Automation', stage: 3,
      activateWhen: [
        { capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle'], intent: ['international', 'coexistence'], failure_mode: ['none', 'whimper', 'disempowerment'] },
        { capability: ['singularity'], automation: ['deep'], _raw: { brittle_resolution: ['escape'] }, intent: ['international', 'coexistence'], _set: ['failure_mode'] },
        { capability: ['singularity'], automation: ['deep'], _eff: { alignment: ['failed'] }, _raw: { containment: ['contained'] }, intent: ['international', 'coexistence'], _set: ['failure_mode'] },
        { capability: ['singularity'], automation: ['deep'], post_war_aims: ['human_centered'] },
      ],
      suppressWhen: [{ intent: ['self_interest', 'escalation'] }],
      values: [
        { id: 'rapid', label: 'Rapid (2–5 yrs)' }, { id: 'gradual', label: 'Gradual (5–20 yrs)' }, { id: 'uneven', label: 'Uneven (2–20+ yrs)' } ] },
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
        { id: 'gradual', label: 'Gradual (10–25 yrs)', requires: { capability: ['days', 'weeks', 'months'] } },
        { id: 'uneven', label: 'Uneven (5–20+ yrs)' },
        { id: 'limited', label: 'Limited' } ] },
    { id: 'auto_knowledge_rate', label: 'Knowledge Work', stage: 3,
      activateWhen: [{ capability: ['singularity'], automation: ['shallow'], automation_recovery: ['substantial', 'never'] }],
      values: [
        { id: 'rapid', label: 'Rapid (2–4 yrs)' }, { id: 'gradual', label: 'Gradual (5–15 yrs)' }, { id: 'uneven', label: 'Uneven (2–20+ yrs)' } ] },
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
for (const d of DIMENSIONS) DIM_MAP[d.id] = d;

const DECEL_PAIRS = [
    ['decel_2mo_progress', 'decel_2mo_action'],
    ['decel_4mo_progress', 'decel_4mo_action'],
    ['decel_6mo_progress', 'decel_6mo_action'],
    ['decel_9mo_progress', 'decel_9mo_action'],
    ['decel_12mo_progress', 'decel_12mo_action'],
    ['decel_18mo_progress', 'decel_18mo_action'],
    ['decel_24mo_progress', 'decel_24mo_action'],
];

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DIMENSIONS, DIM_MAP, DECEL_PAIRS };
}
if (typeof window !== 'undefined') {
    window.Dimensions = { DIMENSIONS, DIM_MAP, DECEL_PAIRS };
}

})();
