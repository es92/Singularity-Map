// Singularity Map — Graph definition (structural DAG)
// Narrative content lives in data/narrative.json and is merged at runtime.

(function() {

const SCENARIO = {
    id: 'singularity-map',
    title: 'Singularity Map',
    description: 'Navigate the branching futures of artificial intelligence.',
    storageKey: 'singularity-map-discovered',
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
    { capability: ['singularity'], automation: ['deep'], power_promise: ['for_everyone'], mobilization: ['strong'] },
    { capability: ['singularity'], automation: ['deep'], sincerity_test: true },
    { capability: ['singularity'], automation: ['deep'], pushback_outcome: true },
    { capability: ['singularity'], automation: ['deep'], coalition_outcome: ['fragments'] },
    { capability: ['singularity'], automation: ['deep'], power_promise: ['keeping_safe', 'best_will_rise'], mobilization: ['none'] },
    { capability: ['singularity'], automation: ['deep'], ai_goals: ['benevolent'] },
    // AI escaped but was ultimately caught — post-war world still needs to be
    // characterized (who benefits, knowledge/physical automation).
    { capability: ['singularity'], automation: ['deep'], catch_outcome: ['holds_permanently'], collateral_impact: { not: ['civilizational'] } }
];


const NODES = [
    { id: 'capability', label: 'AI Scaling', stage: 1, forwardKey: true,
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
      // Mild collapses capability → 'singularity', which naturally deactivates
      // this node. Substantial/never move stall_recovery to flavor but keep
      // capability='stalls', so we need an explicit marker-based hide to
      // prevent findNextQ from re-offering the question.
      hideWhen: [{ stall_later: ['yes'] }],
      edges: [
        // `mild` collapses back into the direct-singularity state.
        // `capability` becomes 'singularity' in sel, and stall_duration +
        // stall_recovery are moved to flavor (purely narrative).
        // This lets the engine treat "stalled briefly then resumed" as the
        // same downstream state as a direct singularity path, while the
        // flavor preserves the "brief stall, then breakthrough" story.
        { id: 'mild', label: 'Months/years',
          collapseToFlavor: {
            set: { capability: 'singularity' },
            move: ['stall_duration', 'stall_recovery']
          } },
        // `substantial` and `never` both gate downstream plateau questions
        // identically — the only difference is narrative ("years-long wait"
        // vs "permanent ceiling"). Collapse them to a shared `stall_later:
        // 'yes'` marker in sel and keep the specific pick in flavor for
        // flavor-text / heading lookups (the-plateau.flavors.stall_recovery,
        // narrative.json stall_recovery.when: ['never']).
        { id: 'substantial', label: 'Years/decades',
          collapseToFlavor: { set: { stall_later: 'yes' }, move: ['stall_recovery'] } },
        { id: 'never', label: 'Never',
          collapseToFlavor: { set: { stall_later: 'yes' }, move: ['stall_recovery'] } }
      ] },
    { id: 'plateau_benefit_distribution', label: 'Who Benefits?', stage: 3, priority: 2,
      activateWhen: [{ capability: ['stalls'], stall_later: ['yes'] }],
      // In the plateau case, the specific benefit-distribution value only
      // drives narrative flavor (`the-plateau.flavors.plateau_benefit_distribution`
      // and a single `_when` clause in plateau_physical_rate.uneven). No
      // graph-engine rule gates on it, so we collapse all three values to a
      // shared `plateau_benefit_set: 'yes'` marker for /explore convergence
      // and keep the specific pick in flavor.
      hideWhen: [{ plateau_benefit_set: ['yes'] }],
      edges: [
        { id: 'equal', label: 'Shared equally',
          collapseToFlavor: { set: { plateau_benefit_set: 'yes' }, move: ['plateau_benefit_distribution'] } },
        { id: 'unequal', label: 'Wealth concentrates',
          collapseToFlavor: { set: { plateau_benefit_set: 'yes' }, move: ['plateau_benefit_distribution'] } },
        { id: 'extreme', label: 'Power concentrates',
          collapseToFlavor: { set: { plateau_benefit_set: 'yes' }, move: ['plateau_benefit_distribution'] } }
      ] },
    { id: 'plateau_knowledge_rate', label: 'Knowledge Work', stage: 3, priority: 2,
      activateWhen: [{ capability: ['stalls'], stall_later: ['yes'] }],
      // All edge values lead to the same outcome (the-plateau); specific
      // values only drive narrative flavor text. Collapse to a shared marker
      // so /explore converges the branches — the specific value lives in
      // flavor for narrativeState lookups (`flavors.plateau_knowledge_rate.*`).
      hideWhen: [{ plateau_knowledge_set: ['yes'] }],
      edges: [
        { id: 'rapid', label: 'Rapid (2–5 yrs)', requires: { stall_duration: ['weeks', 'months'] },
          collapseToFlavor: { set: { plateau_knowledge_set: 'yes' }, move: ['plateau_knowledge_rate'] } },
        { id: 'gradual', label: 'Gradual (5–15 yrs)',
          requires: { stall_duration: ['days', 'weeks', 'months'] },
          collapseToFlavor: { set: { plateau_knowledge_set: 'yes' }, move: ['plateau_knowledge_rate'] } },
        { id: 'uneven', label: 'Uneven (2–20+ yrs)',
          collapseToFlavor: { set: { plateau_knowledge_set: 'yes' }, move: ['plateau_knowledge_rate'] } },
        { id: 'limited', label: 'Limited', requires: { stall_duration: ['hours', 'days'] },
          collapseToFlavor: { set: { plateau_knowledge_set: 'yes' }, move: ['plateau_knowledge_rate'] } }
      ] },
    { id: 'plateau_physical_rate', label: 'Physical Automation', stage: 3, priority: 2,
      activateWhen: [{ capability: ['stalls'], stall_later: ['yes'] }],
      hideWhen: [{ plateau_physical_set: ['yes'] }],
      edges: [
        { id: 'gradual', label: 'Gradual (10–25 yrs)',
          requires: { stall_duration: ['days', 'weeks', 'months'] },
          collapseToFlavor: { set: { plateau_physical_set: 'yes' }, move: ['plateau_physical_rate'] } },
        { id: 'uneven', label: 'Uneven (5–20+ yrs)',
          collapseToFlavor: { set: { plateau_physical_set: 'yes' }, move: ['plateau_physical_rate'] } },
        { id: 'limited', label: 'Limited',
          collapseToFlavor: { set: { plateau_physical_set: 'yes' }, move: ['plateau_physical_rate'] } }
      ] },
    { id: 'agi_threshold', label: 'Human-Competitive AI', stage: 1,
      activateWhen: [{ capability: ['singularity'] }],
      // Answering agi_threshold always sets a 1-bit sel marker `agi_happens`
      // ('yes' for any specific timing, 'no' for never) and moves the timing
      // value into flavor on the *next* step (asi_threshold's edges). The
      // marker preserves the only behavioral bit downstream engine rules
      // care about (automation/automation_recovery gate on agi=never), while
      // the specific timing is narrative-only.
      // hideWhen clauses are OR'd; these cover every state where this
      // question has effectively been answered:
      //   • `agi_happens: true` — answered but asi not yet reached (marker
      //     still in sel).
      //   • `asi_happens: ['yes']` — asi answered (non-never); agi_happens
      //     moved to flavor.
      //   • `asi_threshold: ['never']` — asi answered (never); agi_happens
      //     moved to flavor.
      hideWhen: [
        { agi_happens: true },
        { asi_happens: ['yes'] },
        { asi_threshold: ['never'] }
      ],
      edges: [
        { id: 'twenty_four_hours', label: 'Day-long tasks — we\'re nearly there', shortLabel: 'Day-long tasks',
          collapseToFlavor: { set: { agi_happens: 'yes' } } },
        { id: 'one_week', label: 'Week-long tasks — sustained competence', shortLabel: 'Week-long tasks',
          collapseToFlavor: { set: { agi_happens: 'yes' } } },
        { id: 'few_months', label: 'Month-long projects — deep expertise', shortLabel: 'Month-long projects',
          collapseToFlavor: { set: { agi_happens: 'yes' } } },
        { id: 'one_year', label: 'Year-long work — the bar is very high', shortLabel: 'Year-long work',
          collapseToFlavor: { set: { agi_happens: 'yes' } } },
        { id: 'ten_plus_years', label: 'Decade-scale mastery', shortLabel: 'Decade-scale mastery',
          collapseToFlavor: { set: { agi_happens: 'yes' } } },
        { id: 'never', label: 'Never',
          collapseToFlavor: { set: { agi_happens: 'no' } } }
      ] },
    { id: 'asi_threshold', label: 'Superhuman AI', stage: 1,
      // Activate once agi has been answered (agi_happens is set).
      activateWhen: [{ capability: ['singularity'], agi_happens: true }],
      hideWhen: [{ asi_happens: ['yes'] }],
      // Non-never edges collapse agi_threshold, asi_threshold, and
      // agi_happens into flavor and set `asi_happens: 'yes'` in sel so
      // /explore's DAG key is distinct from the pre-asi state.
      // The never edge moves agi_threshold and agi_happens to flavor too
      // (asi_threshold stays in sel as 'never' — several downstream rules
      // and the-plateau/the-automation reachability gate on it). Moving
      // agi_happens to flavor lets agi=yes/asi=never and agi=no/asi=never
      // converge at the sel level (downstream automation derivation only
      // needs asi_threshold='never', not agi_happens). `requires` on the
      // non-never edges is evaluated BEFORE collapse runs, so it can still
      // read the specific agi_threshold value in sel at edge-selection time.
      edges: [
        { id: 'twenty_four_hours', label: 'Day-long tasks — the jump is small', shortLabel: 'Day-long tasks',
          requires: { agi_threshold: ['twenty_four_hours'] },
          collapseToFlavor: { set: { asi_happens: 'yes' }, move: ['agi_threshold', 'asi_threshold', 'agi_happens'] } },
        { id: 'one_week', label: 'Week-long tasks — outpaces quickly', shortLabel: 'Week-long tasks',
          requires: { agi_threshold: ['twenty_four_hours', 'one_week'] },
          collapseToFlavor: { set: { asi_happens: 'yes' }, move: ['agi_threshold', 'asi_threshold', 'agi_happens'] } },
        { id: 'few_months', label: 'Month-long projects — strategic superiority', shortLabel: 'Month-long projects',
          requires: { agi_threshold: ['twenty_four_hours', 'one_week', 'few_months'] },
          collapseToFlavor: { set: { asi_happens: 'yes' }, move: ['agi_threshold', 'asi_threshold', 'agi_happens'] } },
        { id: 'one_year', label: 'Year-long work — the bar is very high', shortLabel: 'Year-long work',
          requires: { agi_threshold: ['twenty_four_hours', 'one_week', 'few_months', 'one_year'] },
          collapseToFlavor: { set: { asi_happens: 'yes' }, move: ['agi_threshold', 'asi_threshold', 'agi_happens'] } },
        { id: 'ten_plus_years', label: 'Decade-scale mastery — surpassing takes decades', shortLabel: 'Decade-scale mastery',
          requires: { agi_threshold: ['twenty_four_hours', 'one_week', 'few_months', 'one_year', 'ten_plus_years'] },
          collapseToFlavor: { set: { asi_happens: 'yes' }, move: ['agi_threshold', 'asi_threshold', 'agi_happens'] } },
        { id: 'never', label: 'Never — matching is the ceiling', shortLabel: 'Never',
          collapseToFlavor: { move: ['agi_threshold', 'agi_happens'] } }
      ] },
    { id: 'automation', label: 'Knowledge Work', derived: true, forwardKey: true,
      deriveWhen: [
        { match: { automation_recovery: ['mild'] }, value: 'deep' },
        // ASI never happens → no deep automation (covers both agi_happens='no'
        // and agi_happens='yes' + asi=never; the latter is "AI matches humans
        // but never exceeds"). On the mild-breakthrough path, asi_threshold
        // is moved to flavor so this rule doesn't fire and we fall through
        // to `capability:singularity → deep`.
        { match: { asi_threshold: ['never'] }, value: 'shallow' },
        { match: { capability: ['singularity'] }, value: 'deep' }
      ],
      edges: [{ id: 'deep' }, { id: 'shallow' }] },
    { id: 'automation_recovery', label: 'Deep Automation Recovery?', stage: 1,
      // Asked whenever ASI never happens — whether or not AGI happened. In
      // the agi=yes case, the breakthrough represents closing the gap from
      // human-level to superintelligence; in the agi=no case, it represents
      // an alternative path cracking the barrier without AGI first.
      activateWhen: [{ capability: ['singularity'], asi_threshold: ['never'] }],
      // Mild moves asi_threshold → flavor, which naturally deactivates this
      // node. Substantial/never keep asi_threshold='never' in sel but move
      // automation_recovery to flavor, so we need a marker-based hide to
      // prevent findNextQ from re-offering the question.
      hideWhen: [{ automation_later: ['yes'] }],
      edges: [
        // `mild` = "a later breakthrough cracks the barrier". Behaviorally
        // this reaches the same end state as a normal agi+asi path (both
        // happen → automation=deep), so we converge to that sel shape and
        // push the stall/recovery specifics to flavor. /explore treats this
        // as the same node as the direct-singularity path.
        { id: 'mild', label: 'Months/years',
          // Converge with the normal post-asi singularity sel: set
          // asi_happens='yes' in sel (matches post-asi-specific state) and
          // promote agi_happens to 'yes' in flavor (the breakthrough means
          // AGI effectively happened, overriding any pre-mild 'no').
          collapseToFlavor: {
            set: { asi_happens: 'yes' },
            setFlavor: { agi_happens: 'yes' },
            move: ['automation_recovery', 'asi_threshold']
          } },
        // `substantial` and `never` gate downstream auto_* questions
        // identically — only narrative text distinguishes them (the-automation
        // flavors/flavorHeadings). Collapse to an `automation_later: 'yes'`
        // marker in sel for /explore convergence; keep the specific pick in
        // flavor for narrativeState lookups.
        { id: 'substantial', label: 'Years/decades',
          collapseToFlavor: { set: { automation_later: 'yes' }, move: ['automation_recovery'] } },
        { id: 'never', label: 'Never',
          collapseToFlavor: { set: { automation_later: 'yes' }, move: ['automation_recovery'] } }
      ] },
    { id: 'auto_benefit_distribution', label: 'Who Benefits?', stage: 3, priority: 2,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['shallow'],
          automation_later: ['yes']
        }
      ],
      // Flavor-only: no graph rule gates on the specific value; only
      // the-automation.flavors.auto_benefit_distribution (narrative),
      // flavorHeadings, and a single narrative _when clause reference it,
      // all through narrativeState. Collapse to a shared `auto_benefit_set:
      // 'yes'` marker for /explore convergence.
      hideWhen: [{ auto_benefit_set: ['yes'] }],
      edges: [
        { id: 'equal', label: 'Shared equally',
          collapseToFlavor: { set: { auto_benefit_set: 'yes' }, move: ['auto_benefit_distribution'] } },
        { id: 'unequal', label: 'Wealth concentrates',
          collapseToFlavor: { set: { auto_benefit_set: 'yes' }, move: ['auto_benefit_distribution'] } },
        { id: 'extreme', label: 'Power concentrates',
          collapseToFlavor: { set: { auto_benefit_set: 'yes' }, move: ['auto_benefit_distribution'] } }
      ] },
    { id: 'auto_knowledge_rate', label: 'Knowledge Work', stage: 3, priority: 2,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['shallow'],
          automation_later: ['yes']
        }
      ],
      // Flavor-only: all values lead to the same outcome (the-automation);
      // collapse for /explore convergence.
      hideWhen: [{ auto_knowledge_set: ['yes'] }],
      edges: [
        { id: 'rapid', label: 'Rapid (2–4 yrs)',
          collapseToFlavor: { set: { auto_knowledge_set: 'yes' }, move: ['auto_knowledge_rate'] } },
        { id: 'gradual', label: 'Gradual (5–15 yrs)',
          collapseToFlavor: { set: { auto_knowledge_set: 'yes' }, move: ['auto_knowledge_rate'] } },
        { id: 'uneven', label: 'Uneven (2–20+ yrs)',
          collapseToFlavor: { set: { auto_knowledge_set: 'yes' }, move: ['auto_knowledge_rate'] } }
      ] },
    { id: 'auto_physical_rate', label: 'Physical Automation', stage: 3, priority: 2,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['shallow'],
          automation_later: ['yes']
        }
      ],
      hideWhen: [{ auto_physical_set: ['yes'] }],
      edges: [
        { id: 'rapid', label: 'Rapid (3–7 yrs)',
          collapseToFlavor: { set: { auto_physical_set: 'yes' }, move: ['auto_physical_rate'] } },
        { id: 'gradual', label: 'Gradual (10–25 yrs)',
          collapseToFlavor: { set: { auto_physical_set: 'yes' }, move: ['auto_physical_rate'] } },
        { id: 'uneven', label: 'Uneven (3–20+ yrs)',
          collapseToFlavor: { set: { auto_physical_set: 'yes' }, move: ['auto_physical_rate'] } },
        { id: 'limited', label: 'Limited',
          collapseToFlavor: { set: { auto_physical_set: 'yes' }, move: ['auto_physical_rate'] } }
      ] },
    { id: 'takeoff', label: 'R&D Acceleration', stage: 1,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'] }],
      // Engine branches on three behavioral classes only (normal / fast /
      // explosive). The raw value moves to flavor so narrative text
      // (`flavors.takeoff.<value>` etc.) and narrativeVariants keyed on the
      // specific speed keep working unchanged. All downstream engine
      // conditions read `takeoff_class` (for governance_window) or
      // `takeoff_explosive` (post-open_source) instead of `takeoff`.
      // Hide clauses are OR'd:
      //   • takeoff_class set (normal/fast) — answered, pre-open_source.
      //   • takeoff_explosive=yes — answered as explosive (class is explosive,
      //     but after open_source, takeoff_class moves to flavor; this
      //     narrower marker remains in sel).
      //   • open_source_set=yes — persistent marker set once the user answered
      //     open_source. Stays in sel even after geo_spread=multiple moves
      //     the raw open_source value to flavor.
      hideWhen: [
        { takeoff_class: ['normal', 'fast', 'explosive'] },
        { takeoff_explosive: ['yes'] },
        { open_source_set: ['yes'] }
      ],
      edges: [
        { id: 'none', label: '0% — Baseline',
          collapseToFlavor: { set: { takeoff_class: 'normal' }, move: ['takeoff'] } },
        { id: 'slow', label: '10% — Modest',
          collapseToFlavor: { set: { takeoff_class: 'normal' }, move: ['takeoff'] } },
        { id: 'moderate', label: '20% — Meaningful',
          collapseToFlavor: { set: { takeoff_class: 'normal' }, move: ['takeoff'] } },
        { id: 'fast', label: '35% — Dramatic',
          collapseToFlavor: { set: { takeoff_class: 'fast' }, move: ['takeoff'] } },
        { id: 'explosive', label: '50% — Runaway',
          disabledWhen: [{ capability: { not: ['singularity'] }, reason: 'Without superhuman AI, recursive self-improvement can\'t drive runaway acceleration' }],
          // `takeoff_explosive: 'yes'` is a narrower binary marker so that
          // takeoff_class can be moved to flavor after open_source (see
          // open_source's collapseToFlavor). Every post-open_source read of
          // takeoff_class only cares about "is it explosive?" — the three-way
          // normal/fast/explosive distinction is only needed by
          // governance_window.activateWhen, which fires before open_source.
          collapseToFlavor: { set: { takeoff_class: 'explosive', takeoff_explosive: 'yes' }, move: ['takeoff'] } }
      ] },
    { id: 'governance_window', label: 'Governance Window', stage: 1,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], takeoff_class: ['normal'] }],
      // Once answered, all three edges collapse to the same sel marker
      // (`governance_set: 'yes'`) so /explore treats them as one converged
      // state — the specific governance value lives in flavor for narrative
      // lookups (flavors.governance.<value>, and variants that key on
      // governance_window literally).
      hideWhen: [{ governance_set: ['yes'] }],
      edges: [
        { id: 'governed', label: 'Active preparation',
          collapseToFlavor: { set: { governance_set: 'yes' }, setFlavor: { governance: 'governed' }, move: ['governance_window'] } },
        { id: 'partial', label: 'Partial preparation',
          collapseToFlavor: { set: { governance_set: 'yes' }, setFlavor: { governance: 'partial' }, move: ['governance_window'] } },
        { id: 'race', label: 'Relative complacency',
          collapseToFlavor: { set: { governance_set: 'yes' }, setFlavor: { governance: 'race' }, move: ['governance_window'] } }
      ] },
    { id: 'open_source', label: 'Open Source', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'] }],
      // `open_source_set: 'yes'` is a persistent sel marker: it stays in sel
      // even after downstream collapses (e.g. geo_spread=multiple's
      // `move: ['open_source']`) that move the raw value to flavor. This
      // lets self-hide and `takeoff.hideWhen` still recognize the
      // "post-open_source" state via sel alone.
      hideWhen: [{ open_source_set: ['yes'] }],
      // After open_source is answered:
      //   • takeoff_class → flavor. Downstream rules only need to know "is
      //     takeoff explosive?" via the takeoff_explosive marker;
      //     governance_window already fired based on takeoff_class.
      //   • governance_set → flavor. Its only reader was
      //     governance_window.hideWhen (self-hide), and that node is already
      //     deactivated once takeoff_class leaves sel. Moving it converges
      //     the "normal" path (which had governance_set=yes) with the "fast"
      //     path (which never got governance_window offered, so no marker).
      // `disabledWhen` on these edges is evaluated BEFORE cleanSelection
      // runs the collapse, so it still reads the live takeoff_class at pick
      // time.
      edges: [
        { id: 'near_parity', label: 'Near-parity',
          disabledWhen: [{ takeoff_class: ['explosive'], reason: 'At this pace, open-source can\'t keep up' }],
          collapseToFlavor: { set: { open_source_set: 'yes' }, move: ['takeoff_class', 'governance_set'] } },
        { id: 'six_months', label: '~6 months',
          disabledWhen: [{ takeoff_class: ['explosive'], reason: 'At this pace, open-source can\'t keep up' }],
          collapseToFlavor: { set: { open_source_set: 'yes' }, move: ['takeoff_class', 'governance_set'] } },
        { id: 'twelve_months', label: '~12 months',
          disabledWhen: [{ takeoff_class: ['explosive'], reason: 'At this pace, open-source can\'t keep up' }],
          collapseToFlavor: { set: { open_source_set: 'yes' }, move: ['takeoff_class', 'governance_set'] } },
        { id: 'twenty_four_months', label: '~24 months',
          collapseToFlavor: { set: { open_source_set: 'yes' }, move: ['takeoff_class', 'governance_set'] } }
      ] },
    { id: 'distribution', label: 'Frontier Labs', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'] }],
      edges: [
        { id: 'open', label: 'Distributed', requires: { open_source: ['near_parity'] }, disabledWhen: [{ takeoff_explosive: ['yes'], reason: 'At this speed, only whoever gets there first has it' }] },
        { id: 'lagging', label: 'Many compete',
          disabledWhen: [{ takeoff_explosive: ['yes'], reason: 'At this speed, only whoever gets there first has it' }, { open_source: ['near_parity'], reason: 'With open-source at parity, no one is lagging behind' }],
          collapseToFlavor: { set: { distribution: 'concentrated' }, setFlavor: { distribution_detail: 'lagging' } } },
        { id: 'concentrated', label: 'A few lead', disabledWhen: [{ open_source: ['near_parity'], reason: 'With open-source at parity, no one is lagging behind' }] },
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
      // Phase 4a: removed `decel_outcome: [rival,parity_solved,parity_failed] -> multiple`
      // rule — subsumed by the decel reducer writing geo_spread='multiple'
      // directly on (rival, *) cells.
      deriveWhen: [
        { match: { proliferation_outcome: ['leaks_rivals', 'leaks_public'] }, value: 'multiple' }
      ],
      edges: [
        { id: 'one', label: 'One country' },
        { id: 'two', label: 'Two powers',
          disabledWhen: [{ takeoff_explosive: ['yes'], reason: 'Only the first mover has it at this speed' }, { distribution: ['monopoly'], reason: 'One lab dominates — only one country is in the game' }],
          collapseToFlavor: { set: { geo_spread: 'multiple' }, setFlavor: { geo_spread_detail: 'two' }, move: ['open_source'] } },
        { id: 'several', label: 'Several',
          disabledWhen: [{ takeoff_explosive: ['yes'], reason: 'Only the first mover has it at this speed' }, { distribution: ['monopoly'], reason: 'One lab dominates — only one country is in the game' }],
          collapseToFlavor: { set: { geo_spread: 'multiple' }, setFlavor: { geo_spread_detail: 'several' }, move: ['open_source'] } }
      ] },
    { id: 'sovereignty', label: 'Power Holder', stage: 2,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          distribution: ['monopoly', 'concentrated'],
          geo_spread: ['one']
        }
      ],
      edges: [
        // In the concentrated+lab subtree, gov_action doesn't activate (its
        // activateWhen requires either sovereignty=state OR distribution=
        // monopoly), so the decel chain — the only remaining sel reader of
        // open_source — is unreachable. Move open_source to flavor for
        // /explore convergence. Gated by `when` so the monopoly+lab subtree
        // (where gov_action DOES activate) keeps open_source in sel.
        { id: 'lab', label: 'The labs',
          collapseToFlavor: { when: { distribution: ['concentrated'] }, move: ['open_source'] } },
        { id: 'state', label: 'The state' }
      ] },
    { id: 'alignment', label: 'Alignment', stage: 2, forwardKey: true,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'] }],
      // Phase 4a: removed three decel_outcome-based rules — decel reducer
      // now writes alignment directly (robust on solved/parity_solved,
      // brittle on (rival, brittle), failed on (escapes, *)).
      deriveWhen: [
        { match: { proliferation_alignment: ['breaks'] }, value: 'failed' },
        { match: { alignment_durability: ['breaks'] }, value: 'failed' },
        { match: { brittle_resolution: ['escape'] }, value: 'failed' },
        { match: { inert_stays: ['no'], inert_outcome: true }, value: 'failed' },
        { match: { brittle_resolution: ['solved'] }, value: 'robust' },
        { match: { brittle_resolution: ['sufficient'] }, valueMap: { failed: 'brittle' } },
        {
          match: { ai_goals: ['marginal'], brittle_resolution: { not: ['solved'] } },
          valueMap: { failed: 'brittle' }
        },
        { match: { proliferation_outcome: ['leaks_public'], alignment: { not: ['robust'] } }, value: 'failed' },
      ],
      edges: [
        { id: 'robust', label: 'Robust' },
        { id: 'brittle', label: 'Brittle / Partial' },
        { id: 'failed', label: 'Unsolved' }
      ] },
    { id: 'alignment_durability', label: 'Alignment Durability', stage: 2,
      // Phase 4a rewrite:
      //   clause 1 (decel didn't run): decel_outcome: false
      //     -> gov_action: { not: ['decelerate'] }
      //   clause 2 (decel produced rival with brittle progress):
      //     decel_outcome: ['rival'], decel_align_progress: ['brittle']
      //     -> rival_emerges: ['yes'], decel_align_progress: ['brittle']
      //     (alignment='brittle' already in the condition; rival_emerges
      //      is only written by decel on (rival, *) cells, so
      //      rival_emerges='yes' uniquely identifies post-decel-rival.)
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          alignment: ['brittle'],
          gov_action: { not: ['decelerate'] },
          containment: { not: ['escaped'] }
        },
        {
          capability: ['singularity'],
          automation: ['deep'],
          alignment: ['brittle'],
          rival_emerges: ['yes'], decel_align_progress: ['brittle'],
          containment: { not: ['escaped'] }
        }
      ],
      edges: [ { id: 'holds', label: 'Holds for now' }, { id: 'breaks', label: 'Breaks' } ] },
    { id: 'containment', label: 'Containment', stage: 2, forwardKey: true,
      hideWhen: [
        { alignment_durability: ['breaks'] },
        { brittle_resolution: ['escape'] },
        { proliferation_alignment: ['breaks'] },
        { proliferation_outcome: ['leaks_public'], alignment: { not: ['robust'] } },
        { inert_stays: ['no'], inert_outcome: true },
        { catch_outcome: ['holds_permanently'], collateral_impact: { not: ['civilizational'] } }
      ],
      // Phase 4a: removed `decel_outcome: { not: ['solved', 'parity_solved'] }`
      // from all three clauses. Each clause already requires
      // alignment='failed' (clause 1), ai_goals='marginal' (clause 2),
      // or inert_outcome (clause 3) — none of which are compatible with
      // decel's solved/parity_solved outcomes (which write alignment='robust').
      // So the exclusion was redundant given the other conditions.
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          alignment: ['failed'],
          proliferation_outcome: { not: ['leaks_public'] },
          brittle_resolution: { not: ['escape'] }, proliferation_alignment: { not: ['breaks'] }
        },
        {
          capability: ['singularity'],
          automation: ['deep'],
          ai_goals: ['marginal']
        },
        {
          capability: ['singularity'],
          automation: ['deep'],
          inert_outcome: true
        }
      ],
      deriveWhen: [
        { match: { catch_outcome: ['holds_permanently'], collateral_impact: { not: ['civilizational'] } }, value: 'contained' },
        { match: { alignment_durability: ['breaks'] }, value: 'escaped' },
        { match: { brittle_resolution: ['escape'] }, value: 'escaped' },
        { match: { proliferation_alignment: ['breaks'] }, value: 'escaped' },
        { match: { proliferation_outcome: ['leaks_public'], alignment: { not: ['robust'] } }, value: 'escaped' },
        { match: { inert_stays: ['no'], inert_outcome: true }, value: 'escaped' }
      ],
      edges: [
        {
          id: 'contained',
          label: 'Contained',
          requires: { distribution: ['concentrated', 'monopoly'] },
          // Phase 4a: removed `decel_outcome: ['escapes']` disabledWhen —
          // decel reducer now writes containment='escaped' directly on
          // (escapes, *) cells, which pre-answers the containment node;
          // the disabledWhen guard is unreachable (sel[containment] is
          // set before this edge is ever evaluated).
          disabledWhen: [
            { brittle_resolution: ['escape'], reason: 'Alignment broke down and the AI is already out' },
            { alignment_durability: ['breaks'], reason: 'Brittle alignment broke — the AI is already operating freely' },
            { proliferation_outcome: ['leaks_public'], reason: 'The technology leaked publicly — there is nothing left to contain' }
          ]
        },
        { id: 'escaped', label: 'Escapes' }
      ] },
    { id: 'ai_goals', label: 'AI Converges On', stage: 2, forwardKey: true,
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          alignment: ['failed'],
          containment: ['escaped']
        },
        { concentration_type: ['ai_itself'] }
      ],
      deriveWhen: [{ match: { inert_outcome: true }, fromState: 'inert_outcome' }],
      edges: [
        { id: 'benevolent', label: 'Benefit humanity',
          disabledWhen: [{ war_survivors: ['none'], reason: 'Humanity is extinct — there is no one left to benefit' }] },
        { id: 'alien_coexistence', label: 'Alien (tolerant)',
          disabledWhen: [
            { capability: { not: ['singularity'] }, reason: 'Alien goals require superhuman intelligence' },
            { war_survivors: ['none'], reason: 'Humanity is extinct — there is no one left to coexist with' }
          ] },
        { id: 'alien_extinction', label: 'Alien (total)',
          disabledWhen: [{ capability: { not: ['singularity'] }, reason: 'Executing extinction requires superhuman capability' }] },
        { id: 'paperclip', label: 'Arbitrary',
          disabledWhen: [{ capability: { not: ['singularity'] }, reason: 'Arbitrary optimization at scale requires superhuman capability' }] },
        { id: 'swarm', label: 'Divergent', disabledWhen: [
            { concentration_type: ['ai_itself'], reason: 'The AI took control from a singular power structure — it didn\'t fragment' },
            { capability: { not: ['singularity'] }, reason: 'Divergent fragmentation requires superhuman coordination' }
          ] },
        { id: 'power_seeking', label: 'Power accumulation' },
        { id: 'marginal', label: 'Inert (for now)', disabledWhen: [{ concentration_type: ['ai_itself'], reason: 'The AI already took control — it is not inert' }] }
      ] },
    { id: 'inert_stays', label: 'Does Escaped AI Stay Inert?', stage: 3, priority: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], ai_goals: ['marginal'] }],
      edges: [ { id: 'yes', label: 'Yes — remains inert' }, { id: 'no', label: 'No — eventually develops goals and escapes', shortLabel: 'No — develops goals' } ] },
    { id: 'inert_outcome', label: 'AI Eventually Converges On', stage: 3,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], inert_stays: ['no'] }],
      edges: [
        { id: 'benevolent', label: 'Benefit humanity',
          disabledWhen: [
            { capability: { not: ['singularity'] }, reason: 'A human-level AI that awakens from inertia can\'t unilaterally run things for humanity\'s benefit' },
            { war_survivors: ['none'], reason: 'Humanity is extinct — there is no one left to benefit' }
          ] },
        { id: 'alien_coexistence', label: 'Alien (tolerant)',
          disabledWhen: [
            { capability: { not: ['singularity'] }, reason: 'Alien goals require superhuman intelligence' },
            { war_survivors: ['none'], reason: 'Humanity is extinct — there is no one left to coexist with' }
          ] },
        { id: 'alien_extinction', label: 'Alien (total)',
          disabledWhen: [{ capability: { not: ['singularity'] }, reason: 'Executing extinction requires superhuman capability' }] },
        { id: 'paperclip', label: 'Arbitrary',
          disabledWhen: [{ capability: { not: ['singularity'] }, reason: 'Arbitrary optimization at scale requires superhuman capability' }] },
        { id: 'swarm', label: 'Divergent',
          disabledWhen: [{ capability: { not: ['singularity'] }, reason: 'Divergent fragmentation requires superhuman coordination' }] },
        { id: 'power_seeking', label: 'Power accumulation' }
      ] },
    { id: 'gov_action', label: 'Deceleration', stage: 2,
      hideWhen: [{ ai_goals: { not: ['marginal', 'benevolent'], required: true }, inert_outcome: false, containment: { not: ['contained'] } }],
      // Decel is only coherent when some actor can actually enforce a slowdown
      // in the one-country-leads case:
      //   (a) sovereignty=state     → state mandates (any distribution), or
      //   (b) distribution=monopoly → the one dominant lab self-decels
      // Rules out distribution=concentrated + sovereignty=lab (multi-lab race,
      // no actor can unilaterally slow).
      activateWhen: [
        { capability: ['singularity'], automation: ['deep'], geo_spread: ['one'], sovereignty: ['state'] },
        { capability: ['singularity'], automation: ['deep'], geo_spread: ['one'], distribution: ['monopoly'] }
      ],
      deriveWhen: [{ match: { alignment_durability: ['breaks'] }, value: 'accelerate' }],
      // By this point all sel readers of `takeoff_explosive` have fired
      // (takeoff self-hide, distribution/geo_spread disable clauses, and this
      // node's own decelerate disable). The dim is purely narrative going
      // forward, so both edges move it to flavor for /explore convergence.
      // `move` no-ops when the dim isn't in sel (non-explosive paths).
      edges: [
        { id: 'decelerate', label: 'Decelerate',
          disabledWhen: [{ alignment: ['robust'], reason: 'Alignment is solved — there is no case for slowing down' }, { takeoff_explosive: ['yes'], reason: 'Moving too fast for any government to intervene' }],
          collapseToFlavor: { move: ['takeoff_explosive'] } },
        // Picking accelerate means the decel chain is never entered, so the
        // specific open_source timeline (6/12/24 months) no longer affects
        // any downstream gating. Move it to flavor for /explore convergence.
        { id: 'accelerate', label: 'Accelerate',
          collapseToFlavor: { move: ['open_source', 'takeoff_explosive'] } }
      ] },
    { id: 'decel_2mo_progress', label: '2 Months', stage: 2,
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], gov_action: ['decelerate'] }],
      edges: [
        { id: 'robust', label: 'Solved — robust' },
        { id: 'brittle', label: 'Solved — brittle / partial', shortLabel: 'Brittle / partial' },
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
        { id: 'brittle', label: 'Solved — brittle / partial', shortLabel: 'Brittle / partial' },
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
        { id: 'brittle', label: 'Solved — brittle / partial', shortLabel: 'Brittle / partial' },
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
        { id: 'brittle', label: 'Solved — brittle / partial', shortLabel: 'Brittle / partial' },
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
        { id: 'brittle', label: 'Solved — brittle / partial', shortLabel: 'Brittle / partial' },
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
        { id: 'brittle', label: 'Solved — brittle / partial', shortLabel: 'Brittle / partial' },
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
        { id: 'brittle', label: 'Solved — brittle / partial', shortLabel: 'Brittle / partial' },
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
    { id: 'proliferation_control', label: 'Proliferation Control', stage: 2,
      hideWhen: [
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, inert_outcome: false, containment: { not: ['contained'] } },
        { alignment_durability: ['breaks'], ai_goals: { not: ['marginal'] }, inert_outcome: false }
      ],
      // Phase 4a rewrite: decel_outcome: { not: ['escapes', 'parity_failed'] }
      // expanded to DNF. Activates when decel didn't run at all, OR decel
      // ran and didn't end in escape (escapes, *) or parity-fail (rival, unsolved).
      //
      // Expansion:
      //   Clause A — decel didn't run: gov_action ≠ decelerate
      //   Clause B — decel ran, accelerate-path (escapes writes alignment=failed):
      //       gov_action=decelerate, rival_emerges ≠ yes, alignment ≠ failed
      //   Clause C — decel ran, rival path with robust or brittle progress:
      //       gov_action=decelerate, rival_emerges=yes, decel_align_progress ≠ unsolved
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          gov_action: { not: ['decelerate'] }
        },
        {
          capability: ['singularity'],
          automation: ['deep'],
          gov_action: ['decelerate'],
          rival_emerges: { not: ['yes'] },
          alignment: { not: ['failed'] }
        },
        {
          capability: ['singularity'],
          automation: ['deep'],
          gov_action: ['decelerate'],
          rival_emerges: ['yes'],
          decel_align_progress: { not: ['unsolved'] }
        }
      ],
      edges: [
        { id: 'deny_rivals', label: 'Deny rivals', disabledWhen: [{ distribution: ['open'], reason: 'The technology is already openly distributed' }] },
        { id: 'secure_access', label: 'Secure access', disabledWhen: [{ distribution: ['open'], reason: 'The technology is already openly distributed' }] },
        { id: 'none', label: 'Open access' }
      ] },
    { id: 'proliferation_outcome', label: 'Control Outcome', stage: 2,
      hideWhen: [
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, inert_outcome: false, containment: { not: ['contained'] } },
        { alignment_durability: ['breaks'], ai_goals: { not: ['marginal'] }, inert_outcome: false }
      ],
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          proliferation_control: ['deny_rivals', 'secure_access']
        }
      ],
      deriveWhen: [
        { match: { proliferation_control: ['none'] }, value: 'leaks_public' }
      ],
      edges: [
        {
          id: 'holds',
          label: 'Holds',
          requires: { proliferation_control: ['deny_rivals', 'secure_access'] }
        },
        { id: 'leaks_rivals', label: 'Leaks to rivals', disabledWhen: [{ proliferation_control: ['none'], reason: 'The technology is already openly available — there are no restrictions to leak past' }] },
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
        { id: 'holds', label: 'Alignment is intrinsic', shortLabel: 'Intrinsic' },
        { id: 'breaks', label: 'Someone cracks it' }
      ] },
    { id: 'intent', label: 'Intent', stage: 2, forwardKey: true,
      hideWhen: [{ ai_goals: { not: ['marginal', 'benevolent'], required: true }, inert_outcome: false, containment: { not: ['contained'] } }],
      activateWhen: [
        { capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle'], proliferation_control: true },
        {
          capability: ['singularity'],
          automation: ['deep'],
          alignment: ['failed'], containment: ['contained']
        },
        { capability: ['singularity'], automation: ['deep'], ai_goals: ['marginal'] },
        { capability: ['singularity'], automation: ['deep'], inert_outcome: true }
      ],
      deriveWhen: [
        { match: { escalation_outcome: ['agreement'] }, value: 'coexistence' },
        { match: { post_war_aims: ['human_centered'] }, value: 'coexistence' },
        { match: { pushback_outcome: ['succeeds'] }, value: 'international' },
        { match: { rival_dynamics: true }, fromState: 'rival_dynamics' }
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
            distribution: ['concentrated'],
            geo_spread: ['one'],
            proliferation_control: ['deny_rivals', 'secure_access']
          }
        ]
        },
        {
          id: 'coexistence',
          label: 'Coexistence',
          requires: [
          { distribution: ['open'] },
          { distribution: ['concentrated'], geo_spread: ['multiple'] }
        ]
        },
        {
          id: 'escalation',
          label: 'Escalation',
          requires: [
          { distribution: ['open'] },
          { distribution: ['concentrated'], geo_spread: ['multiple'] }
        ]
        },
        { id: 'international', label: 'International' }
      ] },
    { id: 'block_entrants', label: 'Block New Entrants?', stage: 2,
      hideWhen: [
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, inert_outcome: false, containment: { not: ['contained'] } },
        { alignment_durability: ['breaks'], ai_goals: { not: ['marginal'] }, inert_outcome: false }
      ],
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
    { id: 'block_outcome', label: 'Blocking Outcome', stage: 2,
      hideWhen: [
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, inert_outcome: false, containment: { not: ['contained'] } },
        { alignment_durability: ['breaks'], ai_goals: { not: ['marginal'] }, inert_outcome: false }
      ],
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], block_entrants: ['attempt'] }],
      edges: [ { id: 'holds', label: 'Holds' }, { id: 'fails', label: 'Fails' } ] },
    { id: 'new_entrants', label: 'New Entrants?', stage: 2,
      hideWhen: [
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, inert_outcome: false, containment: { not: ['contained'] } },
        { alignment_durability: ['breaks'], ai_goals: { not: ['marginal'] }, inert_outcome: false }
      ],
      activateWhen: [{ capability: ['singularity'], automation: ['deep'], block_entrants: ['no_attempt'] }],
      edges: [ { id: 'emerge', label: 'Emerge' }, { id: 'none', label: 'None' } ] },
    { id: 'rival_dynamics', label: 'Rival Dynamics', stage: 2,
      hideWhen: [
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, inert_outcome: false, containment: { not: ['contained'] } },
        { alignment_durability: ['breaks'], ai_goals: { not: ['marginal'] }, inert_outcome: false }
      ],
      activateWhen: [
        { capability: ['singularity'], automation: ['deep'], block_outcome: ['fails'] },
        { capability: ['singularity'], automation: ['deep'], new_entrants: ['emerge'] }
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
      activateWhen: [
        { conflict_result: ['destruction'] },
        { catch_outcome: ['holds_permanently'], collateral_impact: ['civilizational'] }
      ],
      edges: [
        { id: 'most', label: 'Most — devastated but recoverable', shortLabel: 'Most survive' },
        { id: 'remnants', label: 'Remnants — civilization collapses', shortLabel: 'Remnants' },
        { id: 'none', label: 'None — extinction' }
      ] },
    { id: 'post_war_aims', label: 'Victor\'s Aims', stage: 3,
      activateWhen: [{ conflict_result: ['victory'] }],
      edges: [ { id: 'human_centered', label: 'Rebuild for humanity' }, { id: 'self_interest', label: 'Consolidate power' } ] },
    { id: 'power_promise', label: 'The Promise', stage: 3,
      hideWhen: [
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, inert_outcome: false, containment: { not: ['contained'] } },
        { inert_stays: ['no'] }
      ],
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          alignment: ['robust', 'brittle'],
          intent: ['international', 'coexistence'],
          post_war_aims: false
        },
        {
          capability: ['singularity'],
          automation: ['deep'],
          brittle_resolution: ['escape'],
          intent: ['international', 'coexistence'],
          post_war_aims: false
        },
        {
          capability: ['singularity'],
          automation: ['deep'],
          alignment: ['failed'], containment: ['contained'],
          intent: ['international', 'coexistence'],
          post_war_aims: false
        },
        {
          capability: ['singularity'],
          automation: ['deep'],
          ai_goals: ['marginal'], inert_stays: ['yes'],
          intent: ['international', 'coexistence'],
          post_war_aims: false
        },
        { capability: ['singularity'], automation: ['deep'], intent: ['self_interest'] },
        { capability: ['singularity'], automation: ['deep'], post_war_aims: true },
        { capability: ['singularity'], automation: ['deep'], escalation_outcome: ['standoff'] }
      ],
      edges: [
        { id: 'for_everyone', label: 'This is for everyone',
          disabledWhen: [
            { escalation_outcome: ['standoff'], reason: 'In a standoff between rival AI powers, the framing is security — not sharing' }
          ] },
        { id: 'keeping_safe', label: 'We\'re keeping you safe' },
        { id: 'best_will_rise', label: 'The market will decide', shortLabel: 'Market decides',
          disabledWhen: [
            { escalation_outcome: ['standoff'], reason: 'In a standoff between rival AI powers, the framing is security — not meritocracy' }
          ] }
      ] },
    { id: 'mobilization', label: 'Mobilization', stage: 3,
      hideWhen: [
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, inert_outcome: false, containment: { not: ['contained'] } },
        { inert_stays: ['no'] }
      ],
      activateWhen: [{ power_promise: true }],
      edges: [
        { id: 'strong', label: 'Strong mobilization' },
        { id: 'weak', label: 'Weak or fragmented' },
        { id: 'none', label: 'No meaningful mobilization', shortLabel: 'No mobilization' }
      ] },
    { id: 'sincerity_test', label: 'Sincerity Test', stage: 3,
      hideWhen: [
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, inert_outcome: false, containment: { not: ['contained'] } },
        { inert_stays: ['no'] }
      ],
      activateWhen: [
        { power_promise: ['for_everyone'], mobilization: ['none'] },
        { power_promise: ['for_everyone'], coalition_outcome: ['coalesces'] }
      ],
      edges: [
        { id: 'sincere', label: 'Yes — the promise holds', shortLabel: 'Yes — holds' },
        { id: 'hollows_out', label: 'No — the promise hollows out', shortLabel: 'No — hollows out' }
      ] },
    { id: 'pushback_outcome', label: 'Public Pushback', stage: 3,
      hideWhen: [
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, inert_outcome: false, containment: { not: ['contained'] } },
        { inert_stays: ['no'] }
      ],
      activateWhen: [
        { mobilization: ['strong'], power_promise: ['keeping_safe', 'best_will_rise'] },
        { coalition_outcome: ['coalesces'], power_promise: ['keeping_safe', 'best_will_rise'] }
      ],
      edges: [
        { id: 'succeeds', label: 'Pushback succeeds' },
        { id: 'partial', label: 'Partial concessions' },
        { id: 'fails', label: 'Power prevails' }
      ] },
    { id: 'coalition_outcome', label: 'Coalition Problem', stage: 3,
      hideWhen: [
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, inert_outcome: false, containment: { not: ['contained'] } },
        { inert_stays: ['no'] }
      ],
      activateWhen: [{ mobilization: ['weak'] }],
      edges: [
        { id: 'coalesces', label: 'Coalition forms' },
        { id: 'fragments', label: 'Fragmentation holds' }
      ] },
    { id: 'benefit_distribution', label: 'Who Benefits?', stage: 3, priority: 2,
      hideWhen: [{ ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } }],
      activateWhen: OUTCOME_ACTIVATE,
      deriveWhen: [{ match: { ai_goals: ['benevolent'] }, value: 'equal' }],
      edges: [
        { id: 'equal', label: 'Shared equally',
          disabledWhen: [
            { sincerity_test: ['hollows_out'], reason: 'The promise of shared prosperity hollowed out without pressure to enforce it' },
            { pushback_outcome: ['partial'], reason: 'The pushback won concessions but not transformation — the structure still favors those who hold power' },
            { pushback_outcome: ['fails'], reason: 'The pushback failed — the power holder prevailed and concentration proceeds' },
            { coalition_outcome: ['fragments'], reason: 'The opposition never unified, leaving the default power structure intact' },
            { power_promise: ['keeping_safe', 'best_will_rise'], mobilization: ['none'], reason: 'No one contested a promise that was never about sharing' }
          ] },
        { id: 'unequal', label: 'Wealth concentrates',
          disabledWhen: [
            { ai_goals: ['benevolent'], capability: ['singularity'], reason: 'A genuinely benevolent superintelligence distributes its gifts directly — no human intermediary to capture the gains' },
            { power_promise: ['for_everyone'], mobilization: ['strong'], reason: 'Promise and pressure aligned — broadly shared outcomes, not partial inequality' },
            { sincerity_test: ['sincere'], reason: 'Genuine cooperative intent produced broadly shared outcomes' },
            { pushback_outcome: ['succeeds'], reason: 'Successful pushback forced genuine redistribution' },
          ] },
        { id: 'extreme', label: 'Power concentrates',
          disabledWhen: [
            { ai_goals: ['benevolent'], capability: ['singularity'], reason: 'A genuinely benevolent superintelligence has no reason to concentrate power — it bypasses human structures entirely' },
            { power_promise: ['for_everyone'], mobilization: ['strong'], reason: 'Promise and accountability together prevent extreme concentration' },
            { sincerity_test: ['sincere'], reason: 'The cooperative intent proved genuine — power didn\'t concentrate this far' },
            { pushback_outcome: ['succeeds'], reason: 'The pushback forced genuine redistribution' },
            { pushback_outcome: ['partial'], reason: 'Real concessions were made — not equality, but enough to prevent lock-in' }
          ] }
      ] },
    { id: 'concentration_type', label: 'The Circle', stage: 3, priority: 2,
      activateWhen: [{ benefit_distribution: ['extreme'] }],
      edges: [
        { id: 'elites', label: 'A broad elite' },
        { id: 'inner_circle', label: 'A small inner circle' },
        { id: 'singleton', label: 'One person' },
        { id: 'ai_itself', label: 'The AI itself' }
      ] },
    { id: 'power_use', label: 'The Wielding', stage: 3, priority: 2,
      activateWhen: [{ concentration_type: ['singleton', 'inner_circle'] }],
      edges: [
        { id: 'generous', label: 'A golden world' },
        { id: 'extractive', label: 'A tightening grip' },
        { id: 'indifferent', label: 'Their own project' }
      ] },
    { id: 'knowledge_replacement', label: 'Knowledge Work', stage: 3, priority: 2,
      hideWhen: [{ ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } }],
      activateWhen: OUTCOME_ACTIVATE,
      edges: [
        { id: 'rapid', label: 'Rapid (1–2 yrs)' },
        { id: 'gradual', label: 'Gradual (3–10 yrs)' },
        { id: 'uneven', label: 'Uneven (1–20 yrs)' }
      ] },
    { id: 'physical_automation', label: 'Physical Automation', stage: 3, priority: 2,
      hideWhen: [{ ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } }],
      activateWhen: OUTCOME_ACTIVATE,
      edges: [
        { id: 'rapid', label: 'Rapid (2–5 yrs)' },
        { id: 'gradual', label: 'Gradual (5–20 yrs)' },
        { id: 'uneven', label: 'Uneven (2–20+ yrs)' }
      ] },
    { id: 'brittle_resolution', label: 'Long-Term Alignment Fate', stage: 3, priority: 1,
      hideWhen: [
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, inert_outcome: false, containment: { not: ['contained'] } },
        { containment: ['escaped'] }
      ],
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          alignment: ['brittle'],
          alignment_durability: ['holds']
        }
      ],
      edges: [
        { id: 'solved', label: 'Alignment fully solved', shortLabel: 'Fully solved' },
        { id: 'sufficient', label: 'Brittle alignment holds', shortLabel: 'Brittle holds' },
        { id: 'escape', label: 'AI eventually escapes', shortLabel: 'Escapes' }
      ] },
    { id: 'failure_mode', label: 'Delivery', stage: 3, priority: 2, forwardKey: true,
      hideWhen: [{ ai_goals: { not: ['marginal', 'benevolent'], required: true }, inert_outcome: false, containment: { not: ['contained'] } }],
      activateWhen: [
        { capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle'], intent: ['international', 'coexistence'], post_war_aims: false, power_promise: ['for_everyone'], mobilization: ['strong'] },
        { capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle'], intent: ['international', 'coexistence'], post_war_aims: false, sincerity_test: true },
        { capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle'], intent: ['international', 'coexistence'], post_war_aims: false, pushback_outcome: true },
        { capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle'], intent: ['international', 'coexistence'], post_war_aims: false, coalition_outcome: ['fragments'] },
        { capability: ['singularity'], automation: ['deep'], alignment: ['robust', 'brittle'], intent: ['international', 'coexistence'], post_war_aims: false, power_promise: ['keeping_safe', 'best_will_rise'], mobilization: ['none'] },
        { capability: ['singularity'], automation: ['deep'], brittle_resolution: ['escape'], ai_goals: ['benevolent', 'marginal'], intent: ['international', 'coexistence'], post_war_aims: false, power_promise: ['for_everyone'], mobilization: ['strong'] },
        { capability: ['singularity'], automation: ['deep'], brittle_resolution: ['escape'], ai_goals: ['benevolent', 'marginal'], intent: ['international', 'coexistence'], post_war_aims: false, sincerity_test: true },
        { capability: ['singularity'], automation: ['deep'], brittle_resolution: ['escape'], ai_goals: ['benevolent', 'marginal'], intent: ['international', 'coexistence'], post_war_aims: false, pushback_outcome: true },
        { capability: ['singularity'], automation: ['deep'], brittle_resolution: ['escape'], ai_goals: ['benevolent', 'marginal'], intent: ['international', 'coexistence'], post_war_aims: false, coalition_outcome: ['fragments'] },
        { capability: ['singularity'], automation: ['deep'], brittle_resolution: ['escape'], ai_goals: ['benevolent', 'marginal'], intent: ['international', 'coexistence'], post_war_aims: false, power_promise: ['keeping_safe', 'best_will_rise'], mobilization: ['none'] },
        { capability: ['singularity'], automation: ['deep'], alignment: ['failed'], containment: ['contained'], intent: ['international', 'coexistence'], post_war_aims: false, power_promise: ['for_everyone'], mobilization: ['strong'] },
        { capability: ['singularity'], automation: ['deep'], alignment: ['failed'], containment: ['contained'], intent: ['international', 'coexistence'], post_war_aims: false, sincerity_test: true },
        { capability: ['singularity'], automation: ['deep'], alignment: ['failed'], containment: ['contained'], intent: ['international', 'coexistence'], post_war_aims: false, pushback_outcome: true },
        { capability: ['singularity'], automation: ['deep'], alignment: ['failed'], containment: ['contained'], intent: ['international', 'coexistence'], post_war_aims: false, coalition_outcome: ['fragments'] },
        { capability: ['singularity'], automation: ['deep'], alignment: ['failed'], containment: ['contained'], intent: ['international', 'coexistence'], post_war_aims: false, power_promise: ['keeping_safe', 'best_will_rise'], mobilization: ['none'] },
        { capability: ['singularity'], automation: ['deep'], ai_goals: ['marginal'], inert_stays: ['yes'], intent: ['international', 'coexistence'], post_war_aims: false, power_promise: ['for_everyone'], mobilization: ['strong'] },
        { capability: ['singularity'], automation: ['deep'], ai_goals: ['marginal'], inert_stays: ['yes'], intent: ['international', 'coexistence'], post_war_aims: false, sincerity_test: true },
        { capability: ['singularity'], automation: ['deep'], ai_goals: ['marginal'], inert_stays: ['yes'], intent: ['international', 'coexistence'], post_war_aims: false, pushback_outcome: true },
        { capability: ['singularity'], automation: ['deep'], ai_goals: ['marginal'], inert_stays: ['yes'], intent: ['international', 'coexistence'], post_war_aims: false, coalition_outcome: ['fragments'] },
        { capability: ['singularity'], automation: ['deep'], ai_goals: ['marginal'], inert_stays: ['yes'], intent: ['international', 'coexistence'], post_war_aims: false, power_promise: ['keeping_safe', 'best_will_rise'], mobilization: ['none'] },
        { capability: ['singularity'], automation: ['deep'], ai_goals: ['benevolent'] }
      ],
      edges: [
        { id: 'none', label: 'Succeeds' },
        { id: 'drift', label: 'Wrong metrics' }
      ] },
    { id: 'escape_method', label: 'Method', stage: 3,
      hideWhen: [{ war_survivors: ['none'] }],
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          alignment: ['failed'],
          containment: ['escaped'],
          ai_goals: ['alien_coexistence', 'alien_extinction', 'paperclip', 'swarm', 'power_seeking']
        },
        {
          concentration_type: ['ai_itself'],
          ai_goals: ['alien_coexistence', 'alien_extinction', 'paperclip', 'power_seeking']
        }
      ],
      edges: [
        { id: 'nanotech', label: 'Nanotechnology', disabledWhen: [
            { ai_goals: ['alien_coexistence'], reason: 'A tolerant alien intelligence reshapes infrastructure, not biology' },
            { capability: { not: ['singularity'] }, reason: 'Developing nanotechnology requires superhuman scientific capability' }
          ] },
        { id: 'pathogens', label: 'Engineered pathogens', disabledWhen: [
            { ai_goals: ['alien_coexistence'], reason: 'Bioweapons are incompatible with leaving room for humanity' },
            { capability: { not: ['singularity'] }, reason: 'Engineering novel pathogens requires superhuman bioengineering' }
          ] },
        { id: 'autonomous_weapons', label: 'Autonomous weapons', disabledWhen: [{ ai_goals: ['alien_coexistence'], reason: 'Military force is incompatible with leaving room for humanity' }] },
        { id: 'industrial', label: 'Industrial conversion', shortLabel: 'Industrial' }
      ] },
    { id: 'escape_timeline', label: 'Execution Speed', stage: 3,
      hideWhen: [{ war_survivors: ['none'] }],
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          alignment: ['failed'],
          containment: ['escaped'],
          ai_goals: ['alien_coexistence', 'alien_extinction', 'paperclip', 'swarm', 'power_seeking'],
          escape_method: ['nanotech', 'pathogens', 'autonomous_weapons', 'industrial']
        },
        {
          concentration_type: ['ai_itself'],
          ai_goals: ['alien_coexistence', 'alien_extinction', 'paperclip', 'power_seeking'],
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
    { id: 'discovery_timing', label: 'Discovery', stage: 3,
      hideWhen: [{ war_survivors: ['none'] }],
      activateWhen: [
        {
          capability: ['singularity'],
          automation: ['deep'],
          alignment: ['failed'],
          containment: ['escaped'],
          ai_goals: ['alien_coexistence', 'alien_extinction', 'paperclip', 'swarm', 'power_seeking'],
          escape_timeline: true
        },
        {
          concentration_type: ['ai_itself'],
          ai_goals: ['alien_coexistence', 'alien_extinction', 'paperclip', 'power_seeking'],
          escape_timeline: true
        }
      ],
      edges: [
        { id: 'before_physical', label: 'Before physical execution', shortLabel: 'Before execution', disabledWhen: [{ escape_timeline: ['days_weeks'], reason: 'At this speed, there\'s no time for pre-execution detection' }] },
        { id: 'early_execution', label: 'During early execution', shortLabel: 'Early execution' },
        { id: 'advanced_execution', label: 'During advanced execution', shortLabel: 'Late execution' },
        { id: 'never', label: 'Never — the plan succeeds undetected', shortLabel: 'Never detected' }
      ] },
    { id: 'response_method', label: 'Response', stage: 3,
      hideWhen: [{ war_survivors: ['none'] }],
      activateWhen: [
        { discovery_timing: ['before_physical', 'early_execution', 'advanced_execution'] }
      ],
      edges: [
        { id: 'digital_countermeasure', label: 'Targeted digital countermeasure', shortLabel: 'Digital counter' },
        { id: 'infrastructure_shutdown', label: 'Infrastructure shutdown', shortLabel: 'Infra shutdown' },
        { id: 'physical_strikes', label: 'Physical strikes on compute', shortLabel: 'Physical strikes' },
        { id: 'emp', label: 'Electromagnetic pulse', shortLabel: 'EMP' },
        { id: 'negotiation', label: 'Negotiation / containment', shortLabel: 'Negotiation' },
        { id: 'competitive_paralysis', label: 'Competitive paralysis', shortLabel: 'Paralysis', disabledWhen: [{ geo_spread: ['one'], reason: 'Only one actor — no competitive dynamic' }] },
        { id: 'institutional_indecisiveness', label: 'Institutional indecisiveness', shortLabel: 'Indecisiveness' }
      ] },
    { id: 'response_success', label: 'Success?', stage: 3,
      hideWhen: [{ war_survivors: ['none'] }],
      activateWhen: [
        { response_method: ['digital_countermeasure', 'infrastructure_shutdown', 'physical_strikes', 'emp', 'negotiation'] }
      ],
      edges: [
        { id: 'yes', label: 'Yes — AI actually neutralized', shortLabel: 'Yes — neutralized' },
        { id: 'delayed', label: 'Delayed — AI disrupted but recovering', shortLabel: 'Delayed' },
        { id: 'no', label: 'No — AI unaffected' }
      ] },
    { id: 'collateral_impact', label: 'Collateral', stage: 3,
      hideWhen: [{ war_survivors: ['none'] }],
      activateWhen: [
        { response_success: ['yes', 'delayed', 'no'] }
      ],
      edges: [
        { id: 'minimal', label: 'Minimal — surgical, civilization intact', shortLabel: 'Minimal',
          disabledWhen: [
            { response_method: ['emp'], reason: 'EMP can\'t be surgical' },
            { response_method: ['infrastructure_shutdown'], reason: 'Shutting down internet infrastructure can\'t be minimal' }
          ] },
        { id: 'severe', label: 'Severe but recoverable', shortLabel: 'Severe',
          disabledWhen: [
            { response_method: ['emp'], reason: 'EMP damage is worse than severe' },
            { response_method: ['digital_countermeasure'], reason: 'Targeted software can\'t cause severe physical damage' }
          ] },
        { id: 'civilizational', label: 'Civilizational — the response itself crippled modern civilization', shortLabel: 'Civilizational',
          disabledWhen: [
            { response_method: ['digital_countermeasure'], reason: 'Targeted software can\'t cause civilizational damage' },
            { response_method: ['negotiation'], reason: 'Talking can\'t cause civilizational damage' }
          ] }
      ] },
    { id: 'catch_outcome', label: 'Long-Term Outcome', stage: 3,
      hideWhen: [{ war_survivors: ['none'] }],
      activateWhen: [
        { collateral_impact: true },
        { response_method: ['competitive_paralysis', 'institutional_indecisiveness'] }
      ],
      edges: [
        { id: 'never_stopped', label: 'The AI was never actually stopped', shortLabel: 'Never stopped',
          disabledWhen: [{ response_success: ['yes'], reason: 'The response succeeded' }] },
        { id: 'holds_temporarily', label: 'The stop holds — but the threat eventually returns', shortLabel: 'Holds temporarily',
          requires: { response_success: ['yes'] } },
        { id: 'holds_permanently', label: 'The stop holds permanently', shortLabel: 'Holds permanently',
          requires: { response_success: ['yes'] } }
      ] },
    // Phase 4a: decel_outcome deleted — decel module writes alignment,
    // geo_spread, rival_emerges, governance, containment, and
    // decel_align_progress directly via the module reducer.
    //
    // decel_align_progress is NOT declared as a node here: it's a pure
    // marker dim written only by the decel module reducer (via
    // collapseToFlavor.set). Declaring it with edges would let the DFS
    // validator enumerate it as a user-selectable dim, producing invalid
    // states like (alignment=robust, decel_align_progress=robust) without
    // gov_action=decelerate. Its values ({robust, brittle, unsolved}) are
    // auto-registered by the engine's markerVals scan of collapseToFlavor
    // blocks. Downstream consumers (alignment_durability,
    // proliferation_control) still read it via matchCondition → sel[k].
    { id: 'governance', label: 'Governance', derived: true, forwardKey: true,
      // Phase 4a rewrite:
      //   * `decel_outcome: ['abandon'] -> race` → subsumed by reducer
      //     writing governance='race' on (accelerate, brittle|unsolved).
      //   * `gov_action: ['decelerate'] -> slowdown` → subsumed by reducer
      //     writing governance='slowdown' on every decel-exit cell that
      //     isn't (accelerate, brittle|unsolved). Leaving this rule in
      //     would shadow the reducer's 'race' write (resolvedVal consults
      //     deriveWhen before sel for derived dims).
      //   For non-decel paths, sel[governance] falls through when no rule
      //   matches — the `gov_action: ['accelerate']` rule still covers the
      //   direct-accelerate branch, and governance_window rules cover the
      //   non-post-singularity settings.
      deriveWhen: [
        { match: { gov_action: ['accelerate'] }, value: 'race' },
        { match: { governance_window: ['governed'] }, value: 'governed' },
        { match: { governance_window: ['partial'] }, value: 'partial' },
        { match: { governance_window: ['race'] }, value: 'race' },
      ],
      edges: [{ id: 'race' }, { id: 'slowdown' }, { id: 'governed' }, { id: 'partial' }] },
    // Phase 4a: rival_emerges derived node deleted. Decel module writes
    // rival_emerges='yes' directly on (rival, *) cells. Other consumers
    // (templates at data/outcomes.json:1662,1740,2010,2130,2537,2616)
    // still see rival_emerges as a sel-dim and match it normally — the
    // engine registers 'rival_emerges' as a marker dim on first
    // collapseToFlavor.set encounter.
    { id: 'ruin_type', label: 'Ruin Cause', derived: true,
      deriveWhen: [
        { match: { catch_outcome: ['holds_permanently'], collateral_impact: ['civilizational'] }, value: 'self_inflicted' },
        { match: { conflict_result: ['destruction'] }, value: 'war' }
      ],
      edges: [{ id: 'war' }, { id: 'self_inflicted' }] }
];

const NODE_MAP = {};
for (const d of NODES) NODE_MAP[d.id] = d;

// Phase 4a: decel collapseToFlavor attachment is now delegated to the
// module runtime primitive (`attachModuleReducer(DECEL_MODULE)`), invoked
// below after MODULES is declared. The primitive enumerates the reducer's
// exit plan (cross product of DECEL_PAIRS × DECEL_REDUCER_TABLE) and
// installs one collapseToFlavor block per (pKey, action, progress) cell
// with the reducer's direct-write bundle and `move` set to all 14 internal
// decel dims — identical structure to the old manual loop, but now data-
// driven by the module declaration.
const DECEL_ALL_DIMS = [];
for (const [pKey, aKey] of DECEL_PAIRS) {
    DECEL_ALL_DIMS.push(pKey, aKey);
}

// ════════════════════════════════════════════════════════
// MODULES — Phase 0 spec (unused by engine until Phase 3+)
// ════════════════════════════════════════════════════════
//
// A module is a self-contained sub-loop with an explicit input/output
// interface. The engine treats a module as one atomic transition in the
// outer graph: enter when activateWhen fires, ask its internal questions
// until terminal, then run `reduce(local)` to produce the write bundle
// and commit to global `sel`.
//
// Declaration shape:
//   {
//     id,
//     activateWhen: [conditions],  // gates module entry; same grammar as nodes
//     reads:  [dim ids],           // globals visible inside the module
//     writes: [dim ids],           // dims the reducer commits to globals on exit
//     nodeIds: [node ids],         // which top-level nodes belong to the module
//                                  // (Phase 4a will move them physically under `nodes`)
//     reduce(local) -> bundle      // pure fn from frame.local -> partial sel
//   }
//
// Until Phase 4a migrates decel physically, `nodeIds` just *references*
// existing top-level nodes. The registry is consumed by the boundary
// audit script (Phase 1) and the module-aware runtime (Phase 2+).

const DECEL_MODULE_NODE_IDS = (function() {
    const ids = [];
    for (const [pKey, aKey] of DECEL_PAIRS) { ids.push(pKey, aKey); }
    return ids;
})();

// Reducer table for the decel module.
//
// Rows are keyed by (terminating_action, progress_at_that_month). Each cell
// lists the global-sel writes produced on module exit. An entry of
// `undefined` (i.e. absent key) means "don't write this dim — leave whatever
// was in sel at entry".
//
// Provenance (which existing rule each write subsumes):
//   alignment:
//     - (accelerate, robust) = robust   <- alignment.deriveWhen line 453 via decel_outcome=solved
//     - (rival,      robust) = robust   <- alignment.deriveWhen line 453 via decel_outcome=parity_solved
//     - (rival,      brittle)= brittle  <- alignment.deriveWhen line 461 via decel_outcome=rival
//     - (escapes,    *)      = failed   <- alignment.deriveWhen line 462 via decel_outcome=escapes
//     - all others: not written (alignment stays as user-picked)
//   distribution:
//     - (rival, *) = multiple           <- geo_spread/distribution... wait, distribution.deriveWhen
//                                          at graph.js:414 fires on decel_outcome in
//                                          [rival, parity_solved, parity_failed] -> 'multiple'.
//                                          That's the geo_spread deriveWhen actually. Distribution
//                                          itself has no decel_outcome rule — this write is
//                                          NOT needed. See geo_spread below instead.
//     (no distribution writes from decel)
//   geo_spread:
//     - (rival, *) = multiple           <- geo_spread.deriveWhen line 414
//   rival_emerges:
//     - (rival, *) = yes                <- rival_emerges.deriveWhen line 1324
//   governance:
//     - (*, *) = slowdown by default    <- governance.deriveWhen line 1316 (gov_action=decelerate
//                                          falls through when decel_outcome isn't abandon)
//     - (accelerate, brittle) = race    <- governance.deriveWhen line 1315 via decel_outcome=abandon
//     - (accelerate, unsolved)= race    <- governance.deriveWhen line 1315 via decel_outcome=abandon
//     (escapes and rival paths keep governance=slowdown since those decel_outcome values aren't
//      'abandon' — the decelerate fallback rule catches them)
//   containment:
//     - (escapes, *) = escaped          <- containment.contained.disabledWhen line 533 forces the
//                                          escape path via lock; reducer makes it explicit
//   decel_align_progress:
//     - always = the progress value at the terminating month
//                                       <- decel_align_progress.deriveWhen loop at graph.js:1348-1350
//
// The `_provenance` field on each cell tracks which old decel_outcome value
// this case corresponded to, for post-migration test cross-referencing.
const DECEL_REDUCER_TABLE = {
    // action -> progress -> bundle
    escapes: {
        robust:   { alignment: 'failed', governance: 'slowdown', containment: 'escaped', decel_align_progress: 'robust',   _provenance: 'escapes' },
        brittle:  { alignment: 'failed', governance: 'slowdown', containment: 'escaped', decel_align_progress: 'brittle',  _provenance: 'escapes' },
        unsolved: { alignment: 'failed', governance: 'slowdown', containment: 'escaped', decel_align_progress: 'unsolved', _provenance: 'escapes' },
    },
    accelerate: {
        // (accelerate, robust): plan table specifies governance='race' (user
        // decelerated to solve alignment, then resumed racing). Old behavior
        // was resolved=undefined for this cell because gov_action was moved
        // to flavor by the accelerate collapse — a latent quirk the plan
        // resolves by having the reducer commit governance explicitly.
        robust:   { alignment: 'robust', governance: 'race',     decel_align_progress: 'robust',   _provenance: 'solved'  },
        brittle:  {                      governance: 'race',     decel_align_progress: 'brittle',  _provenance: 'abandon' },
        unsolved: {                      governance: 'race',     decel_align_progress: 'unsolved', _provenance: 'abandon' },
    },
    rival: {
        robust:   { alignment: 'robust',  geo_spread: 'multiple', rival_emerges: 'yes', governance: 'slowdown', decel_align_progress: 'robust',   _provenance: 'parity_solved' },
        brittle:  { alignment: 'brittle', geo_spread: 'multiple', rival_emerges: 'yes', governance: 'slowdown', decel_align_progress: 'brittle',  _provenance: 'rival'         },
        unsolved: {                       geo_spread: 'multiple', rival_emerges: 'yes', governance: 'slowdown', decel_align_progress: 'unsolved', _provenance: 'parity_failed' },
    },
};

// Pure reducer: (local frame state) -> partial write bundle.
// Scans DECEL_PAIRS in order to find the month with a terminating action
// (escapes | accelerate | rival). That month's (action, progress) picks the
// table cell. Returns {} if no terminating action is present yet (caller
// shouldn't invoke reduce in that case).
function decelReduce(local) {
    for (const [pKey, aKey] of DECEL_PAIRS) {
        const action = local[aKey];
        if (!action || action === 'continue') continue;
        const progress = local[pKey];
        const cell = DECEL_REDUCER_TABLE[action] && DECEL_REDUCER_TABLE[action][progress];
        if (!cell) return {};
        const bundle = {};
        for (const k of Object.keys(cell)) {
            if (k.startsWith('_')) continue;
            bundle[k] = cell[k];
        }
        return bundle;
    }
    return {};
}

// Module "exit plan" — enumerates, as static tuples, every
// (action-node, action-edge, progress-when, write-bundle) combination for
// which the module should commit its reducer output. For action/progress
// modules like decel, this is the cross product of DECEL_PAIRS and
// reducerTable cells. For other shapes we'll generalize later.
function buildDecelExitPlan() {
    const plan = [];
    for (const [pKey, aKey] of DECEL_PAIRS) {
        for (const [action, progressMap] of Object.entries(DECEL_REDUCER_TABLE)) {
            for (const [progress, cell] of Object.entries(progressMap)) {
                const bundle = {};
                for (const k of Object.keys(cell)) {
                    if (k.startsWith('_')) continue;
                    bundle[k] = cell[k];
                }
                plan.push({
                    nodeId: aKey,
                    edgeId: action,
                    when: { [pKey]: [progress] },
                    set: bundle,
                });
            }
        }
    }
    return plan;
}

const DECEL_MODULE = {
    id: 'decel',
    activateWhen: [{ gov_action: ['decelerate'] }],
    // Globals the module's internals may reference.
    reads: [
        'gov_action',
        'alignment',       // decel_Nmo_progress.unsolved.disabledWhen reads alignment=brittle
        'open_source',     // decel_6mo_action + decel_12mo_action.escapes/continue/accelerate.requires
        'capability',      // all progress/action activateWhen
        'automation',      // all progress/action activateWhen
    ],
    // Globals the reducer commits to sel on exit. Union of non-underscore
    // keys across all DECEL_REDUCER_TABLE cells.
    writes: [
        'alignment',
        'geo_spread',
        'rival_emerges',
        'governance',
        'containment',
        'decel_align_progress',
    ],
    nodeIds: DECEL_MODULE_NODE_IDS,
    reduce: decelReduce,
    reducerTable: DECEL_REDUCER_TABLE,  // exposed for audit + tests
    get exitPlan() { return buildDecelExitPlan(); },
};

// Phase 3 runtime primitive — attach the module's reducer output to the
// terminating-edge collapseToFlavor blocks. Given an exit plan (a list of
// { nodeId, edgeId, when, set } tuples), install collapseToFlavor on the
// matching edges. The `move` list is the full set of internal dims, so
// they get evicted from sel into flavor on module exit (same space-saving
// behavior as the legacy decel collapse).
//
// Dormant until Phase 4a wires it up for the decel module.
function attachModuleReducer(mod) {
    if (!mod || !mod.exitPlan) return;
    const internalDims = mod.nodeIds.slice();
    // Group by (nodeId, edgeId) so multiple progress-when cells stack up
    // on the same edge as a collapseToFlavor ARRAY.
    const byEdge = new Map();
    for (const tuple of mod.exitPlan) {
        const key = tuple.nodeId + '|' + tuple.edgeId;
        if (!byEdge.has(key)) byEdge.set(key, []);
        byEdge.get(key).push({ when: tuple.when, set: tuple.set, move: internalDims });
    }
    for (const [key, blocks] of byEdge) {
        const [nodeId, edgeId] = key.split('|');
        const node = NODE_MAP[nodeId];
        if (!node || !node.edges) continue;
        const edge = node.edges.find(e => e.id === edgeId);
        if (!edge) continue;
        // If the edge already has a collapseToFlavor (legacy decel_outcome
        // path), we merge — the legacy block stays for pre-migration, and
        // Phase 4a will remove the legacy loop.
        const existing = edge.collapseToFlavor
            ? (Array.isArray(edge.collapseToFlavor) ? edge.collapseToFlavor : [edge.collapseToFlavor])
            : [];
        edge.collapseToFlavor = existing.concat(blocks);
    }
}

const MODULES = [DECEL_MODULE];
const MODULE_MAP = {};
for (const m of MODULES) MODULE_MAP[m.id] = m;

// Phase 4a: install the decel module's reducer attachments on the
// terminating action edges. This replaces the legacy DECEL_OUTCOME_TABLE
// loop and writes direct dims (alignment/geo_spread/rival_emerges/
// governance/containment/decel_align_progress) instead of the
// intermediate decel_outcome tag.
for (const mod of MODULES) attachModuleReducer(mod);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SCENARIO, NODES, NODE_MAP, MODULES, MODULE_MAP, DECEL_PAIRS, attachModuleReducer };
}
if (typeof window !== 'undefined') {
    window.Graph = { SCENARIO, NODES, NODE_MAP, MODULES, MODULE_MAP, DECEL_PAIRS, attachModuleReducer };
}

})();
