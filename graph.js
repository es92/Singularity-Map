// Singularity Map — Graph definition (structural DAG)
// Narrative content lives in data/narrative.json and is merged at runtime.

(function() {

const SCENARIO = {
    id: 'singularity-map',
    title: 'Singularity Map',
    description: 'Navigate the branching futures of artificial intelligence.',
    storageKey: 'singularity-map-discovered',
    hideConditions: [
        { flag: 'hideAfterEscape', when: {
          _set: ['ai_goals'],
          _rawNot: { ai_goals: ['marginal', 'benevolent'] },
          _eff: { alignment: ['failed'] }
        } },
    ],
};

const DECEL_PAIRS = [
    ['decel_2mo_progress', 'decel_2mo_action'],
    ['decel_4mo_progress', 'decel_4mo_action'],
    ['decel_6mo_progress', 'decel_6mo_action'],
    ['decel_9mo_progress', 'decel_9mo_action'],
    ['decel_12mo_progress', 'decel_12mo_action'],
    ['decel_18mo_progress', 'decel_18mo_action'],
    ['decel_24mo_progress', 'decel_24mo_action'],
];


const OUTCOME_ACTIVATE = [
    { capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle'], intent: ['international', 'coexistence'], _set: ['societal_response'] },
    { capability: ['singularity'], automation: ['deep'], _raw: { brittle_resolution: ['escape'] }, intent: ['international', 'coexistence'], _set: ['societal_response'] },
    { capability: ['singularity'], automation: ['deep'], _eff: { alignment: ['failed'] }, _raw: { containment: ['contained'] }, intent: ['international', 'coexistence'], _set: ['societal_response'] },
    { capability: ['singularity'], automation: ['deep'], post_war_aims: ['human_centered'], _set: ['societal_response'] },
    { capability: ['singularity'], automation: ['deep'], alignment: ['failed'], containment: ['escaped'], ai_goals: ['benevolent'], _set: ['societal_response'] },
    { capability: ['singularity'], automation: ['deep'], intent: ['self_interest'], societal_response: ['fragmented', 'passive'] },
    { capability: ['singularity'], automation: ['deep'], intent: ['self_interest'], _set: ['capture_confrontation'] },
    { capability: ['singularity'], automation: ['deep'], post_war_aims: ['self_interest'], _set: ['societal_response'] }
];


const NODES = [
    { id: 'capability', label: 'AI Scaling', stage: 1, forwardKey: true,
      derivedFrom: [{ when: { stall_recovery: 'mild' }, value: 'singularity' }],
      edges: [
        { id: 'singularity', label: 'Trend continues' },
        { id: 'stalls', label: 'Stalls' }
      ] },
    { id: 'stall_duration', label: 'Stall Duration', stage: 1,
      activateWhen: [{ capability: ['stalls'] }],
      edges: [
        { id: 'hours', label: 'Stalls: hours' },
        { id: 'days', label: 'Stalls: days' },
        { id: 'weeks', label: 'Stalls: weeks' },
        { id: 'months', label: 'Stalls: months' }
      ] },
    { id: 'stall_recovery', label: 'Recovery?', stage: 1,
      activateWhen: [{ capability: ['stalls'] }],
      edges: [
        { id: 'mild', label: 'Months/years' },
        { id: 'substantial', label: 'Years/decades' },
        { id: 'never', label: 'Never' }
      ] },
    { id: 'plateau_benefit_distribution', label: 'Who Benefits?', stage: 3, terminal: true,
      activateWhen: [{ capability: ['stalls'], stall_recovery: ['substantial', 'never'] }],
      edges: [
        { id: 'equal', label: 'Shared equally' },
        { id: 'unequal', label: 'Wealth concentrates' },
        { id: 'extreme', label: 'Power concentrates' }
      ] },
    { id: 'plateau_knowledge_rate', label: 'Knowledge Work', stage: 3, terminal: true,
      activateWhen: [{ capability: ['stalls'], stall_recovery: ['substantial', 'never'] }],
      edges: [
        { id: 'rapid', label: 'Rapid (2–5 yrs)', requires: { stall_duration: ['weeks', 'months'] } },
        {
          id: 'gradual',
          label: 'Gradual (5–15 yrs)',
          requires: { stall_duration: ['days', 'weeks', 'months'] }
        },
        { id: 'uneven', label: 'Uneven (2–20+ yrs)' },
        { id: 'limited', label: 'Limited', requires: { stall_duration: ['hours', 'days'] } }
      ] },
    { id: 'plateau_physical_rate', label: 'Physical Automation', stage: 3, terminal: true,
      activateWhen: [{ capability: ['stalls'], stall_recovery: ['substantial', 'never'] }],
      edges: [
        {
          id: 'gradual',
          label: 'Gradual (10–25 yrs)',
          requires: { stall_duration: ['days', 'weeks', 'months'] }
        },
        { id: 'uneven', label: 'Uneven (5–20+ yrs)' },
        { id: 'limited', label: 'Limited' }
      ] },
    { id: 'agi_threshold', label: 'Human-Competitive AI', stage: 1,
      activateWhen: [{ capability: ['singularity'] }],
      edges: [
        { id: 'twenty_four_hours', label: '~24 hours — we\'re nearly there' },
        { id: 'one_week', label: '~1 week — sustained competence' },
        { id: 'few_months', label: '~A few months — deep expertise' },
        { id: 'one_year', label: '~1 year — the bar is very high' },
        { id: 'ten_plus_years', label: '~10+ years — mastery runs deep' },
        { id: 'never', label: 'Never' }
      ] },
    { id: 'asi_threshold', label: 'Superhuman AI', stage: 1,
      activateWhen: [{ capability: ['singularity'], _set: ['agi_threshold'] }],
      edges: [
        { id: 'twenty_four_hours', label: '~24 hours — the jump is small', requires: { agi_threshold: ['twenty_four_hours'] } },
        { id: 'one_week', label: '~1 week — outpaces quickly', requires: { agi_threshold: ['twenty_four_hours', 'one_week'] } },
        { id: 'few_months', label: '~A few months — strategic superiority', requires: { agi_threshold: ['twenty_four_hours', 'one_week', 'few_months'] } },
        { id: 'one_year', label: '~1 year — the bar is very high', requires: { agi_threshold: ['twenty_four_hours', 'one_week', 'few_months', 'one_year'] } },
        { id: 'ten_plus_years', label: '~10+ years — surpassing takes decades', requires: { agi_threshold: ['twenty_four_hours', 'one_week', 'few_months', 'one_year', 'ten_plus_years'] } },
        { id: 'never', label: 'Never — matching is the ceiling' }
      ] },
    { id: 'automation', label: 'Knowledge Work', derived: true, forwardKey: true,
      derivedFrom: [
        { when: { automation_recovery: 'mild' }, value: 'deep' },
        { when: { agi_threshold: 'never' }, value: 'shallow' },
        { effective: { capability: ['singularity'] }, value: 'deep' }
      ],
      edges: [{ id: 'deep' }, { id: 'shallow' }] },
    { id: 'automation_recovery', label: 'Deep Automation Recovery?', stage: 1,
      activateWhen: [{ capability: ['singularity'], agi_threshold: ['never'] }],
      edges: [
        { id: 'mild', label: 'Months/years' },
        { id: 'substantial', label: 'Years/decades' },
        { id: 'never', label: 'Never' }
      ] },
    { id: 'auto_benefit_distribution', label: 'Who Benefits?', stage: 3, terminal: true,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['shallow'],
          automation_recovery: ['substantial', 'never']
        }
      ],
      edges: [
        { id: 'equal', label: 'Shared equally' },
        { id: 'unequal', label: 'Wealth concentrates' },
        { id: 'extreme', label: 'Power concentrates' }
      ] },
    { id: 'auto_knowledge_rate', label: 'Knowledge Work', stage: 3, terminal: true,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['shallow'],
          automation_recovery: ['substantial', 'never']
        }
      ],
      edges: [
        { id: 'rapid', label: 'Rapid (2–4 yrs)' },
        { id: 'gradual', label: 'Gradual (5–15 yrs)' },
        { id: 'uneven', label: 'Uneven (2–20+ yrs)' }
      ] },
    { id: 'auto_physical_rate', label: 'Physical Automation', stage: 3, terminal: true,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['shallow'],
          automation_recovery: ['substantial', 'never']
        }
      ],
      edges: [
        { id: 'rapid', label: 'Rapid (3–7 yrs)' },
        { id: 'gradual', label: 'Gradual (10–25 yrs)' },
        { id: 'uneven', label: 'Uneven (3–20+ yrs)' },
        { id: 'limited', label: 'Limited' }
      ] },
    { id: 'takeoff', label: 'R&D Acceleration', stage: 1,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'] }],
      edges: [
        { id: 'none', label: '0% — Baseline' },
        { id: 'slow', label: '10% — Modest' },
        { id: 'moderate', label: '20% — Meaningful' },
        { id: 'fast', label: '35% — Dramatic' },
        { id: 'explosive', label: '50% — Runaway' }
      ] },
    { id: 'governance_window', label: 'Governance Window', stage: 1,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], takeoff: ['none', 'slow', 'moderate'] }],
      edges: [ { id: 'governed', label: 'Active preparation' }, { id: 'partial', label: 'Partial preparation' }, { id: 'race', label: 'Relative complacency' } ] },
    { id: 'open_source', label: 'Open Source', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'] }],
      edges: [
        { id: 'near_parity', label: 'Near-parity', disabledWhen: [{ takeoff: ['explosive'], reason: 'At this pace, open-source can\'t keep up' }] },
        { id: 'six_months', label: '~6 months', disabledWhen: [{ takeoff: ['explosive'], reason: 'At this pace, open-source can\'t keep up' }] },
        { id: 'twelve_months', label: '~12 months', disabledWhen: [{ takeoff: ['explosive'], reason: 'At this pace, open-source can\'t keep up' }] },
        { id: 'twenty_four_months', label: '~24 months' }
      ] },
    { id: 'distribution', label: 'Frontier Labs', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'] }],
      edges: [
        { id: 'open', label: 'Distributed', requires: { open_source: ['near_parity'] }, disabledWhen: [{ takeoff: ['explosive'], reason: 'At this speed, only whoever gets there first has it' }] },
        { id: 'lagging', label: 'Many compete', disabledWhen: [{ takeoff: ['explosive'], reason: 'At this speed, only whoever gets there first has it' }, { open_source: ['near_parity'], reason: 'With open-source at parity, no one is lagging behind' }] },
        { id: 'concentrated', label: 'A few lead', disabledWhen: [{ takeoff: ['explosive'], reason: 'At this speed, only whoever gets there first has it' }, { open_source: ['near_parity'], reason: 'With open-source at parity, no one is lagging behind' }] },
        { id: 'monopoly', label: 'One dominates', disabledWhen: [{ open_source: ['near_parity'], reason: 'With open-source at parity, no one can monopolize it' }] }
      ] },
    { id: 'geo_spread', label: 'Countries', stage: 2,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          open_source: ['six_months', 'twelve_months', 'twenty_four_months']
        }
      ],
      derivedFrom: [
        { effective: { decel_outcome: ['rival', 'parity_solved', 'parity_failed'] }, value: 'two' },
        { when: { proliferation_outcome: 'leaks_rivals' }, value: 'two' },
        { when: { proliferation_outcome: 'leaks_public' }, value: 'several' }
      ],
      edges: [
        { id: 'one', label: 'One country' },
        { id: 'two', label: 'Two powers', disabledWhen: [{ takeoff: ['explosive'], reason: 'Only the first mover has it at this speed' }, { distribution: ['monopoly'], reason: 'One lab dominates — only one country is in the game' }] },
        { id: 'several', label: 'Several', disabledWhen: [{ takeoff: ['explosive'], reason: 'Only the first mover has it at this speed' }, { distribution: ['monopoly'], reason: 'One lab dominates — only one country is in the game' }] }
      ] },
    { id: 'sovereignty', label: 'Power Holder', stage: 2,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          distribution: ['monopoly', 'concentrated', 'lagging'],
          geo_spread: ['one']
        }
      ],
      edges: [ { id: 'lab', label: 'The labs' }, { id: 'state', label: 'The state' } ] },
    { id: 'alignment', label: 'Alignment', stage: 2, forwardKey: true,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'] }],
      derivedFrom: [
        { effective: { decel_outcome: ['solved', 'parity_solved'] }, value: 'robust' },
        { when: { brittle_resolution: 'solved' }, value: 'robust' },
        { when: { brittle_resolution: 'sufficient' }, valueMap: { failed: 'brittle' } },
        { when: { inert_stays: 'no' }, whenSet: 'inert_outcome', value: 'failed' },
        {
          when: { ai_goals: 'marginal' },
          unless: { brittle_resolution: 'solved' },
          valueMap: { failed: 'brittle' }
        },
        { when: { alignment_durability: 'breaks' }, value: 'failed' },
        { when: { brittle_resolution: 'escape' }, value: 'failed' },
        { when: { proliferation_outcome: 'leaks_public' }, unless: { alignment: 'robust' }, value: 'failed' },
        { when: { proliferation_alignment: 'breaks' }, value: 'failed' },
        { effective: { decel_outcome: ['rival'] }, value: 'brittle' },
        { effective: { decel_outcome: ['escapes', 'abandon', 'parity_failed'] }, value: 'failed' }
      ],
      edges: [
        { id: 'robust', label: 'Robust' },
        { id: 'brittle', label: 'Brittle / Partial' },
        { id: 'failed', label: 'Unsolved' }
      ] },
    { id: 'alignment_durability', label: 'Alignment Durability', stage: 2,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          alignment: ['brittle'],
          _notSet: ['decel_outcome']
        },
        {
          capability: ['singularity'],
          automation: ['deep'],
          alignment: ['brittle'],
          _eff: { decel_outcome: ['rival'], decel_align_progress: ['brittle'] }
        }
      ],
      edges: [ { id: 'holds', label: 'Holds for now' }, { id: 'breaks', label: 'Breaks' } ] },
    { id: 'containment', label: 'Containment', stage: 2, forwardKey: true,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          _raw: { alignment: ['brittle'], alignment_durability: ['holds'], brittle_resolution: ['escape'] }
        },
        {
          capability: ['singularity'],
          automation: ['deep'],
          alignment: ['failed'],
          _effNot: { decel_outcome: ['solved', 'parity_solved'] }
        },
        {
          capability: ['singularity'],
          automation: ['deep'],
          _raw: { ai_goals: ['marginal'] },
          _effNot: { decel_outcome: ['solved', 'parity_solved'] }
        }
      ],
      derivedFrom: [
        { when: { inert_stays: 'no' }, whenSet: 'inert_outcome', value: 'escaped' }
      ],
      edges: [
        {
          id: 'contained',
          label: 'Contained',
          requires: { distribution: ['lagging', 'concentrated', 'monopoly'] },
          disabledWhen: [
            { _raw: { brittle_resolution: ['escape'] }, reason: 'Alignment broke down and the AI is already out' },
            { decel_outcome: ['escapes'], reason: 'The AI got out during the slowdown period' },
            { proliferation_outcome: ['leaks_public'], reason: 'The technology leaked publicly — there is nothing left to contain' }
          ]
        },
        { id: 'escaped', label: 'Escapes' }
      ] },
    { id: 'gov_action', label: 'Deceleration', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], geo_spread: ['one'] }],
      derivedFrom: [{ when: { alignment_durability: 'breaks' }, value: 'accelerate' }],
      edges: [
        { id: 'decelerate', label: 'Decelerate', disabledWhen: [{ _raw: { alignment: ['robust'] }, reason: 'Alignment is solved — there is no case for slowing down' }, { takeoff: ['explosive'], reason: 'Moving too fast for any government to intervene' }] },
        { id: 'accelerate', label: 'Accelerate' }
      ] },
    { id: 'decel_2mo_progress', label: '2 Months', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], gov_action: ['decelerate'] }],
      edges: [
        { id: 'robust', label: 'Solved — robust' },
        { id: 'brittle', label: 'Solved — brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet', disabledWhen: [{ alignment: ['brittle'], reason: 'Alignment is already partially solved' }] }
      ] },
    { id: 'decel_2mo_action', label: '2mo Decision', stage: 2,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          decel_2mo_progress: ['robust', 'brittle', 'unsolved']
        }
      ],
      edges: [
        { id: 'escapes', label: 'AI Escapes', requires: { decel_2mo_progress: ['brittle', 'unsolved'] } },
        { id: 'rival', label: 'Rival reaches parity' },
        { id: 'accelerate', label: 'Accelerate' },
        { id: 'continue', label: 'Continue', requires: { decel_2mo_progress: ['brittle', 'unsolved'] } }
      ] },
    { id: 'decel_4mo_progress', label: '4 Months', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], decel_2mo_action: ['continue'] }],
      edges: [
        { id: 'robust', label: 'Solved — robust' },
        { id: 'brittle', label: 'Solved — brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet', disabledWhen: [{ alignment: ['brittle'], reason: 'Alignment is already partially solved' }] }
      ] },
    { id: 'decel_4mo_action', label: '4mo Decision', stage: 2,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          decel_4mo_progress: ['robust', 'brittle', 'unsolved']
        }
      ],
      edges: [
        { id: 'escapes', label: 'AI Escapes', requires: { decel_4mo_progress: ['brittle', 'unsolved'] } },
        { id: 'rival', label: 'Rival reaches parity' },
        { id: 'accelerate', label: 'Accelerate' },
        { id: 'continue', label: 'Continue', requires: { decel_4mo_progress: ['brittle', 'unsolved'] } }
      ] },
    { id: 'decel_6mo_progress', label: '6 Months', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], decel_4mo_action: ['continue'] }],
      edges: [
        { id: 'robust', label: 'Solved — robust' },
        { id: 'brittle', label: 'Solved — brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet', disabledWhen: [{ alignment: ['brittle'], reason: 'Alignment is already partially solved' }] }
      ] },
    { id: 'decel_6mo_action', label: '6mo Decision', stage: 2,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          decel_6mo_progress: ['robust', 'brittle', 'unsolved']
        }
      ],
      edges: [
        {
          id: 'escapes',
          label: 'AI Escapes',
          requires: {
          decel_6mo_progress: ['brittle', 'unsolved'],
          open_source: ['twelve_months', 'twenty_four_months']
        }
        },
        { id: 'rival', label: 'Rival reaches parity' },
        {
          id: 'accelerate',
          label: 'Accelerate',
          requires: { open_source: ['twelve_months', 'twenty_four_months'] }
        },
        {
          id: 'continue',
          label: 'Continue',
          requires: {
          decel_6mo_progress: ['brittle', 'unsolved'],
          open_source: ['twelve_months', 'twenty_four_months']
        }
        }
      ] },
    { id: 'decel_9mo_progress', label: '9 Months', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], decel_6mo_action: ['continue'] }],
      edges: [
        { id: 'robust', label: 'Solved — robust' },
        { id: 'brittle', label: 'Solved — brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet', disabledWhen: [{ alignment: ['brittle'], reason: 'Alignment is already partially solved' }] }
      ] },
    { id: 'decel_9mo_action', label: '9mo Decision', stage: 2,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          decel_9mo_progress: ['robust', 'brittle', 'unsolved']
        }
      ],
      edges: [
        { id: 'escapes', label: 'AI Escapes', requires: { decel_9mo_progress: ['brittle', 'unsolved'] } },
        { id: 'rival', label: 'Rival reaches parity' },
        { id: 'accelerate', label: 'Accelerate' },
        { id: 'continue', label: 'Continue', requires: { decel_9mo_progress: ['brittle', 'unsolved'] } }
      ] },
    { id: 'decel_12mo_progress', label: '12 Months', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], decel_9mo_action: ['continue'] }],
      edges: [
        { id: 'robust', label: 'Solved — robust' },
        { id: 'brittle', label: 'Solved — brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet', disabledWhen: [{ alignment: ['brittle'], reason: 'Alignment is already partially solved' }] }
      ] },
    { id: 'decel_12mo_action', label: '12mo Decision', stage: 2,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          decel_12mo_progress: ['robust', 'brittle', 'unsolved']
        }
      ],
      edges: [
        {
          id: 'escapes',
          label: 'AI Escapes',
          requires: { decel_12mo_progress: ['brittle', 'unsolved'], open_source: ['twenty_four_months'] }
        },
        { id: 'rival', label: 'Rival reaches parity' },
        { id: 'accelerate', label: 'Accelerate', requires: { open_source: ['twenty_four_months'] } },
        {
          id: 'continue',
          label: 'Continue',
          requires: { decel_12mo_progress: ['brittle', 'unsolved'], open_source: ['twenty_four_months'] }
        }
      ] },
    { id: 'decel_18mo_progress', label: '18 Months', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], decel_12mo_action: ['continue'] }],
      edges: [
        { id: 'robust', label: 'Solved — robust' },
        { id: 'brittle', label: 'Solved — brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet', disabledWhen: [{ alignment: ['brittle'], reason: 'Alignment is already partially solved' }] }
      ] },
    { id: 'decel_18mo_action', label: '18mo Decision', stage: 2,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          decel_18mo_progress: ['robust', 'brittle', 'unsolved']
        }
      ],
      edges: [
        { id: 'escapes', label: 'AI Escapes', requires: { decel_18mo_progress: ['brittle', 'unsolved'] } },
        { id: 'rival', label: 'Rival reaches parity' },
        { id: 'accelerate', label: 'Accelerate' },
        { id: 'continue', label: 'Continue', requires: { decel_18mo_progress: ['brittle', 'unsolved'] } }
      ] },
    { id: 'decel_24mo_progress', label: '24 Months', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], decel_18mo_action: ['continue'] }],
      edges: [
        { id: 'robust', label: 'Solved — robust' },
        { id: 'brittle', label: 'Solved — brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet', disabledWhen: [{ alignment: ['brittle'], reason: 'Alignment is already partially solved' }] }
      ] },
    { id: 'decel_24mo_action', label: '24mo Decision', stage: 2,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          decel_24mo_progress: ['robust', 'brittle', 'unsolved']
        }
      ],
      edges: [ { id: 'rival', label: 'Rival reaches parity' } ] },
    { id: 'proliferation_control', label: 'Proliferation Control', stage: 2, hideAfterEscape: true,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          _effNot: { decel_outcome: ['escapes', 'parity_failed'] }
        }
      ],
      edges: [
        { id: 'deny_rivals', label: 'Deny rivals', disabledWhen: [{ distribution: ['open'], reason: 'The technology is already openly distributed' }] },
        { id: 'secure_access', label: 'Secure access', disabledWhen: [{ distribution: ['open'], reason: 'The technology is already openly distributed' }] },
        { id: 'none', label: 'Open access' }
      ] },
    { id: 'proliferation_outcome', label: 'Control Outcome', stage: 2, hideAfterEscape: true,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          proliferation_control: ['deny_rivals', 'secure_access', 'none']
        }
      ],
      edges: [
        {
          id: 'holds',
          label: 'Holds',
          requires: { proliferation_control: ['deny_rivals', 'secure_access'] }
        },
        { id: 'leaks_rivals', label: 'Leaks to rivals' },
        { id: 'leaks_public', label: 'Leaks publicly' }
      ] },
    { id: 'proliferation_alignment', label: 'Alignment Under Open Weights', stage: 2,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          alignment: ['robust'],
          proliferation_outcome: ['leaks_public']
        }
      ],
      edges: [
        { id: 'holds', label: 'Alignment is intrinsic' },
        { id: 'breaks', label: 'Someone cracks it' }
      ] },
    { id: 'intent', label: 'Intent', stage: 2, forwardKey: true, hideAfterEscape: true,
      activateWhen: [
        { capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle'], _set: ['proliferation_control'] },
        {
          capability: ['singularity'],
          automation: ['deep'],
          _eff: { alignment: ['failed'] },
          _raw: { containment: ['contained'] }
        },
        { capability: ['singularity'], automation: ['deep'], _raw: { ai_goals: ['marginal'] } }
      ],
      derivedFrom: [
        { when: { escalation_outcome: 'agreement' }, value: 'coexistence' },
        { when: { post_war_aims: 'human_centered' }, value: 'coexistence' },
        { when: { capture_confrontation: 'succeeds' }, value: 'international' },
        { whenSet: 'rival_dynamics', fromDim: 'rival_dynamics' }
      ],
      edges: [
        {
          id: 'self_interest',
          label: 'Self-interest',
          requires: [
          {
            distribution: ['monopoly'],
            geo_spread: ['one'],
            proliferation_control: ['deny_rivals', 'secure_access']
          },
          {
            distribution: ['concentrated', 'lagging'],
            geo_spread: ['one'],
            proliferation_control: ['deny_rivals', 'secure_access']
          }
        ]
        },
        {
          id: 'coexistence',
          label: 'Coexistence',
          requires: [
          { distribution: ['open'], open_source: ['near_parity', 'twelve_months', 'twenty_four_months'] },
          {
            distribution: ['lagging', 'concentrated'],
            open_source: ['near_parity', 'twelve_months', 'twenty_four_months'],
            geo_spread: ['two', 'several']
          },
          { geo_spread: ['two'] },
          { proliferation_outcome: ['leaks_rivals', 'leaks_public'] }
        ]
        },
        {
          id: 'escalation',
          label: 'Escalation',
          requires: [
          { distribution: ['open'], open_source: ['near_parity', 'twelve_months', 'twenty_four_months'] },
          {
            distribution: ['lagging', 'concentrated'],
            open_source: ['near_parity', 'twelve_months', 'twenty_four_months'],
            geo_spread: ['two', 'several']
          },
          { geo_spread: ['two'] },
          { proliferation_outcome: ['leaks_rivals', 'leaks_public'] }
        ]
        },
        { id: 'international', label: 'International' }
      ] },
    { id: 'block_entrants', label: 'Block New Entrants?', stage: 2, hideAfterEscape: true,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          alignment: ['robust', 'brittle'],
          proliferation_control: ['secure_access'],
          proliferation_outcome: ['holds'],
          intent: ['self_interest', 'international']
        }
      ],
      edges: [ { id: 'attempt', label: 'Attempt to block' }, { id: 'no_attempt', label: 'No attempt' } ] },
    { id: 'block_outcome', label: 'Blocking Outcome', stage: 2, hideAfterEscape: true,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], block_entrants: ['attempt'] }],
      edges: [ { id: 'holds', label: 'Holds' }, { id: 'fails', label: 'Fails' } ] },
    { id: 'new_entrants', label: 'New Entrants?', stage: 2, hideAfterEscape: true,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], block_entrants: ['no_attempt'] }],
      edges: [ { id: 'emerge', label: 'Emerge' }, { id: 'none', label: 'None' } ] },
    { id: 'rival_dynamics', label: 'Rival Dynamics', stage: 2, hideAfterEscape: true,
      activateWhen: [
        { capability: ['singularity'], automation: ['deep'], _raw: { block_outcome: ['fails'] } },
        { capability: ['singularity'], automation: ['deep'], _raw: { new_entrants: ['emerge'] } }
      ],
      edges: [ { id: 'coexistence', label: 'Coexistence' }, { id: 'escalation', label: 'Escalation' } ] },
    { id: 'escalation_outcome', label: 'Escalation Resolves', stage: 3,
      activateWhen: [{ intent: ['escalation'] }],
      edges: [
        { id: 'standoff', label: 'Indefinite standoff' },
        { id: 'agreement', label: 'Forced agreement' },
        { id: 'conflict', label: 'Open conflict' }
      ] },
    { id: 'conflict_result', label: 'Conflict Result', stage: 3,
      activateWhen: [{ escalation_outcome: ['conflict'] }],
      edges: [ { id: 'victory', label: 'Decisive victory' }, { id: 'destruction', label: 'Mutual destruction' } ] },
    { id: 'war_survivors', label: 'Humanity Survives?', stage: 3,
      activateWhen: [{ conflict_result: ['destruction'] }],
      edges: [
        { id: 'most', label: 'Most — devastated but recoverable' },
        { id: 'remnants', label: 'Remnants — civilization collapses' },
        { id: 'none', label: 'None — extinction' }
      ] },
    { id: 'post_war_aims', label: 'Victor\'s Aims', stage: 3,
      activateWhen: [{ conflict_result: ['victory'] }],
      edges: [ { id: 'human_centered', label: 'Rebuild for humanity' }, { id: 'self_interest', label: 'Consolidate power' } ] },
    { id: 'societal_response', label: 'Societal Response', stage: 3, hideAfterEscape: true,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          alignment: ['robust', 'brittle'],
          intent: ['international', 'coexistence'],
          _notSet: ['post_war_aims']
        },
        {
          capability: ['singularity'],
          automation: ['deep'],
          _raw: { brittle_resolution: ['escape'] },
          intent: ['international', 'coexistence'],
          _notSet: ['post_war_aims']
        },
        {
          capability: ['singularity'],
          automation: ['deep'],
          _eff: { alignment: ['failed'] },
          _raw: { containment: ['contained'] },
          intent: ['international', 'coexistence'],
          _notSet: ['post_war_aims']
        },
        { capability: ['singularity'], automation: ['deep'], intent: ['self_interest'] },
        { capability: ['singularity'], automation: ['deep'], _set: ['post_war_aims'] },
        { capability: ['singularity'], automation: ['deep'], alignment: ['failed'], containment: ['escaped'], ai_goals: ['benevolent'] }
      ],
      edges: [
        { id: 'strong', label: 'Strong collective response' },
        { id: 'fragmented', label: 'Fragmented response' },
        { id: 'passive', label: 'Passive adoption' }
      ] },
    { id: 'capture_confrontation', label: 'Confrontation', stage: 3,
      activateWhen: [
        { capability: ['singularity'], automation: ['deep'], intent: ['self_interest'], societal_response: ['strong'] }
      ],
      edges: [
        { id: 'succeeds', label: 'Resistance succeeds' },
        { id: 'fails', label: 'Power prevails' }
      ] },
    { id: 'benefit_distribution', label: 'Who Benefits?', stage: 3, terminal: true,
      activateWhen: OUTCOME_ACTIVATE,
      edges: [
        { id: 'equal', label: 'Shared equally',
          disabledWhen: [
            { societal_response: ['fragmented'], intent: ['self_interest'], reason: 'Without coordination or shared purpose, equal distribution doesn\'t happen on its own' },
            { societal_response: ['fragmented'], post_war_aims: ['self_interest'], reason: 'After the conflict, self-interest and fragmentation prevent equal sharing' },
            { capture_confrontation: ['fails'], reason: 'The pushback against concentration didn\'t work' }
          ] },
        { id: 'unequal', label: 'Wealth concentrates' },
        { id: 'extreme', label: 'Power concentrates',
          disabledWhen: [
            { societal_response: ['strong'], intent: ['international'], reason: 'Broad coordination and collective action keep concentration in check' },
            { societal_response: ['strong'], intent: ['coexistence'], reason: 'A mobilized society pursuing coexistence constrains concentration' },
            { societal_response: ['strong'], post_war_aims: ['self_interest'], reason: 'Collective action constrains concentration, even when motives are self-interested' },
            { societal_response: ['strong'], ai_goals: ['benevolent'], reason: 'A mobilized society backed by a benevolent AI doesn\'t let power concentrate this far' },
            { capture_confrontation: ['succeeds'], reason: 'The pushback against concentration succeeded' }
          ] }
      ] },
    { id: 'knowledge_replacement', label: 'Knowledge Work', stage: 3, terminal: true, hideAfterEscape: true,
      activateWhen: OUTCOME_ACTIVATE,
      edges: [
        { id: 'rapid', label: 'Rapid (1–2 yrs)' },
        { id: 'gradual', label: 'Gradual (3–10 yrs)' },
        { id: 'uneven', label: 'Uneven (1–20 yrs)' }
      ] },
    { id: 'physical_automation', label: 'Physical Automation', stage: 3, terminal: true, hideAfterEscape: true,
      activateWhen: OUTCOME_ACTIVATE,
      edges: [
        { id: 'rapid', label: 'Rapid (2–5 yrs)' },
        { id: 'gradual', label: 'Gradual (5–20 yrs)' },
        { id: 'uneven', label: 'Uneven (2–20+ yrs)' }
      ] },
    { id: 'brittle_resolution', label: 'Long-Term Alignment Fate', stage: 3, hideAfterEscape: true,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          alignment: ['brittle'],
          alignment_durability: ['holds'],
          _fn: 'allPrecedingAnswered',
          _fnAnchor: 'alignment_durability'
        }
      ],
      edges: [
        { id: 'solved', label: 'Alignment fully solved' },
        { id: 'sufficient', label: 'Brittle alignment holds' },
        { id: 'escape', label: 'AI eventually escapes' }
      ] },
    { id: 'ai_goals', label: 'AI Converges On', stage: 2, forwardKey: true,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          alignment: ['failed'],
          containment: ['escaped']
        }
      ],
      derivedFrom: [{ whenSet: 'inert_outcome', fromDim: 'inert_outcome' }],
      edges: [
        { id: 'benevolent', label: 'Benefit humanity' },
        { id: 'alien_coexistence', label: 'Alien (tolerant)' },
        { id: 'alien_extinction', label: 'Alien (total)' },
        { id: 'paperclip', label: 'Arbitrary' },
        { id: 'swarm', label: 'Divergent' },
        { id: 'power_seeking', label: 'Power accumulation' },
        { id: 'marginal', label: 'Inert (for now)' }
      ] },
    { id: 'inert_stays', label: 'Does Escaped AI Stay Inert?', stage: 3,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], ai_goals: ['marginal'] }],
      edges: [ { id: 'yes', label: 'Yes — remains inert' }, { id: 'no', label: 'No — eventually develops goals and escapes' } ] },
    { id: 'inert_outcome', label: 'AI Eventually Converges On', stage: 3,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], inert_stays: ['no'] }],
      edges: [
        { id: 'benevolent', label: 'Benefit humanity' },
        { id: 'alien_coexistence', label: 'Alien (tolerant)' },
        { id: 'alien_extinction', label: 'Alien (total)' },
        { id: 'paperclip', label: 'Arbitrary' },
        { id: 'swarm', label: 'Divergent' },
        { id: 'power_seeking', label: 'Power accumulation' }
      ] },
    { id: 'failure_mode', label: 'Implementation', stage: 3, forwardKey: true, hideAfterEscape: true,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          alignment: ['robust', 'brittle'],
          intent: ['international', 'coexistence'],
          _notSet: ['post_war_aims'],
          _set: ['societal_response']
        },
        {
          capability: ['singularity'],
          automation: ['deep'],
          _raw: { brittle_resolution: ['escape'] },
          ai_goals: ['benevolent', 'marginal'],
          intent: ['international', 'coexistence'],
          _notSet: ['post_war_aims'],
          _set: ['societal_response']
        },
        {
          capability: ['singularity'],
          automation: ['deep'],
          _eff: { alignment: ['failed'] },
          _raw: { containment: ['contained'] },
          intent: ['international', 'coexistence'],
          _notSet: ['post_war_aims'],
          _set: ['societal_response']
        }
      ],
      edges: [
        { id: 'none', label: 'Succeeds' },
        { id: 'drift', label: 'Gradual drift' }
      ] },
    { id: 'escape_method', label: 'Method', stage: 3,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          alignment: ['failed'],
          containment: ['escaped'],
          ai_goals: ['alien_coexistence', 'alien_extinction', 'paperclip', 'swarm', 'power_seeking']
        }
      ],
      edges: [
        { id: 'nanotech', label: 'Nanotechnology' },
        { id: 'pathogens', label: 'Engineered pathogens' },
        { id: 'autonomous_weapons', label: 'Autonomous weapons' },
        { id: 'industrial', label: 'Industrial conversion' }
      ] },
    { id: 'escape_timeline', label: 'Execution Speed', stage: 3,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          alignment: ['failed'],
          containment: ['escaped'],
          ai_goals: ['alien_coexistence', 'alien_extinction', 'paperclip', 'swarm', 'power_seeking'],
          escape_method: ['nanotech', 'pathogens', 'autonomous_weapons', 'industrial']
        }
      ],
      edges: [
        { id: 'days_weeks', label: 'Days to weeks', requires: { escape_method: ['nanotech'] } },
        {
          id: 'months',
          label: 'Months',
          requires: { escape_method: ['nanotech', 'pathogens', 'autonomous_weapons'] }
        },
        { id: 'years', label: 'Years' },
        {
          id: 'decade_plus',
          label: 'A decade+',
          requires: { escape_method: ['autonomous_weapons', 'industrial'] }
        }
      ] },
    { id: 'decel_outcome', label: 'Deceleration Outcome', derived: true,
      activateWhen: [{ gov_action: ['decelerate'] }],
      derivedFrom: [],
      edges: [{ id: 'solved' }, { id: 'abandon' }, { id: 'rival' }, { id: 'parity_solved' }, { id: 'parity_failed' }, { id: 'escapes' }] },
    { id: 'decel_align_progress', label: 'Decel Alignment Progress', derived: true,
      activateWhen: [{ gov_action: ['decelerate'] }],
      derivedFrom: [],
      edges: [{ id: 'robust' }, { id: 'brittle' }, { id: 'unsolved' }] },
    { id: 'governance', label: 'Governance', derived: true, forwardKey: true,
      derivedFrom: [
        { effective: { gov_action: ['accelerate'] }, value: 'race' },
        { effective: { decel_outcome: ['abandon'] }, value: 'race' },
        { effective: { gov_action: ['decelerate'] }, value: 'slowdown' },
        { when: { governance_window: 'governed' }, value: 'governed' },
        { when: { governance_window: 'partial' }, value: 'partial' },
        { when: { governance_window: 'race' }, value: 'race' },
      ],
      edges: [{ id: 'race' }, { id: 'slowdown' }, { id: 'governed' }, { id: 'partial' }] },
    { id: 'rival_emerges', label: 'Rival Emerges', derived: true,
      derivedFrom: [
        { effective: { decel_outcome: ['parity_solved', 'parity_failed', 'rival'] }, value: 'yes' },
      ],
      edges: [{ id: 'yes' }] }
];

const NODE_MAP = {};
for (const d of NODES) NODE_MAP[d.id] = d;

// Generate decel derived node derivations from actual action node edges
for (const [pKey, aKey] of DECEL_PAIRS) {
    const vals = new Set(NODE_MAP[aKey].edges.map(v => v.id));
    const has = v => vals.has(v);
    if (has('escapes'))    NODE_MAP['decel_outcome'].derivedFrom.push({ when: { [aKey]: 'escapes' }, value: 'escapes' });
    if (has('accelerate')) NODE_MAP['decel_outcome'].derivedFrom.push({ when: { [aKey]: 'accelerate', [pKey]: 'robust' }, value: 'solved' });
    if (has('accelerate')) NODE_MAP['decel_outcome'].derivedFrom.push({ when: { [aKey]: 'accelerate' }, value: 'abandon' });
    if (has('rival'))      NODE_MAP['decel_outcome'].derivedFrom.push({ when: { [aKey]: 'rival', [pKey]: 'robust' }, value: 'parity_solved' });
    if (has('rival'))      NODE_MAP['decel_outcome'].derivedFrom.push({ when: { [aKey]: 'rival', [pKey]: 'unsolved' }, value: 'parity_failed' });
    if (has('rival'))      NODE_MAP['decel_outcome'].derivedFrom.push({ when: { [aKey]: 'rival' }, value: 'rival' });
    if (has('escapes'))    NODE_MAP['decel_align_progress'].derivedFrom.push({ when: { [aKey]: 'escapes' }, fromDim: pKey });
    if (has('accelerate')) NODE_MAP['decel_align_progress'].derivedFrom.push({ when: { [aKey]: 'accelerate' }, fromDim: pKey });
    if (has('rival'))      NODE_MAP['decel_align_progress'].derivedFrom.push({ when: { [aKey]: 'rival' }, fromDim: pKey });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SCENARIO, NODES, NODE_MAP };
}
if (typeof window !== 'undefined') {
    window.Graph = { SCENARIO, NODES, NODE_MAP };
}

})();
