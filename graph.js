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


// Activation rules internal to the who_benefits module — used only by
// `benefit_distribution`, which is itself inside the module. These rules
// reference power_promise/mobilization/sincerity_test/pushback_outcome/
// coalition_outcome (all internal to who_benefits), so they are legitimate
// intra-module reads. They stay here (not inlined into the node below)
// purely for readability; the pure-internal dims they gate on are in sel
// while the module is active.
const WHO_BENEFITS_INTERNAL_ACTIVATE = [
    { capability: ['asi'], power_promise: ['for_everyone'], mobilization: ['strong'] },
    { capability: ['asi'], sincerity_test: true },
    { capability: ['asi'], pushback_outcome: true },
    { capability: ['asi'], coalition_outcome: ['fragments'] },
    { capability: ['asi'], power_promise: ['keeping_safe', 'best_will_rise'], mobilization: ['none'] },
];

// Activation rules for post-who_benefits outcome nodes (knowledge_rate,
// physical_rate on the main path). The old rules duplicated the 5 WHO_BENEFITS_INTERNAL_ACTIVATE
// clauses — that tightly coupled these external nodes to the module's
// internals. Now they gate on the single completion marker `who_benefits_set`,
// which is written on every module exit edge. The benevolent clause bypasses
// who_benefits entirely (AI goals render the question moot), and the
// catch_outcome clause characterises the post-war world after a successful
// catch.
const OUTCOME_ACTIVATE = [
    { capability: ['asi'], who_benefits_set: ['yes'] },
    { capability: ['asi'], ai_goals: ['benevolent'] },
    // AI escaped but was ultimately caught — post-war world still needs to be
    // characterized (who benefits, knowledge/physical automation).
    // post_catch=contained replaces the old compound
    // (catch_outcome=holds_permanently, collateral_impact≠civilizational).
    { capability: ['asi'], post_catch: ['contained'] }
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
      // After module exit runs, capability is rewritten to 'plateau' on
      // substantial/never edges (see EMERGENCE exit plan). The mild edge
      // stays inside the module and routes back into the singularity
      // sub-path via collapseToFlavor below.
      hideWhen: [{ capability: ['plateau'] }],
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
        // vs "permanent ceiling"). The exit plan sets capability='plateau'
        // on both edges (the shared gate); the specific value is moved to
        // flavor for flavor-text / heading lookups (the-plateau.flavors.
        // stall_recovery, narrative.json stall_recovery.when: ['never']).
        { id: 'substantial', label: 'Years/decades',
          collapseToFlavor: { move: ['stall_recovery'] } },
        { id: 'never', label: 'Never',
          collapseToFlavor: { move: ['stall_recovery'] } }
      ] },
    { id: 'plateau_benefit_distribution', label: 'Who Benefits?', stage: 3, priority: 2,
      activateWhen: [{ capability: ['plateau'] }],
      // In the plateau case, the specific benefit-distribution value only
      // drives narrative flavor (`the-plateau.flavors.plateau_benefit_distribution`
      // and a single `_when` clause in plateau_physical_rate.uneven). No
      // graph-engine rule gates on it, so we collapse all three values to
      // the shared `who_benefits_set: 'yes'` marker (same marker the main
      // WHO_BENEFITS_MODULE writes) so rollout activation and other
      // "benefits done?" gates only need to read one dim. The plateau
      // activation gate (`capability=plateau`) keeps this question
      // distinct from the main-path one.
      hideWhen: [{ who_benefits_set: ['yes'] }],
      edges: [
        { id: 'equal', label: 'Shared equally',
          collapseToFlavor: { set: { who_benefits_set: 'yes' }, move: ['plateau_benefit_distribution'] } },
        { id: 'unequal', label: 'Wealth concentrates',
          collapseToFlavor: { set: { who_benefits_set: 'yes' }, move: ['plateau_benefit_distribution'] } },
        { id: 'extreme', label: 'Power concentrates',
          collapseToFlavor: { set: { who_benefits_set: 'yes' }, move: ['plateau_benefit_distribution'] } }
      ] },
    // The unified knowledge_rate and physical_rate nodes (defined near the
    // end of NODES, after who_benefits) serve plateau, auto-shallow, and
    // main singularity paths. On plateau, they fire here in displayOrder
    // after plateau_benefit_distribution — activation is driven entirely
    // by the node's multi-path activateWhen, not position.
    { id: 'agi_threshold', label: 'Human-Competitive AI', stage: 1,
      activateWhen: [{ capability: ['singularity'] }],
      // Answering agi_threshold always sets a 1-bit sel marker `agi_happens`
      // ('yes' for any specific timing, 'no' for never) and moves the timing
      // value into flavor on the *next* step (asi_threshold's edges). The
      // marker preserves the only behavioral bit downstream engine rules
      // care about (automation_recovery gates on asi_threshold=never), while
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
      // converge at the sel level (downstream gates only need
      // asi_threshold='never', not agi_happens). `requires` on the
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
    // `automation` node was removed in the capability-4-value refactor.
    // Its role (distinguishing deep/shallow paths on the singularity branch)
    // is now encoded directly in `capability`: post-emergence-exit the
    // value is one of {plateau, agi, asi}. Formerly shallow→'agi',
    // deep→'asi'. See EMERGENCE_MODULE.buildEmergenceExitPlan for the
    // per-exit-edge capability writes.
    { id: 'automation_recovery', label: 'Deep Automation Recovery?', stage: 1,
      // Asked whenever ASI never happens — whether or not AGI happened. In
      // the agi=yes case, the breakthrough represents closing the gap from
      // human-level to superintelligence; in the agi=no case, it represents
      // an alternative path cracking the barrier without AGI first.
      activateWhen: [{ capability: ['singularity'], asi_threshold: ['never'] }],
      // After module exit runs, capability is rewritten to 'agi' on
      // substantial/never edges (see EMERGENCE exit plan). The mild edge
      // stays inside the module and routes back into the full
      // singularity-with-ASI sub-path via collapseToFlavor below.
      hideWhen: [{ capability: ['agi'] }],
      edges: [
        // `mild` = "a later breakthrough cracks the barrier". Behaviorally
        // this reaches the same end state as a normal agi+asi path (both
        // happen → capability='asi' on module exit), so we converge to that
        // sel shape: set asi_happens='yes' and push the stall/recovery
        // specifics to flavor. /explore treats this as the same node as
        // the direct-singularity path.
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
        // `substantial` and `never` gate downstream agi-only questions
        // identically — only narrative text distinguishes them (the-automation
        // flavors/flavorHeadings). The exit plan sets capability='agi' on
        // both edges (the shared gate); the specific pick is moved to
        // flavor for narrativeState lookups.
        { id: 'substantial', label: 'Years/decades',
          collapseToFlavor: { move: ['automation_recovery'] } },
        { id: 'never', label: 'Never',
          collapseToFlavor: { move: ['automation_recovery'] } }
      ] },
    { id: 'auto_benefit_distribution', label: 'Who Benefits?', stage: 3, priority: 2,
      activateWhen: [{ capability: ['agi'] }],
      // Flavor-only: no graph rule gates on the specific value; only
      // the-automation.flavors.auto_benefit_distribution (narrative),
      // flavorHeadings, and a single narrative _when clause reference it,
      // all through narrativeState. Collapse to the shared
      // `who_benefits_set: 'yes'` marker (same marker the main
      // WHO_BENEFITS_MODULE writes) so rollout activation and other
      // "benefits done?" gates only need to read one dim. The agi
      // activation gate (`capability=agi`) keeps this question distinct
      // from the main-path one.
      hideWhen: [{ who_benefits_set: ['yes'] }],
      edges: [
        { id: 'equal', label: 'Shared equally',
          collapseToFlavor: { set: { who_benefits_set: 'yes' }, move: ['auto_benefit_distribution'] } },
        { id: 'unequal', label: 'Wealth concentrates',
          collapseToFlavor: { set: { who_benefits_set: 'yes' }, move: ['auto_benefit_distribution'] } },
        { id: 'extreme', label: 'Power concentrates',
          collapseToFlavor: { set: { who_benefits_set: 'yes' }, move: ['auto_benefit_distribution'] } }
      ] },
    // knowledge_rate / physical_rate (unified across plateau, auto-shallow,
    // and main paths) live near the end of NODES — see note near the old
    // plateau_knowledge_rate position.
    { id: 'takeoff', label: 'R&D Acceleration', stage: 1,
      // Inside emergence: fires once the user has committed to the ASI
      // sub-path. `asi_happens: 'yes'` is set on every asi_threshold
      // non-never edge and also by automation_recovery.mild (which
      // routes back into the direct-ASI sel shape). `capability` is
      // still 'singularity' here — the module's post-exit rewrite to
      // 'asi' happens on the takeoff/governance_window edge itself.
      activateWhen: [{ capability: ['singularity'], asi_happens: ['yes'] }],
      // Engine branches on three behavioral classes only (normal / fast /
      // explosive). The raw value moves to flavor so narrative text
      // (`flavors.takeoff.<value>` etc.) and narrativeVariants keyed on the
      // specific speed keep working unchanged. All downstream engine
      // conditions read `takeoff_class` (governance_window activate,
      // open_source / distribution / geo_spread / sovereignty / gov_action
      // disable) instead of `takeoff`.
      // Hide clauses are OR'd:
      //   • takeoff_class set — answered.
      //   • capability ∈ {plateau, agi, asi} — module has exited. Catches
      //     post-exit states where takeoff_class might have been moved
      //     to flavor by a downstream collapse.
      hideWhen: [
        { takeoff_class: ['normal', 'fast', 'explosive'] },
        { capability: ['plateau', 'agi', 'asi'] }
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
          collapseToFlavor: { set: { takeoff_class: 'explosive' }, move: ['takeoff'] } }
      ] },
    { id: 'governance_window', label: 'Governance Window', stage: 1,
      // Inside emergence: capability is still 'singularity' here (module
      // rewrites to 'asi' on this node's exit edges). asi_happens='yes'
      // is set by asi_threshold non-never / automation_recovery.mild and
      // implies we're on the direct-ASI sub-path; takeoff_class='normal'
      // further narrows to the path that needs the governance question.
      activateWhen: [{ capability: ['singularity'], asi_happens: ['yes'], takeoff_class: ['normal'] }],
      // Once answered, all three edges move governance_window to flavor
      // and encode the specific value into flavor.governance, so /explore
      // treats them as one converged state. Self-hide keys on the module's
      // own post-exit completion marker: capability='asi' is set by the
      // module exit reducer on this same pick (governance_window is an
      // EMERGENCE exit node on the main ASI path).
      hideWhen: [{ capability: ['asi'] }],
      edges: [
        { id: 'governed', label: 'Active preparation',
          collapseToFlavor: { setFlavor: { governance: 'governed' }, move: ['governance_window'] } },
        { id: 'partial', label: 'Partial preparation',
          collapseToFlavor: { setFlavor: { governance: 'partial' }, move: ['governance_window'] } },
        { id: 'race', label: 'Relative complacency',
          collapseToFlavor: { setFlavor: { governance: 'race' }, move: ['governance_window'] } }
      ] },
    { id: 'open_source', label: 'Open Source', stage: 2,
      activateWhen: [{ capability: ['asi'] }],
      // `open_source_set: 'yes'` is a persistent sel marker: it stays in sel
      // even after downstream collapses (e.g. geo_spread=multiple's
      // `move: ['open_source']`) that move the raw value to flavor. This
      // lets self-hide and `takeoff.hideWhen` still recognize the
      // "post-open_source" state via sel alone.
      hideWhen: [{ open_source_set: ['yes'] }],
      // takeoff_class stays in sel through downstream consumers
      // (distribution, geo_spread, sovereignty, gov_action disabledWhen all
      // read takeoff_class: ['explosive']). It's finally moved to flavor by
      // gov_action's edge collapses.
      edges: [
        { id: 'near_parity', label: 'Near-parity',
          disabledWhen: [{ takeoff_class: ['explosive'], reason: 'At this pace, open-source can\'t keep up' }],
          collapseToFlavor: { set: { open_source_set: 'yes' } } },
        { id: 'six_months', label: '~6 months',
          disabledWhen: [{ takeoff_class: ['explosive'], reason: 'At this pace, open-source can\'t keep up' }],
          collapseToFlavor: { set: { open_source_set: 'yes' } } },
        { id: 'twelve_months', label: '~12 months',
          disabledWhen: [{ takeoff_class: ['explosive'], reason: 'At this pace, open-source can\'t keep up' }],
          collapseToFlavor: { set: { open_source_set: 'yes' } } },
        { id: 'twenty_four_months', label: '~24 months',
          collapseToFlavor: { set: { open_source_set: 'yes' } } }
      ] },
    { id: 'distribution', label: 'Frontier Labs', stage: 2,
      activateWhen: [{ capability: ['asi'] }],
      edges: [
        { id: 'open', label: 'Distributed', requires: { open_source: ['near_parity'] }, disabledWhen: [{ takeoff_class: ['explosive'], reason: 'At this speed, only whoever gets there first has it' }] },
        { id: 'lagging', label: 'Many compete',
          disabledWhen: [{ takeoff_class: ['explosive'], reason: 'At this speed, only whoever gets there first has it' }, { open_source: ['near_parity'], reason: 'With open-source at parity, no one is lagging behind' }],
          collapseToFlavor: { set: { distribution: 'concentrated' }, setFlavor: { distribution_detail: 'lagging' } } },
        { id: 'concentrated', label: 'A few lead', disabledWhen: [{ open_source: ['near_parity'], reason: 'With open-source at parity, no one is lagging behind' }] },
        { id: 'monopoly', label: 'One dominates', disabledWhen: [{ open_source: ['near_parity'], reason: 'With open-source at parity, no one can monopolize it' }] }
      ] },
    { id: 'geo_spread', label: 'Countries', stage: 2,
      activateWhen: [
        {
          capability: ['asi'],
          open_source: ['six_months', 'twelve_months', 'twenty_four_months']
        }
      ],
      // Phase 4a: removed `decel_outcome: [rival,parity_solved,parity_failed] -> multiple`
      // rule — subsumed by the decel reducer writing geo_spread='multiple'
      // directly on (rival, *) cells.
      // deriveWhen removed: the geo_spread='multiple' override on any
      // leaked-weights path moved into PROLIFERATION_MODULE's exit plan.
      // PROLIFERATION is the rightful writer of proliferation_outcome, so
      // it owns the geo_spread override. CONTROL_MODULE no longer needs
      // to read proliferation_outcome.
      edges: [
        { id: 'one', label: 'One country' },
        { id: 'two', label: 'Two powers',
          disabledWhen: [{ takeoff_class: ['explosive'], reason: 'Only the first mover has it at this speed' }, { distribution: ['monopoly'], reason: 'One lab dominates — only one country is in the game' }],
          collapseToFlavor: { set: { geo_spread: 'multiple' }, setFlavor: { geo_spread_detail: 'two' }, move: ['open_source'] } },
        { id: 'several', label: 'Several',
          disabledWhen: [{ takeoff_class: ['explosive'], reason: 'Only the first mover has it at this speed' }, { distribution: ['monopoly'], reason: 'One lab dominates — only one country is in the game' }],
          collapseToFlavor: { set: { geo_spread: 'multiple' }, setFlavor: { geo_spread_detail: 'several' }, move: ['open_source'] } }
      ] },
    { id: 'sovereignty', label: 'Power Holder', stage: 2,
      activateWhen: [
        {
          capability: ['asi'],
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
      activateWhen: [{ capability: ['asi'] }],
      // Phase 4a: removed three decel_outcome-based rules — decel reducer
      // now writes alignment directly (robust on solved/parity_solved,
      // brittle on (rival, brittle), failed on (escapes, *)).
      // deriveWhen trimmed: rules formerly keyed on external writer
      // dimensions (proliferation_alignment, proliferation_outcome,
      // brittle_resolution) moved to their rightful writer modules /
      // nodes:
      //   * PROLIFERATION exit plan (proliferation_alignment.breaks,
      //     proliferation_outcome.leaks_public + alignment≠robust,
      //     proliferation_control.none + alignment≠robust) now sets
      //     alignment='failed' directly via collapseToFlavor.set.
      //   * brittle_resolution.{escape, solved, sufficient} edges now
      //     set alignment={failed, robust, brittle} directly via
      //     collapseToFlavor.set.
      // Only alignment_durability.breaks remains as a derive (intra-module
      // — alignment_durability is an ALIGNMENT_MODULE internal dim, so
      // it can stay as a derive without creating a cross-module read).
      // The marginal-path re-classification (failed → brittle when
      // ai_goals=marginal) also stays; it's simplified (no longer guards
      // on brittle_resolution≠solved — since brittle_resolution's own
      // edge-level set writes alignment='robust' first, that value isn't
      // in the valueMap so it's preserved).
      deriveWhen: [
        { match: { alignment_durability: ['breaks'] }, value: 'failed' },
        { match: { ai_goals: ['marginal'] }, valueMap: { failed: 'brittle' } },
      ],
      edges: [
        { id: 'robust', label: 'Robust' },
        { id: 'brittle', label: 'Brittle / Partial' },
        { id: 'failed', label: 'Unsolved' }
      ] },
    { id: 'alignment_durability', label: 'Alignment Durability', stage: 2,
      // Simplified gate: ask about brittle-alignment durability whenever
      // alignment resolved to 'brittle' and containment is still holding,
      // regardless of which path produced the brittle state. The decel
      // reducer writes alignment='brittle' only on the (rival, brittle)
      // cell; (escapes, *) write alignment='failed' and sets
      // containment='escaped'; (abandon, brittle) preserves pre-decel
      // alignment — all handled uniformly by this single clause.
      activateWhen: [
        {
          capability: ['asi'],
          alignment: ['brittle'],
          containment: { not: ['escaped'] }
        }
      ],
      edges: [ { id: 'holds', label: 'Holds for now' }, { id: 'breaks', label: 'Breaks' } ] },
    { id: 'containment', label: 'Containment', stage: 2, forwardKey: true,
      // hideWhen / activateWhen / deriveWhen / disabledWhen trimmed:
      // rules formerly keyed on external writer dims (brittle_resolution,
      // proliferation_alignment, proliferation_outcome, post_catch) are
      // gone. Those modules / nodes now pre-write containment directly
      // via collapseToFlavor.set (ESCAPE.post_catch=contained,
      // PROLIFERATION.{leaked-exits}, brittle_resolution.escape), so
      // containment is already set in sel on those paths — the node's
      // own activation and rendering auto-skip without needing guards
      // here. alignment_durability.breaks remains (intra-module — it's
      // an ALIGNMENT_MODULE internal node).
      hideWhen: [
        { alignment_durability: ['breaks'] }
      ],
      activateWhen: [
        {
          capability: ['asi'],
          alignment: ['failed']
        },
        {
          capability: ['asi'],
          ai_goals: ['marginal']
        }
      ],
      deriveWhen: [
        { match: { alignment_durability: ['breaks'] }, value: 'escaped' }
      ],
      edges: [
        {
          id: 'contained',
          label: 'Contained',
          requires: { distribution: ['concentrated', 'monopoly'] },
          disabledWhen: [
            { alignment_durability: ['breaks'], reason: 'Brittle alignment broke — the AI is already operating freely' }
          ]
        },
        { id: 'escaped', label: 'Escapes' }
      ] },
    { id: 'ai_goals', label: 'AI Converges On', stage: 2, forwardKey: true,
      activateWhen: [
        {
          capability: ['asi'],
          alignment: ['failed'],
          containment: ['escaped']
        },
        { concentration_type: ['ai_itself'] }
      ],
      edges: [
        { id: 'benevolent', label: 'Benefit humanity',
          disabledWhen: [
            { war_survivors: ['none'], reason: 'Humanity is extinct — there is no one left to benefit' }
          ] },
        { id: 'alien_coexistence', label: 'Alien (tolerant)',
          disabledWhen: [
            { war_survivors: ['none'], reason: 'Humanity is extinct — there is no one left to coexist with' }
          ] },
        { id: 'alien_extinction', label: 'Alien (total)' },
        { id: 'paperclip', label: 'Arbitrary' },
        { id: 'swarm', label: 'Divergent', disabledWhen: [
            { concentration_type: ['ai_itself'], reason: 'The AI took control from a singular power structure — it didn\'t fragment' }
          ] },
        { id: 'power_seeking', label: 'Power accumulation' },
        { id: 'marginal', label: 'Inert (for now)', disabledWhen: [
            { concentration_type: ['ai_itself'], reason: 'The AI already took control — it is not inert' },
            // Disables marginal during the ESCAPE_MODULE re-entry triggered
            // by inert_stays=no. The `escape_set: false` gate ensures this
            // rule only fires AFTER the inert_stays.no collapseToFlavor has
            // evicted `ai_goals` + `escape_set` to flavor. Without that
            // gate, cleanSelection would delete sel.ai_goals before the
            // move runs (disabledWhen fires earlier in the same pass than
            // collapseToFlavor), and the move's `when: { ai_goals: ['marginal'] }`
            // would then fail to match, leaving escape_set stuck.
            { inert_stays: ['no'], escape_set: false, reason: 'You already chose "eventually develops goals" — the AI can\'t stay inert' }
          ] }
      ] },
    { id: 'inert_stays', label: 'Does Escaped AI Stay Inert?', stage: 3, priority: 1,
      // Gated on who_benefits_set: inert_stays is a "final surprise"
      // that fires near the end of the chain, after who_benefits has
      // resolved. Without this gate, inert_stays becomes askable as
      // soon as ai_goals='marginal' is set (at escape module exit),
      // which would jump it ahead of who_benefits on some paths.
      activateWhen: [{ capability: ['asi'], ai_goals: ['marginal'], who_benefits_set: ['yes'] }],
      edges: [
        { id: 'yes', label: 'Yes — remains inert' },
        {
          id: 'no',
          label: 'No — eventually develops goals and escapes',
          shortLabel: 'No — develops goals',
          // Re-entry step for ESCAPE_MODULE. The marginal path exited
          // the module via ai_goals.marginal (escape_set='yes',
          // ai_goals='marginal' in sel). On inert_stays=no we evict:
          //   * ai_goals  — ai_goals re-activates, user picks a hostile
          //     value (marginal disabled via ai_goals.marginal.disabledWhen).
          //   * escape_set — clears the module's completion marker so
          //     _isModulePending returns true again; module-first
          //     scheduling then walks the full escape pipeline.
          // Gated by `when: ai_goals=['marginal']` so it only fires on
          // the initial transition — once the user re-picks a hostile
          // goal, subsequent cleanSelection passes don't re-evict.
          collapseToFlavor: { when: { ai_goals: ['marginal'] }, move: ['ai_goals', 'escape_set'] }
        }
      ] },
    // Note: the former `inert_outcome` node is gone. The inert-wakes path
    // now re-asks `ai_goals` instead — see ESCAPE_MODULE and
    // inert_stays.no.collapseToFlavor.
    { id: 'gov_action', label: 'Deceleration', stage: 2,
      // Hide once the AI has escaped containment — the deceleration
      // decision is moot at that point, regardless of how the escape
      // pipeline resolved (hostile pipeline, benevolent/marginal
      // early-exit, or inert_stays loop). The second clause catches
      // the concentration_type=ai_itself hostile path where containment
      // is never set but ai_goals is hostile.
      hideWhen: [
        { containment: ['escaped'] },
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } }
      ],
      // Decel is only coherent when some actor can actually enforce a slowdown
      // in the one-country-leads case:
      //   (a) sovereignty=state     → state mandates (any distribution), or
      //   (b) distribution=monopoly → the one dominant lab self-decels
      // Rules out distribution=concentrated + sovereignty=lab (multi-lab race,
      // no actor can unilaterally slow).
      activateWhen: [
        { capability: ['asi'], geo_spread: ['one'], sovereignty: ['state'] },
        { capability: ['asi'], geo_spread: ['one'], distribution: ['monopoly'] }
      ],
      deriveWhen: [{ match: { alignment_durability: ['breaks'] }, value: 'accelerate' }],
      // By this point all sel readers of `takeoff_class` have fired
      // (governance_window activate, takeoff self-hide, open_source /
      // distribution / geo_spread / sovereignty disable clauses, and this
      // node's own decelerate disable). The dim is purely narrative going
      // forward, so both edges move it to flavor for /explore convergence.
      edges: [
        { id: 'decelerate', label: 'Decelerate',
          disabledWhen: [{ alignment: ['robust'], reason: 'Alignment is solved — there is no case for slowing down' }, { takeoff_class: ['explosive'], reason: 'Moving too fast for any government to intervene' }],
          collapseToFlavor: { move: ['takeoff_class'] } },
        // Picking accelerate means the decel chain is never entered, so the
        // specific open_source timeline (6/12/24 months) no longer affects
        // any downstream gating. Move it to flavor for /explore convergence.
        { id: 'accelerate', label: 'Accelerate',
          collapseToFlavor: { move: ['open_source', 'takeoff_class'] } }
      ] },
    { id: 'decel_2mo_progress', label: '2 Months', stage: 2,
      activateWhen: [{ capability: ['asi'], gov_action: ['decelerate'] }],
      edges: [
        { id: 'robust', label: 'Solved — robust' },
        { id: 'brittle', label: 'Solved — brittle / partial', shortLabel: 'Brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet', disabledWhen: [{ alignment: ['brittle'], reason: 'Alignment is already partially solved' }] }
      ] },
    { id: 'decel_2mo_action', label: '2mo Decision', stage: 2,
      activateWhen: [
        {
          capability: ['asi'],
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
      activateWhen: [{ capability: ['asi'], decel_2mo_action: ['continue'] }],
      edges: [
        { id: 'robust', label: 'Solved — robust' },
        { id: 'brittle', label: 'Solved — brittle / partial', shortLabel: 'Brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet', disabledWhen: [{ alignment: ['brittle'], reason: 'Alignment is already partially solved' }] }
      ] },
    { id: 'decel_4mo_action', label: '4mo Decision', stage: 2,
      activateWhen: [
        {
          capability: ['asi'],
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
      activateWhen: [{ capability: ['asi'], decel_4mo_action: ['continue'] }],
      edges: [
        { id: 'robust', label: 'Solved — robust' },
        { id: 'brittle', label: 'Solved — brittle / partial', shortLabel: 'Brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet', disabledWhen: [{ alignment: ['brittle'], reason: 'Alignment is already partially solved' }] }
      ] },
    { id: 'decel_6mo_action', label: '6mo Decision', stage: 2,
      activateWhen: [
        {
          capability: ['asi'],
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
      activateWhen: [{ capability: ['asi'], decel_6mo_action: ['continue'] }],
      edges: [
        { id: 'robust', label: 'Solved — robust' },
        { id: 'brittle', label: 'Solved — brittle / partial', shortLabel: 'Brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet', disabledWhen: [{ alignment: ['brittle'], reason: 'Alignment is already partially solved' }] }
      ] },
    { id: 'decel_9mo_action', label: '9mo Decision', stage: 2,
      activateWhen: [
        {
          capability: ['asi'],
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
      activateWhen: [{ capability: ['asi'], decel_9mo_action: ['continue'] }],
      edges: [
        { id: 'robust', label: 'Solved — robust' },
        { id: 'brittle', label: 'Solved — brittle / partial', shortLabel: 'Brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet', disabledWhen: [{ alignment: ['brittle'], reason: 'Alignment is already partially solved' }] }
      ] },
    { id: 'decel_12mo_action', label: '12mo Decision', stage: 2,
      activateWhen: [
        {
          capability: ['asi'],
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
      activateWhen: [{ capability: ['asi'], decel_12mo_action: ['continue'] }],
      edges: [
        { id: 'robust', label: 'Solved — robust' },
        { id: 'brittle', label: 'Solved — brittle / partial', shortLabel: 'Brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet', disabledWhen: [{ alignment: ['brittle'], reason: 'Alignment is already partially solved' }] }
      ] },
    { id: 'decel_18mo_action', label: '18mo Decision', stage: 2,
      activateWhen: [
        {
          capability: ['asi'],
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
      activateWhen: [{ capability: ['asi'], decel_18mo_action: ['continue'] }],
      edges: [
        { id: 'robust', label: 'Solved — robust' },
        { id: 'brittle', label: 'Solved — brittle / partial', shortLabel: 'Brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet', disabledWhen: [{ alignment: ['brittle'], reason: 'Alignment is already partially solved' }] }
      ] },
    { id: 'decel_24mo_action', label: '24mo Decision', stage: 2,
      activateWhen: [
        {
          capability: ['asi'],
          decel_24mo_progress: ['robust', 'brittle', 'unsolved']
        }
      ],
      edges: [ { id: 'rival', label: 'Rival reaches parity' } ] },
    { id: 'proliferation_control', label: 'Proliferation Control', stage: 2,
      hideWhen: [
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } },
        { alignment_durability: ['breaks'], ai_goals: { not: ['marginal'] } }
      ],
      // Simplified gate: ask about proliferation control whenever an ASI
      // exists and alignment hasn't catastrophically failed. Three post-decel
      // cells write alignment='failed' — (escapes, *) and (rival, unsolved)
      // — and are excluded uniformly; all other cells preserve or set
      // alignment to robust/brittle and activate this question normally.
      activateWhen: [
        {
          capability: ['asi'],
          alignment: { not: ['failed'] }
        }
      ],
      edges: [
        { id: 'deny_rivals', label: 'Deny rivals', disabledWhen: [{ distribution: ['open'], reason: 'The technology is already openly distributed' }] },
        { id: 'secure_access', label: 'Secure access', disabledWhen: [{ distribution: ['open'], reason: 'The technology is already openly distributed' }] },
        { id: 'none', label: 'Open access' }
      ] },
    { id: 'proliferation_outcome', label: 'Control Outcome', stage: 2,
      hideWhen: [
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } },
        { alignment_durability: ['breaks'], ai_goals: { not: ['marginal'] } }
      ],
      activateWhen: [
        {
          capability: ['asi'],
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
          capability: ['asi'],
          alignment: ['robust'],
          proliferation_outcome: ['leaks_public']
        }
      ],
      edges: [
        { id: 'holds', label: 'Alignment is intrinsic', shortLabel: 'Intrinsic' },
        { id: 'breaks', label: 'Someone cracks it' }
      ] },
    { id: 'intent', label: 'Intent', stage: 2, forwardKey: true,
      hideWhen: [{ ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } }],
      activateWhen: [
        { capability: ['asi'], alignment: ['robust', 'brittle'], proliferation_control: true },
        {
          capability: ['asi'],
          alignment: ['failed'], containment: ['contained']
        },
        { capability: ['asi'], ai_goals: ['marginal'] }
      ],
      // deriveWhen removed: the peaceful-war intent overrides
      // (escalation_outcome=agreement | post_war_aims=human_centered →
      // intent='coexistence') moved into WAR_MODULE's exit plan. WAR is
      // the rightful writer of those dims, so it owns the intent override.
      // Same pattern as the prior moves of `pushback_outcome → international`
      // (deleted when who_benefits became a module) and `rival_dynamics →
      // intent` (now in INTENT_MODULE's rival_dynamics edges).
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
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } },
        { alignment_durability: ['breaks'], ai_goals: { not: ['marginal'] } }
      ],
      activateWhen: [
        {
          capability: ['asi'],
          alignment: ['robust', 'brittle'],
          proliferation_control: ['secure_access'],
          proliferation_outcome: ['holds'],
          intent: ['self_interest', 'international']
        }
      ],
      edges: [ { id: 'attempt', label: 'Attempt to block' }, { id: 'no_attempt', label: 'No attempt' } ] },
    { id: 'block_outcome', label: 'Blocking Outcome', stage: 2,
      hideWhen: [
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } },
        { alignment_durability: ['breaks'], ai_goals: { not: ['marginal'] } }
      ],
      activateWhen: [{ capability: ['asi'], block_entrants: ['attempt'] }],
      edges: [ { id: 'holds', label: 'Holds' }, { id: 'fails', label: 'Fails' } ] },
    { id: 'new_entrants', label: 'New Entrants?', stage: 2,
      hideWhen: [
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } },
        { alignment_durability: ['breaks'], ai_goals: { not: ['marginal'] } }
      ],
      activateWhen: [{ capability: ['asi'], block_entrants: ['no_attempt'] }],
      edges: [ { id: 'emerge', label: 'Emerge' }, { id: 'none', label: 'None' } ] },
    { id: 'rival_dynamics', label: 'Rival Dynamics', stage: 2,
      hideWhen: [
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } },
        { alignment_durability: ['breaks'], ai_goals: { not: ['marginal'] } }
      ],
      activateWhen: [
        { capability: ['asi'], block_outcome: ['fails'] },
        { capability: ['asi'], new_entrants: ['emerge'] }
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
    // war_survivors — narrowed to the war-destruction branch only. The
    // escape-catch branch is handled by collateral_survivors (declared in
    // ESCAPE_MODULE), which writes to the same `war_survivors` sel dim
    // so downstream consumers (outcome templates, ruin_type) are unaware
    // of the split.
    { id: 'war_survivors', label: 'Humanity Survives?', stage: 3,
      activateWhen: [
        { conflict_result: ['destruction'] }
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
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } }
      ],
      activateWhen: [
        {
          capability: ['asi'],
          alignment: ['robust', 'brittle'],
          intent: ['international', 'coexistence'],
          post_war_aims: false
        },
        {
          capability: ['asi'],
          brittle_resolution: ['escape'],
          intent: ['international', 'coexistence'],
          post_war_aims: false
        },
        {
          capability: ['asi'],
          alignment: ['failed'], containment: ['contained'],
          intent: ['international', 'coexistence'],
          post_war_aims: false
        },
        {
          capability: ['asi'],
          ai_goals: ['marginal'],
          intent: ['international', 'coexistence'],
          post_war_aims: false
        },
        { capability: ['asi'], intent: ['self_interest'] },
        { capability: ['asi'], post_war_aims: true },
        { capability: ['asi'], escalation_outcome: ['standoff'] }
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
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } }
      ],
      activateWhen: [{ power_promise: true }],
      edges: [
        { id: 'strong', label: 'Strong mobilization' },
        { id: 'weak', label: 'Weak or fragmented' },
        { id: 'none', label: 'No meaningful mobilization', shortLabel: 'No mobilization' }
      ] },
    { id: 'sincerity_test', label: 'Sincerity Test', stage: 3,
      hideWhen: [
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } }
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
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } }
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
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } }
      ],
      activateWhen: [{ mobilization: ['weak'] }],
      edges: [
        { id: 'coalesces', label: 'Coalition forms' },
        { id: 'fragments', label: 'Fragmentation holds' }
      ] },
    { id: 'benefit_distribution', label: 'Who Benefits?', stage: 3, priority: 2,
      hideWhen: [{ ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } }],
      // Internal to who_benefits module: activated via the module's upstream
      // pipeline (power_promise → mobilization → ...), plus the benevolent
      // derivation bypass and the post-catch characterisation path.
      activateWhen: [
        ...WHO_BENEFITS_INTERNAL_ACTIVATE,
        { capability: ['asi'], ai_goals: ['benevolent'] },
        { capability: ['asi'], post_catch: ['contained'] }
      ],
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
          ],
          // Self-interest + unequal = capture-ish world; the "did delivery
          // match intent?" question doesn't add narrative value on top of
          // the power-concentration framing (intent was to capture, and
          // capture happened). Mark ineligible so failure_mode skips.
          collapseToFlavor: { when: { intent: ['self_interest'] }, set: { delivery_ask_eligible: 'no' } } },
        { id: 'extreme', label: 'Power concentrates',
          disabledWhen: [
            { ai_goals: ['benevolent'], capability: ['singularity'], reason: 'A genuinely benevolent superintelligence has no reason to concentrate power — it bypasses human structures entirely' },
            { power_promise: ['for_everyone'], mobilization: ['strong'], reason: 'Promise and accountability together prevent extreme concentration' },
            { sincerity_test: ['sincere'], reason: 'The cooperative intent proved genuine — power didn\'t concentrate this far' },
            { pushback_outcome: ['succeeds'], reason: 'The pushback forced genuine redistribution' },
            { pushback_outcome: ['partial'], reason: 'Real concessions were made — not equality, but enough to prevent lock-in' }
          ],
          // Extreme concentration → the-capture territory. The outcome is
          // defined by power concentration; delivery drift isn't a useful
          // orthogonal axis here. Mark ineligible regardless of intent.
          collapseToFlavor: { set: { delivery_ask_eligible: 'no' } } }
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
    // knowledge_rate / physical_rate — unified across three contexts
    // keyed on the post-emergence `capability` value:
    //   • capability='asi' (main singularity path) — rollout exits on
    //       failure_mode.*; all three rollout dims (knowledge_rate,
    //       physical_rate, failure_mode) move to flavor via the module
    //       exit tuple.
    //   • capability='plateau' — rollout exits on physical_rate.*; both
    //       dims move to flavor via the module exit tuple (same mechanism).
    //   • capability='agi' (AGI-only / auto-shallow) — same as plateau.
    //
    // The `rollout_set` completion marker (set by every module exit tuple)
    // doubles as the post-answer hide for all three nodes. Narrative /
    // templates read the dim via fused state (sel ∪ flavor), so moving
    // to flavor on exit is narrative-safe.
    //
    // `limited` is always present as an edge (per user: "always have limited
    // as an option, it just gets disabled sometimes"). It's disabled
    // everywhere except on the plateau path with short stalls for knowledge;
    // for physical it's available on plateau and auto-shallow.
    //
    // `rapid` on physical_rate is disabled on the plateau path (the original
    // plateau_physical_rate had no rapid edge).
    { id: 'knowledge_rate', label: 'Knowledge Work', stage: 3, priority: 2,
      hideWhen: [
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } },
        { rollout_set: ['yes'] }
      ],
      activateWhen: [
        ...OUTCOME_ACTIVATE,
        { capability: ['plateau'] },
        { capability: ['agi'] }
      ],
      edges: [
        { id: 'rapid', label: 'Rapid',
          disabledWhen: [{ capability: ['plateau'], stall_duration: ['hours', 'days'], reason: 'At this stall duration, rapid adoption isn\'t possible' }] },
        { id: 'gradual', label: 'Gradual',
          disabledWhen: [{ capability: ['plateau'], stall_duration: ['hours'], reason: 'The stall is too short for gradual rollout' }] },
        { id: 'uneven', label: 'Uneven' },
        { id: 'limited', label: 'Limited',
          disabledWhen: [
            { capability: ['asi'], reason: 'At this capability, AI displaces rather than augments knowledge work' },
            { capability: ['plateau'], stall_duration: ['weeks', 'months'], reason: 'With a longer stall, AI has room to move beyond augmentation' }
          ] }
      ] },
    { id: 'physical_rate', label: 'Physical Automation', stage: 3, priority: 2,
      hideWhen: [
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } },
        { rollout_set: ['yes'] }
      ],
      activateWhen: [
        ...OUTCOME_ACTIVATE,
        { capability: ['plateau'] },
        { capability: ['agi'] }
      ],
      edges: [
        { id: 'rapid', label: 'Rapid',
          disabledWhen: [{ capability: ['plateau'], reason: 'Physical automation can\'t be rapid while AI itself is plateaued' }] },
        { id: 'gradual', label: 'Gradual',
          disabledWhen: [{ capability: ['plateau'], stall_duration: ['hours'], reason: 'The stall is too short for gradual rollout' }] },
        { id: 'uneven', label: 'Uneven' },
        { id: 'limited', label: 'Limited',
          disabledWhen: [{ capability: ['asi'], reason: 'At this capability, physical automation moves beyond augmentation' }] }
      ] },
    { id: 'brittle_resolution', label: 'Long-Term Alignment Fate', stage: 3, priority: 1,
      hideWhen: [
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } },
        { containment: ['escaped'] }
      ],
      // Gated on who_benefits_set: brittle_resolution is a "final
      // surprise" that fires near the end of the chain, after
      // who_benefits has resolved. Without this gate, brittle_resolution
      // becomes askable as soon as ALIGNMENT_MODULE exits with
      // alignment=brittle, which would jump it ahead of who_benefits
      // on some paths.
      activateWhen: [
        {
          capability: ['asi'],
          alignment: ['brittle'],
          alignment_durability: ['holds'],
          who_benefits_set: ['yes']
        }
      ],
      // Each edge directly writes the final alignment/containment values —
      // replaces the old alignment.deriveWhen + containment.deriveWhen rules
      // keyed on brittle_resolution, so ALIGNMENT_MODULE no longer needs
      // to read this dim. brittle_resolution only activates on alignment=
      // brittle paths, so 'solved' (alignment gets fully solved later) sets
      // alignment='robust', 'escape' flips to alignment='failed' +
      // containment='escaped', and 'sufficient' keeps alignment='brittle'
      // (no-op, written explicitly for clarity).
      edges: [
        { id: 'solved', label: 'Alignment fully solved', shortLabel: 'Fully solved',
          collapseToFlavor: { set: { alignment: 'robust' } } },
        { id: 'sufficient', label: 'Brittle alignment holds', shortLabel: 'Brittle holds',
          collapseToFlavor: { set: { alignment: 'brittle' } } },
        { id: 'escape', label: 'AI eventually escapes', shortLabel: 'Escapes',
          collapseToFlavor: { set: { alignment: 'failed', containment: 'escaped' } } }
      ] },
    { id: 'failure_mode', label: 'Delivery', stage: 3, priority: 2, forwardKey: true,
      hideWhen: [
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } },
        { rollout_set: ['yes'] }
      ],
      // After Who Benefits completes, delivery is eligible unless the world
      // already ended in a capture-like shape (benefit_distribution=extreme,
      // or self-interest + unequal — see benefit_distribution edges, which
      // set `delivery_ask_eligible: 'no'` on those paths). The benevolent
      // bypass keeps the delivery question askable even on benevolent-AI
      // paths that bypass the regular who_benefits flow.
      activateWhen: [
        { capability: ['asi'], who_benefits_set: ['yes'], delivery_ask_eligible: { not: ['no'] } },
        { capability: ['asi'], ai_goals: ['benevolent'] }
      ],
      edges: [
        { id: 'none', label: 'Succeeds' },
        { id: 'drift', label: 'Wrong metrics' }
      ] },
    { id: 'escape_method', label: 'Method', stage: 3,
      hideWhen: [{ war_survivors: ['none'] }],
      activateWhen: [
        {
          capability: ['asi'],
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
            { ai_goals: ['alien_coexistence'], reason: 'A tolerant alien intelligence reshapes infrastructure, not biology' }
          ] },
        { id: 'pathogens', label: 'Engineered pathogens', disabledWhen: [
            { ai_goals: ['alien_coexistence'], reason: 'Bioweapons are incompatible with leaving room for humanity' }
          ] },
        { id: 'autonomous_weapons', label: 'Autonomous weapons', disabledWhen: [{ ai_goals: ['alien_coexistence'], reason: 'Military force is incompatible with leaving room for humanity' }] },
        { id: 'industrial', label: 'Industrial conversion', shortLabel: 'Industrial' }
      ] },
    { id: 'escape_timeline', label: 'Execution Speed', stage: 3,
      hideWhen: [{ war_survivors: ['none'] }],
      activateWhen: [
        {
          capability: ['asi'],
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
          capability: ['asi'],
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
      // `not_permanent` fuses the pre-merge `never_stopped`
      // (response_success=no) and `holds_temporarily`
      // (response_success=yes) edges: both describe outcomes where the AI
      // isn't permanently stopped, and each was only ever available under
      // its own response_success branch — so they never coexisted as
      // distinct choices at the same state. Narrative/flavor text
      // disambiguates the two cases by reading response_success from
      // flavor (via narrSel / resolvedStateWithFlavor). Collapsing them
      // halves the module's terminal-edge fan-out on catch_outcome.
      edges: [
        { id: 'not_permanent', label: 'The AI isn\'t permanently stopped', shortLabel: 'Not permanent' },
        { id: 'holds_permanently', label: 'The stop holds permanently', shortLabel: 'Holds permanently',
          requires: { response_success: ['yes'] } }
      ] },
    // collateral_survivors — the escape-pipeline twin of war_survivors.
    // Fires only on the civilizational-collateral branch of the catch path
    // (catch_outcome=holds_permanently + collateral_impact=civilizational)
    // and writes to the shared `war_survivors` sel dim via
    // collapseToFlavor.set — so downstream consumers (outcome templates,
    // ruin_type) read one canonical key regardless of which pipeline
    // produced the survivor count. Narrative is AI-catastrophe flavored,
    // distinct from the war_survivors node which stays war-flavored.
    { id: 'collateral_survivors', label: 'Humanity Survives?', stage: 3,
      activateWhen: [
        { catch_outcome: ['holds_permanently'], collateral_impact: ['civilizational'] }
      ],
      edges: [
        { id: 'most', label: 'Most — devastated but recoverable', shortLabel: 'Most survive' },
        { id: 'remnants', label: 'Remnants — civilization collapses', shortLabel: 'Remnants' },
        { id: 'none', label: 'None — extinction' }
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
        { match: { post_catch: ['ruined'] }, value: 'self_inflicted' },
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
        unsolved: { alignment: 'failed', geo_spread: 'multiple', rival_emerges: 'yes', governance: 'slowdown', decel_align_progress: 'unsolved', _provenance: 'parity_failed' },
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
        'open_source',     // decel_6mo_action + decel_12mo_action.escapes/continue/accelerate.requires
        'capability',      // all progress/action activateWhen (capability='asi')
    ],
    // Globals the reducer commits to sel on exit. Only the three dims
    // below are read as sel by external gate logic (alignment by many
    // downstream activateWhen/hideWhen rules, geo_spread by sovereignty /
    // intent / war clauses, containment by escape / proliferation /
    // rollout clauses). governance / decel_align_progress / rival_emerges
    // are written too but only for narrative — see internalMarkers.
    writes: [
        'alignment',
        'geo_spread',
        'containment',
    ],
    // Markers that the reducer sets mid-tick into sel (so internal gates
    // can observe them) but which no external sel-only logic reads — they
    // get evicted into flavor at module exit, where outcome templates still
    // see them via fused state.
    //   * rival_emerges — pure provenance tag (post-decel multi-polar
    //     world caused by deceleration). Read only by outcome templates.
    //   * governance — race / slowdown / governed / partial tagline. Read
    //     only by outcome templates; governance_window already writes it
    //     to flavor via setFlavor, and this move makes the decel path
    //     consistent.
    //   * decel_align_progress — robust / brittle / unsolved marker. No
    //     external gate reads it post-simplification; kept in flavor only
    //     for snapshot tests and possible future narrative use.
    internalMarkers: ['rival_emerges', 'governance', 'decel_align_progress'],
    nodeIds: DECEL_MODULE_NODE_IDS,
    reduce: decelReduce,
    reducerTable: DECEL_REDUCER_TABLE,  // exposed for audit + tests
    get exitPlan() { return buildDecelExitPlan(); },
};

// ════════════════════════════════════════════════════════
// ESCAPE_MODULE — the "AI out of control" sub-loop
// ════════════════════════════════════════════════════════
//
// 9 internal dims, in order (inert_stays lives OUTSIDE the module):
//   ai_goals → (if hostile) escape_method → escape_timeline
//     → discovery_timing → response_method → response_success
//     → collateral_impact → catch_outcome
//     → (if holds_permanently + civilizational) collateral_survivors
//
// Activation: the two legacy ai_goals activation conditions. By widening
// the module gate from the old "hostile-only" activateWhen to these
// broader conditions, the module wraps ai_goals itself and becomes
// reusable — the same encapsulated "what does the AI want? then what
// happens?" sub-flow fires in both:
//   (a) cap=singularity, auto=deep, alignment=failed, containment=escaped
//   (b) concentration_type=ai_itself
//
// Inert-wakes loop (late re-entry, not an internal sub-flow):
//   `inert_stays` is intentionally a flat node (priority: 1, outside
//   the module) gated on who_benefits_set so the user walks the full
//   marginal-path flow (who_benefits, etc.) before being asked whether
//   the AI actually stays inert. Priority 1 (vs rollout's pri 2) ensures
//   it fires AFTER who_benefits but BEFORE rollout begins. Two outcomes:
//     * inert_stays=yes — nothing further; the marginal pick stands.
//     * inert_stays=no — the edge's collapseToFlavor evicts both
//       `ai_goals` and `escape_set` (the completion marker) to flavor.
//       With the marker cleared, _isModulePending flips back to true;
//       module-first priority scheduling then re-walks ai_goals (with
//       marginal disabled via ai_goals.marginal.disabledWhen) and the
//       full escape pipeline. On pipeline completion `escape_set` is
//       set again and the module exits normally.
//
// Early exits. ai_goals has 7 edges; 5 hostile goals lead into the
// escape pipeline; marginal exits the module directly (inert_stays is
// asked later as a flat node); benevolent short-circuits with no
// pipeline. escape_method's own activateWhen gates the pipeline start —
// so only hostile answers trigger the follow-ups. Swarm is additionally
// disabled on concentration_type=ai_itself via its node-level
// disabledWhen.
//
// External contract:
//   * writes = 4 sel dims — ai_goals (externally consumed across many
//     hideWhen clauses, outcome templates, and downstream nodes),
//     catch_outcome and collateral_impact (read by outcome templates and
//     the vignette builder), and war_survivors (shared with WAR_MODULE's
//     war_survivors node; written only via collateral_survivors edges).
//     All stay in sel post-exit.
//   * The remaining internal dims (escape_method, escape_timeline,
//     discovery_timing, response_method, response_success,
//     collateral_survivors) are pure flavor — nothing outside the
//     module reads them from sel. Templates and narrative variants
//     that reference them go through resolvedStateWithFlavor /
//     narrativeState, so flavor lookups work. attachModuleReducer
//     auto-computes move = nodeIds \ writes and evicts them to flavor
//     on exit.
//   * completionMarker: `escape_set`. The auto-detection (last write)
//     would pick war_survivors which is only set on one tail branch, so
//     we declare an explicit marker and set it on every exit tuple.
//
// No reducerTable — walker falls through to normal DFS inside the module.
// /explore hub uses dynamic atomic-cell enumeration.

const ESCAPE_NODE_IDS = [
    'ai_goals',
    // `inert_stays` is intentionally NOT in the module. It sits outside
    // as a flat node (priority: 1, gated on who_benefits_set) so the
    // user walks the full marginal-path flow (who_benefits, etc.) before
    // being asked whether the AI actually stays inert. On
    // inert_stays=no, the edge's collapseToFlavor evicts both `ai_goals`
    // and `escape_set` — which clears the module's completion marker
    // and lets it re-enter with a hostile ai_goals pick (marginal
    // disabled).
    'escape_method',
    'escape_timeline',
    'discovery_timing',
    'response_method',
    'response_success',
    'collateral_impact',
    'catch_outcome',
    // collateral_survivors — tail node on the
    // (holds_permanently + civilizational) sub-branch. Writes to the
    // shared `war_survivors` sel dim (see buildEscapeExitPlan).
    'collateral_survivors',
];

const ESCAPE_WRITES = [
    'ai_goals',
    // post_catch consolidates (catch_outcome, collateral_impact) into a
    // single 3-valued marker for cross-module routing: loose | contained
    // | ruined. See buildEscapeExitPlan for the mapping. The raw
    // catch_outcome + collateral_impact nodeIds are NOT in writes, so
    // attachModuleReducer's nodeIds\writes rule auto-evicts them to
    // flavor on exit — outcome templates (narrative variants under
    // flavors.catch_outcome.* and flavors.collateral_impact.*) still see
    // them via fused state.
    'post_catch',
    // war_survivors is written by collateral_survivors edges via the
    // exit plan's set-block (shared dim with the standalone war module).
    'war_survivors',
    // ESCAPE overrides containment='contained' on the post_catch=contained
    // exit. Replaces the old containment.deriveWhen rule so ALIGNMENT_MODULE
    // no longer needs to read post_catch.
    'containment',
    'escape_set',
];

function escapeReduce(local) {
    const bundle = {};
    for (const k of ESCAPE_WRITES) {
        if (local[k] !== undefined) bundle[k] = local[k];
    }
    return bundle;
}

// Exit edges:
//   * ai_goals.benevolent — benign AI, no pipeline.
//   * ai_goals.marginal — AI is inert (for now), no pipeline. The
//     late-priority flat node `inert_stays` asks later whether the
//     inertia holds; on `no` it evicts `ai_goals` + `escape_set` so the
//     module re-enters for a hostile re-pick + full pipeline.
//   * catch_outcome.not_permanent — always a direct exit.
//   * catch_outcome.holds_permanently — direct exit EXCEPT when
//     collateral_impact=civilizational; that branch defers to
//     collateral_survivors.
//   * collateral_survivors.{most, remnants, none} — pipeline-complete
//     exits on the civilizational-collateral tail. Each writes the
//     chosen value back to the shared `war_survivors` sel dim via the
//     exit-tuple `set` block (attachModuleReducer installs it as a
//     collapseToFlavor.set on the edge).
// All set `escape_set: 'yes'`.
function buildEscapeExitPlan() {
    const plan = [];
    // ai_goals.{benevolent, marginal} — early exits, no escape pipeline
    // ran, so post_catch stays undefined (outcome clauses keyed on
    // post_catch just don't fire on these paths, same as they never
    // fired on catch_outcome before the consolidation).
    const aiGoals = NODE_MAP.ai_goals;
    if (aiGoals && aiGoals.edges) {
        const earlyExits = new Set(['benevolent', 'marginal']);
        for (const e of aiGoals.edges) {
            if (!earlyExits.has(e.id)) continue;
            plan.push({
                nodeId: 'ai_goals', edgeId: e.id,
                when: {},
                set: { escape_set: 'yes' },
            });
        }
    }
    // catch_outcome.not_permanent — always a direct exit. post_catch=loose.
    plan.push({
        nodeId: 'catch_outcome', edgeId: 'not_permanent',
        when: {},
        set: { escape_set: 'yes', post_catch: 'loose' },
    });
    // catch_outcome.holds_permanently — exits directly when
    // collateral_impact is NOT civilizational. post_catch=contained.
    // In the civilizational case, the module defers to
    // collateral_survivors (no exit tuple matches here, so the module
    // stays pending and module-first scheduling picks the next
    // internal node — collateral_survivors).
    plan.push({
        nodeId: 'catch_outcome', edgeId: 'holds_permanently',
        when: { collateral_impact: { not: ['civilizational'] } },
        // containment flips escaped→contained here (replaces the old
        // containment.deriveWhen { post_catch: 'contained' → 'contained' }).
        set: { escape_set: 'yes', post_catch: 'contained', containment: 'contained' },
    });
    // collateral_survivors — tail exits for the civilizational branch.
    // post_catch=ruined. Each edge also writes its own value into the
    // shared war_survivors dim.
    const cs = NODE_MAP.collateral_survivors;
    if (cs && cs.edges) {
        for (const e of cs.edges) {
            plan.push({
                nodeId: 'collateral_survivors', edgeId: e.id,
                when: {},
                set: { escape_set: 'yes', post_catch: 'ruined', war_survivors: e.id },
            });
        }
    }
    return plan;
}

const ESCAPE_MODULE = {
    id: 'escape',
    // Mirrors ai_goals's own activateWhen exactly — so the module is pending
    // from the moment ai_goals would first be askable through to either an
    // early-exit (benevolent/marginal) or pipeline completion (catch_outcome).
    activateWhen: [
        {
            capability: ['asi'],
            alignment: ['failed'],
            containment: ['escaped'],
        },
        { concentration_type: ['ai_itself'] },
    ],
    reads: [
        // Gates into the pipeline (escape_method.activateWhen, various
        // pipeline hideWhen/disabledWhen clauses)
        'capability', 'alignment', 'containment',
        'concentration_type', 'geo_spread',
        // inert_stays.no re-triggers this module (evicts ai_goals + escape_set)
        // and is read by ai_goals.marginal.disabledWhen on re-entry.
        'inert_stays',
    ],
    writes: ESCAPE_WRITES,
    nodeIds: ESCAPE_NODE_IDS,
    completionMarker: 'escape_set',
    reduce: escapeReduce,
    get exitPlan() { return buildEscapeExitPlan(); },
};

// Phase 3 runtime primitive — attach the module's reducer output to the
// terminating-edge collapseToFlavor blocks. Given an exit plan (a list of
// { nodeId, edgeId, when, set } tuples), install collapseToFlavor on the
// matching edges. The `move` list is the set of internal dims that are
// NOT also writes — they get evicted from sel into flavor on module exit,
// while writes stay in sel for downstream consumers. For decel, writes ∩
// nodeIds = ∅ so move = all 14 internal dims (same as legacy collapse).
// For escape, writes ⊂ nodeIds so move = the 3 pure-flavor dims.
//
// Dormant until attached — Phase 4a wires it up for the decel module,
// and the escape module attaches the same way once registered.
function attachModuleReducer(mod) {
    if (!mod || !mod.exitPlan) return;
    const writes = new Set(mod.writes || []);
    // Auto-moved on exit:
    //   * nodeIds \ writes — "pure-internal" question dims that don't need
    //     to persist globally.
    //   * internalMarkers — non-nodeId marker dims that are set into sel
    //     mid-module (for internal hideWhen/activateWhen gates) but aren't
    //     read by any external sel-only logic post-exit. They move to
    //     flavor so narrative/templates (fused state) still see them.
    const moveDims = (mod.nodeIds || []).filter(d => !writes.has(d))
        .concat(mod.internalMarkers || []);
    // Group by (nodeId, edgeId) so multiple progress-when cells stack up
    // on the same edge as a collapseToFlavor ARRAY.
    const byEdge = new Map();
    for (const tuple of mod.exitPlan) {
        const key = tuple.nodeId + '|' + tuple.edgeId;
        if (!byEdge.has(key)) byEdge.set(key, []);
        byEdge.get(key).push({ when: tuple.when, set: tuple.set, move: moveDims.slice() });
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

// ════════════════════════════════════════════════════════
// WHO_BENEFITS_MODULE — the "who gets the gains?" sub-loop
// ════════════════════════════════════════════════════════
//
// Pipeline: power_promise → mobilization → {sincerity_test |
// pushback_outcome | coalition_outcome} → benefit_distribution →
// (extreme only) concentration_type → ({singleton, inner_circle}
// only) power_use. Three exit paths:
//   * benefit_distribution ∈ {equal, unequal} — direct exit
//   * benefit_distribution = extreme → concentration_type ∈
//     {elites, ai_itself} — exits after concentration_type
//   * benefit_distribution = extreme → concentration_type ∈
//     {singleton, inner_circle} → power_use.* — exits after power_use
//
// External contract:
//   * writes = [concentration_type] — only dim with an external sel-only
//     gate reader (ai_goals / escape_method / escape_timeline /
//     discovery_timing all gate on concentration_type=ai_itself in
//     activateWhen). concentration_type is only written on the extreme
//     path; on the equal/unequal exits it's undefined in sel, which
//     is correct (its own activateWhen gates on
//     benefit_distribution=extreme).
//   * benefit_distribution is NOT in writes: its only sel-level reader
//     is concentration_type (internal). Templates / narrative read it
//     through the fused view (resolvedStateWithFlavor / narrEff), so
//     it safely collapses to flavor on module exit via the standard
//     nodeIds \ writes auto-eviction in attachModuleReducer.
//   * nodeIds = all 8 dims. Move list (nodeIds \ writes) = the 7
//     non-concentration_type dims — all of them are flavor-only
//     external consumers (template flavors/reachables, narrative
//     contextWhen) rendered via narrEff, so they safely evict on exit.
//
// Completion marker:
//   The auto-detection (`writes[-1]` = concentration_type) would
//   wrongly flag equal/unequal exits as still-pending (because
//   concentration_type is never set on those paths). Instead we
//   declare a custom marker `who_benefits_set` and set it in the
//   `set` block of every exit tuple. First module to need this;
//   the completionMarker field has existed in the contract since
//   decel but wasn't exercised.
//
// Walker: no reducerTable — the exit space (5 pre-exit picks × 3
// benefit_distribution edges × 4 concentration_type edges) would
// produce ~dozens of cells with no real compression win. Walker
// falls through to normal DFS inside, same as escape.

const WHO_BENEFITS_NODE_IDS = [
    'power_promise',
    'mobilization',
    'sincerity_test',
    'pushback_outcome',
    'coalition_outcome',
    'benefit_distribution',
    'concentration_type',
    // power_use is a stage-3 tail: activates on
    // concentration_type ∈ {singleton, inner_circle} and writes to
    // flavor-only outcome templates (no `reachable` refs, no external
    // hideWhen/activateWhen). Exit tuples on the two concentration_type
    // edges that activate it defer completion to power_use; on
    // {elites, ai_itself} concentration_type still exits directly.
    'power_use',
];

// Note: `benefit_distribution` is read only by WHO_BENEFITS-internal
// nodes (concentration_type.activateWhen) and by templates / narrative,
// which resolve through fused state (sel ∪ flavor). Nothing outside the
// module gates on it, so it's safe to move to flavor on module exit
// (via nodeIds \ writes auto-eviction in attachModuleReducer).
//
// `delivery_ask_eligible` is a synthetic marker (no host node) set by
// benefit_distribution edges via `collapseToFlavor.set` to signal to
// failure_mode in ROLLOUT whether the delivery-drift question makes
// sense on this path. Listed here to document the cross-module output;
// the audit only cares about node-id writes, so this is informational.
const WHO_BENEFITS_WRITES = [
    'concentration_type',
    'delivery_ask_eligible',
    // Completion marker — must be in `writes` so `captureExitResult`
    // puts it into `setSel` (not setFlavor). Without this, the sel-only
    // outer DFS never sees the module as done and re-fires it.
    'who_benefits_set',
];

function whoBenefitsReduce(local) {
    const bundle = {};
    for (const k of WHO_BENEFITS_WRITES) {
        if (local[k] !== undefined) bundle[k] = local[k];
    }
    return bundle;
}

// Exit tuples. `set: { who_benefits_set: 'yes' }` on every exit
// edge so completionMarker detects the module as done regardless of
// which path was taken. No `when` gates — the edge id carries the
// distinction.
function buildWhoBenefitsExitPlan() {
    const plan = [];
    const bd = NODE_MAP.benefit_distribution;
    if (bd && bd.edges) {
        for (const e of bd.edges) {
            // Only equal/unequal are direct exits. `extreme` keeps the
            // module active so concentration_type gets asked next.
            if (e.id === 'extreme') continue;
            plan.push({
                nodeId: 'benefit_distribution',
                edgeId: e.id,
                when: {},
                set: { who_benefits_set: 'yes' },
            });
        }
    }
    const ct = NODE_MAP.concentration_type;
    if (ct && ct.edges) {
        // power_use.activateWhen = { concentration_type:
        // [singleton, inner_circle] }. Defer module exit on those two
        // edges so power_use gets asked next; exit directly on
        // {elites, ai_itself} which don't activate power_use.
        const deferToPowerUse = new Set(['singleton', 'inner_circle']);
        for (const e of ct.edges) {
            if (deferToPowerUse.has(e.id)) continue;
            plan.push({
                nodeId: 'concentration_type',
                edgeId: e.id,
                when: {},
                set: { who_benefits_set: 'yes' },
            });
        }
    }
    // power_use tail exit — all three edges are terminal.
    const pu = NODE_MAP.power_use;
    if (pu && pu.edges) {
        for (const e of pu.edges) {
            plan.push({
                nodeId: 'power_use',
                edgeId: e.id,
                when: {},
                set: { who_benefits_set: 'yes' },
            });
        }
    }
    return plan;
}

const WHO_BENEFITS_MODULE = {
    id: 'who_benefits',
    // Mirror power_promise's activation exactly — the loop is gated on
    // power_promise being askable, and power_promise's activateWhen is
    // the tightest shared precondition across all 7 internal dims.
    activateWhen: [
        {
            capability: ['asi'],
            alignment: ['robust', 'brittle'],
            intent: ['international', 'coexistence'],
            post_war_aims: false,
        },
        {
            capability: ['asi'],
            brittle_resolution: ['escape'],
            intent: ['international', 'coexistence'],
            post_war_aims: false,
        },
        {
            capability: ['asi'],
            alignment: ['failed'], containment: ['contained'],
            intent: ['international', 'coexistence'],
            post_war_aims: false,
        },
        {
            capability: ['asi'],
            ai_goals: ['marginal'],
            intent: ['international', 'coexistence'],
            post_war_aims: false,
        },
        { capability: ['asi'], intent: ['self_interest'] },
        { capability: ['asi'], post_war_aims: true },
        { capability: ['asi'], escalation_outcome: ['standoff'] },
    ],
    reads: [
        'capability', 'alignment', 'containment', 'intent',
        'ai_goals', 'post_war_aims', 'escalation_outcome',
        'brittle_resolution',
        // benefit_distribution activates via post_catch (the consolidated
        // escape-exit marker).
        'post_catch',
    ],
    writes: WHO_BENEFITS_WRITES,
    nodeIds: WHO_BENEFITS_NODE_IDS,
    completionMarker: 'who_benefits_set',
    reduce: whoBenefitsReduce,
    get exitPlan() { return buildWhoBenefitsExitPlan(); },
};

// ════════════════════════════════════════════════════════
// ROLLOUT_MODULE — the "how does the transformation play out?" sub-loop
// ════════════════════════════════════════════════════════
//
// Groups the three stage-3 "rollout" questions:
//   * knowledge_rate — pace of AI impact on knowledge work
//   * physical_rate  — pace of AI impact on physical work
//   * failure_mode   — "Delivery": does the transformation match intent,
//     or do the metrics diverge from reality? (only asked on main path)
//
// Three contexts, keyed on the post-emergence `capability` value:
//   * capability='asi' (+ outcome gates) — main path: all three asked; all
//     three move to flavor on module exit (failure_mode.* edges).
//   * capability='plateau' — only knowledge_rate and physical_rate asked;
//     both move to flavor on module exit (physical_rate.* edges).
//     failure_mode never activates (its activateWhen requires asi).
//   * capability='agi' (AGI-only / auto-shallow) — same as plateau: only
//     knowledge/physical, exit on physical_rate.
//
// Writes: [] — no dim needs to persist globally. All three rollout dims
// have zero external sel-only gate readers; every consumer (outcome
// templates, narrative flavors / contextWhen) resolves via fused state
// (sel ∪ flavor via resolvedStateWithFlavor / narrEff). The module exit
// tuples set `rollout_set: 'yes'` and attachModuleReducer auto-moves
// nodeIds \ writes = all 3 dims to flavor.
//
// Post-exit self-hide: each of the 3 nodes adds `{ rollout_set: ['yes'] }`
// to hideWhen so findNextQ doesn't re-offer them once their dim sits in
// flavor instead of sel.
//
// Completion marker: `rollout_set`. Set on the last question of the
// module per context:
//   * main path: failure_mode edges (last question there)
//   * plateau / auto-shallow: physical_rate edges (knowledge_rate is
//     asked first by priority+position, physical_rate second and final)
//
// No reducerTable — exit space is three-way conditional with variable
// question count; walker falls through to normal DFS like escape /
// who_benefits.

const ROLLOUT_NODE_IDS = [
    'knowledge_rate',
    'physical_rate',
    'failure_mode',
];

// Only the completion marker propagates globally — all narrative dims
// move to flavor on exit. See `rolloutReduce` comment.
const ROLLOUT_WRITES = ['rollout_set'];

function rolloutReduce(_local) {
    // All rollout dims move to flavor on module exit — nothing persists
    // globally. The module's only sel-level output is the `rollout_set`
    // completion marker (set via exit-tuple `set:` blocks, not via this
    // reducer).
    return {};
}

// Exit tuples:
//   * failure_mode.{none, drift} — main path exit, always. No `when` gate.
//   * physical_rate.{rapid, gradual, uneven, limited} — plateau and
//     AGI-only exits. Gate on capability ∈ {plateau, agi} so these don't
//     fire on the main ASI path (where failure_mode is the real exit).
function buildRolloutExitPlan() {
    const plan = [];
    const fm = NODE_MAP.failure_mode;
    if (fm && fm.edges) {
        for (const e of fm.edges) {
            plan.push({
                nodeId: 'failure_mode',
                edgeId: e.id,
                when: {},
                set: { rollout_set: 'yes' },
            });
        }
    }
    const pr = NODE_MAP.physical_rate;
    if (pr && pr.edges) {
        for (const e of pr.edges) {
            // Plateau exit
            plan.push({
                nodeId: 'physical_rate',
                edgeId: e.id,
                when: { capability: ['stalls'] },
                set: { rollout_set: 'yes' },
            });
            // Auto-shallow exit
            plan.push({
                nodeId: 'physical_rate',
                edgeId: e.id,
                when: { capability: ['agi'] },
                set: { rollout_set: 'yes' },
            });
        }
    }
    return plan;
}

const ROLLOUT_MODULE = {
    id: 'rollout',
    activateWhen: [
        // Main path — any condition under which failure_mode could eventually
        // activate, or knowledge_rate / physical_rate activate via OUTCOME_ACTIVATE.
        // OUTCOME_ACTIVATE is already gated on `who_benefits_set=yes` (or the
        // benevolent / catch_holds bypasses), so the module only activates
        // once Who Benefits has completed.
        ...OUTCOME_ACTIVATE,
        // Plateau / auto-shallow paths — plateau_benefit_distribution and
        // auto_benefit_distribution now both write the shared
        // `who_benefits_set` marker (unified with the main WHO_BENEFITS
        // module). Capability keeps the contexts distinct.
        { capability: ['plateau'], who_benefits_set: ['yes'] },
        { capability: ['agi'], who_benefits_set: ['yes'] },
    ],
    reads: [
        // Activation / gating across the three contexts. Post-emergence
        // capability is one of {plateau, agi, asi} (or 'stalls' for the
        // reserved short-stall dead-end). stall_duration is still read
        // by some plateau narrative / reachable gates.
        'capability', 'stall_duration',
        // OUTCOME_ACTIVATE conditions (post-escape catch path) — single
        // consolidated marker (replaces compound catch_outcome +
        // collateral_impact).
        'post_catch',
        // Shared rollout hideWhen (uncaught bad-escape cut) +
        // failure_mode.hideWhen.
        'ai_goals', 'containment',
        // Main-path activation marker + delivery-eligibility marker.
        // failure_mode activates on who_benefits_set=yes when
        // delivery_ask_eligible is not 'no' (set by WHO_BENEFITS on
        // capture-shaped paths).
        'who_benefits_set', 'delivery_ask_eligible',
        // Module's own completion marker is read by every internal node's
        // hideWhen (post-answer re-ask guard now that all 3 internal dims
        // move to flavor on exit).
        'rollout_set',
    ],
    writes: ROLLOUT_WRITES,
    nodeIds: ROLLOUT_NODE_IDS,
    completionMarker: 'rollout_set',
    reduce: rolloutReduce,
    get exitPlan() { return buildRolloutExitPlan(); },
};

// ════════════════════════════════════════════════════════
// CONTROL_MODULE — the "who ends up running the AI?" sub-loop
// ════════════════════════════════════════════════════════
//
// Stage-2 bridge between emergence (Act 1) and alignment (Act 2). Four
// questions, ordered:
//   open_source → distribution → geo_spread → sovereignty
//
// Internal branching (all on the main singularity path):
//   * open_source=near_parity → distribution forced to 'open' (other edges
//     disabledWhen); geo_spread / sovereignty both skipped (activateWhen
//     not met). Exit after distribution.
//   * open_source in {6/12/24mo} → distribution asked (open edge requires
//     near_parity, so unavailable here). Then:
//       - distribution=monopoly → geo_spread two/several disabled (only
//         one country in the game); geo_spread=one forced; sovereignty
//         asked; exit after sovereignty.
//       - distribution=lagging → collapses to distribution='concentrated'
//         with setFlavor lagging. Follows the concentrated branch.
//       - distribution=concentrated → geo_spread asked with all three
//         options available.
//         * geo_spread=one → sovereignty asked; exit after sovereignty.
//         * geo_spread=two/several → collapse to geo_spread='multiple';
//           sovereignty skipped; exit after geo_spread.
//
// External contract:
//   reads  = emergence outputs + takeoff gates. The former
//            proliferation_outcome read (for geo_spread.deriveWhen) is
//            gone — the override now lives in PROLIFERATION_MODULE's
//            exit plan, owned by the dim's rightful writer.
//   writes = open_source_set (marker), open_source (conditional — stays
//            in sel on paths where downstream decel chain reads it, moved
//            to flavor on others via existing per-edge collapseToFlavor
//            rules), distribution, geo_spread, sovereignty, control_set.
//
// completionMarker: `control_set`. The auto-detected last-write wouldn't
// work here (sovereignty is undefined on distribution.open and
// geo_spread.{two, several} exits), so we declare it explicitly and set
// it in every exit tuple — same pattern as who_benefits / rollout /
// emergence.
//
// No reducerTable — 5 exit edges across 3 terminal nodes, each with its
// own path-specific collapse behavior. Walker falls through to normal
// DFS like escape / who_benefits / rollout / emergence. The /explore hub
// uses dynamic atomic-cell enumeration.

const CONTROL_NODE_IDS = [
    'open_source',
    'distribution',
    'geo_spread',
    'sovereignty',
];

// Writes = dims that remain in sel (or are markers set in sel) post-exit
// and are read by external consumers downstream. Every user-pickable dim
// in this module is externally consumed on at least one path:
//   * `open_source` — read by gov_action / decel_* `requires` clauses on
//     the geo=one+state and monopoly paths (where it stays in sel).
//   * `distribution` — read by gov_action, proliferation_control,
//     containment-related rules.
//   * `geo_spread` — read by gov_action, decel reducer, and multiple
//     outcome templates.
//   * `sovereignty` — read by gov_action, power_structure outcomes.
// The audit recognizes these as declared exports; per-edge node-level
// collapseToFlavor rules still move them to flavor on the specific paths
// where downstream consumers don't need them (e.g., geo_spread.two moves
// open_source; sovereignty.lab on concentrated also moves open_source).
const CONTROL_WRITES = [
    'open_source', 'open_source_set',
    'distribution',
    'geo_spread',
    'sovereignty',
    'control_set',
];

function controlReduce(local) {
    const bundle = {};
    for (const k of CONTROL_WRITES) {
        if (local[k] !== undefined) bundle[k] = local[k];
    }
    return bundle;
}

// 5 exit edges across 3 terminal nodes. All set control_set='yes'; no
// `when` gates because the (nodeId, edgeId) pair uniquely identifies the
// exit path.
function buildControlExitPlan() {
    const plan = [];
    const add = (nodeId, edgeIds) => {
        const n = NODE_MAP[nodeId];
        if (!n || !n.edges) return;
        const want = new Set(edgeIds);
        for (const e of n.edges) {
            if (!want.has(e.id)) continue;
            plan.push({
                nodeId, edgeId: e.id,
                when: {},
                set: { control_set: 'yes' },
            });
        }
    };
    // open_source=near_parity → distribution=open forced, geo_spread /
    // sovereignty both skipped. Exit here.
    add('distribution', ['open']);
    // geo_spread ∈ {two, several} → sovereignty skipped. Exit here.
    add('geo_spread', ['two', 'several']);
    // geo_spread=one → sovereignty answered. Exit here.
    add('sovereignty', ['lab', 'state']);
    return plan;
}

const CONTROL_MODULE = {
    id: 'control',
    activateWhen: [
        { capability: ['asi'] },
    ],
    reads: [
        // Post-emergence state that internal nodes read (disabledWhen,
        // activateWhen, deriveWhen clauses). capability='asi' is the
        // module's activation gate and also its completion marker check.
        'capability',
        'takeoff_class',
    ],
    writes: CONTROL_WRITES,
    nodeIds: CONTROL_NODE_IDS,
    completionMarker: 'control_set',
    reduce: controlReduce,
    get exitPlan() { return buildControlExitPlan(); },
};

// ════════════════════════════════════════════════════════
// PROLIFERATION_MODULE — "how does control over the tech play out?"
// ════════════════════════════════════════════════════════
//
// Three-node stage-2 sub-loop covering the "once the AI works, who gets
// access, does control hold, and can alignment survive if it leaks":
//   proliferation_control → proliferation_outcome → proliferation_alignment
//
// Internal flow:
//   * proliferation_control asked first. Edges: deny_rivals, secure_access,
//     none.
//     - deny_rivals / secure_access → proliferation_outcome asked.
//     - none → proliferation_outcome auto-derives to leaks_public via its
//       deriveWhen; NOT asked as a question.
//   * proliferation_outcome (asked or derived). Edges: holds, leaks_rivals,
//     leaks_public.
//     - leaks_public AND alignment=robust → proliferation_alignment asked.
//     - Any other combination → module exits.
//   * proliferation_alignment asked only on leaks_public + robust.
//     Edges: holds, breaks. Always exits.
//
// First module to use CONDITIONAL EXIT TUPLES. Two edges
// (`proliferation_control.none`, `proliferation_outcome.leaks_public`)
// behave differently depending on `alignment`:
//   * alignment ≠ robust → exit (downstream proliferation_alignment won't
//     fire)
//   * alignment = robust → DON'T exit; module continues to
//     proliferation_alignment
// Expressed by giving those exit tuples a `when: { alignment: { not:
// ['robust'] } }` gate. `cleanSelection` evaluates block-array `when`
// clauses per block; when none match, the edge emits no marker and the
// module stays active. Same mechanism that decel's reducerTable uses for
// its action/progress conditional rules, now exposed at the exit-plan
// layer.
//
// External contract:
//   * writes = all 3 internal dims + completion marker. Every internal dim
//     is externally consumed by stage-2 and stage-3 nodes (intent.requires,
//     block_entrants.activateWhen, alignment.deriveWhen,
//     alignment_durability.activateWhen, containment.deriveWhen, etc.), so
//     all stay in sel on exit. `nodeIds \ writes = ∅` means no flavor
//     moves, same pattern as control / rollout / emergence.
//   * activateWhen mirrors proliferation_control's activateWhen verbatim —
//     module is pending exactly while proliferation_control is askable.
//
// No reducerTable — exit space is conditional and path-dependent; walker
// falls through to normal DFS like escape / who_benefits / rollout /
// emergence / control. /explore hub uses dynamic atomic-cell enumeration.

const PROLIFERATION_NODE_IDS = [
    'proliferation_control',
    'proliferation_outcome',
    'proliferation_alignment',
];

const PROLIFERATION_WRITES = [
    'proliferation_control',
    'proliferation_outcome',
    'proliferation_alignment',
    'proliferation_set',
    // PROLIFERATION overrides geo_spread='multiple' on any leaked-weights
    // exit (proliferation_control=none, proliferation_outcome=leaks_*,
    // proliferation_alignment.*). Applied via buildProliferationExitPlan.
    // Replaces the old geo_spread.deriveWhen rule so CONTROL_MODULE no
    // longer needs to read proliferation_outcome.
    'geo_spread',
    // PROLIFERATION also overrides alignment='failed' + containment='escaped'
    // on leaked-weights exits where alignment isn't robust:
    //   * proliferation_alignment.breaks (any)
    //   * proliferation_outcome.leaks_public + alignment≠robust
    //   * proliferation_control.none + alignment≠robust (derives leaks_public)
    // Replaces the old alignment.deriveWhen + containment.deriveWhen rules
    // so ALIGNMENT_MODULE no longer needs to read
    // proliferation_alignment / proliferation_outcome.
    'alignment',
    'containment',
];

function proliferationReduce(local) {
    const bundle = {};
    for (const k of PROLIFERATION_WRITES) {
        if (local[k] !== undefined) bundle[k] = local[k];
    }
    return bundle;
}

function buildProliferationExitPlan() {
    const plan = [];
    // Any "leaked weights" exit overrides geo_spread='multiple' (replaces
    // the former geo_spread.deriveWhen). Leaked-weights exits also override
    // alignment='failed' + containment='escaped' whenever alignment wasn't
    // robust — replaces the former alignment.deriveWhen + containment.
    // deriveWhen rules keyed on proliferation_outcome='leaks_public' and
    // proliferation_alignment='breaks'. Only 'holds' leaves all three
    // alone. proliferation_alignment always activates on a leaks_public
    // path (alignment robust gate), and its 'breaks' edge specifically
    // flips alignment/containment regardless of the prior alignment
    // value (though in practice robust is the only way to reach it).
    const LEAKED = { proliferation_set: 'yes', geo_spread: 'multiple' };
    const LEAKED_UNROBUST = {
        proliferation_set: 'yes',
        geo_spread: 'multiple',
        alignment: 'failed',
        containment: 'escaped',
    };
    const HOLDS  = { proliferation_set: 'yes' };

    // proliferation_control.none: always a leaked-weights world with
    // alignment≠robust (if alignment=robust, proliferation_outcome derives
    // to leaks_public and proliferation_alignment activates — the module
    // doesn't exit here). So always carries the full alignment override.
    plan.push({
        nodeId: 'proliferation_control',
        edgeId: 'none',
        when: { alignment: { not: ['robust'] } },
        set: LEAKED_UNROBUST,
    });
    // proliferation_outcome terminal edges.
    const outNode = NODE_MAP.proliferation_outcome;
    if (outNode && outNode.edges) {
        for (const e of outNode.edges) {
            if (e.id === 'holds') {
                plan.push({
                    nodeId: 'proliferation_outcome', edgeId: e.id,
                    when: {}, set: HOLDS,
                });
            } else if (e.id === 'leaks_public') {
                // Only exit here if proliferation_alignment won't activate
                // (i.e. alignment≠robust). alignment/containment flip.
                plan.push({
                    nodeId: 'proliferation_outcome', edgeId: e.id,
                    when: { alignment: { not: ['robust'] } },
                    set: LEAKED_UNROBUST,
                });
            } else {
                // leaks_rivals: proliferation_alignment never activates
                // (needs leaks_public). Old derives didn't flip alignment
                // on leaks_rivals either, so keep LEAKED (geo_spread only).
                plan.push({
                    nodeId: 'proliferation_outcome', edgeId: e.id,
                    when: {}, set: LEAKED,
                });
            }
        }
    }
    // proliferation_alignment terminal edges — only reached on a
    // leaks_public path. 'breaks' flips alignment/containment (replaces
    // the old proliferation_alignment=breaks deriveWhen); 'holds' keeps
    // the pre-existing alignment (geo_spread override only).
    const alignNode = NODE_MAP.proliferation_alignment;
    if (alignNode && alignNode.edges) {
        for (const e of alignNode.edges) {
            const set = (e.id === 'breaks') ? LEAKED_UNROBUST : LEAKED;
            plan.push({
                nodeId: 'proliferation_alignment',
                edgeId: e.id,
                when: {},
                set,
            });
        }
    }
    return plan;
}

const PROLIFERATION_MODULE = {
    id: 'proliferation',
    // Mirrors proliferation_control.activateWhen verbatim — module is
    // pending exactly while proliferation_control is askable.
    activateWhen: [
        {
            capability: ['asi'],
            alignment: { not: ['failed'] },
        },
    ],
    reads: [
        // Activation gate
        'capability', 'alignment',
        // Internal hideWhen clauses on proliferation_control /
        // proliferation_outcome reference these
        'ai_goals', 'containment', 'alignment_durability',
        // proliferation_control.edges[deny_rivals|secure_access].disabledWhen
        // reads distribution.
        'distribution',
    ],
    writes: PROLIFERATION_WRITES,
    nodeIds: PROLIFERATION_NODE_IDS,
    completionMarker: 'proliferation_set',
    reduce: proliferationReduce,
    get exitPlan() { return buildProliferationExitPlan(); },
};

// ════════════════════════════════════════════════════════
// EMERGENCE_MODULE — the "how AI arrives" sub-loop (Act 1)
// ════════════════════════════════════════════════════════
//
// The entry phase of the scenario: from the first question through to
// either the plateau/auto-shallow branches or the main path's entry into
// open_source (stage 2). This is the largest and most central module —
// the "Act 1" of the story, determining:
//   * Does the capability trend continue, or stall?
//   * When does AGI / ASI arrive (or not)?
//   * How fast does R&D accelerate post-ASI?
//   * Does governance respond in time?
//
// Internal user-pickable nodes:
//   capability, stall_duration, stall_recovery, agi_threshold,
//   asi_threshold, automation_recovery, takeoff, governance_window
//
// Three exits, each rewriting `capability` to one of the 4 post-exit
// values (which doubles as the completion marker — see completionMarker):
//   * Plateau: stall_recovery.{substantial, never} → capability='plateau'
//   * AGI-only: automation_recovery.{substantial, never} → capability='agi'
//   * ASI path → open_source: either takeoff.{fast, explosive}
//     (governance skipped) or governance_window.{governed, partial, race}
//     (normal takeoff). Both set capability='asi'. 7 exit edges on main +
//     2 + 2 = 11 total exit points; some converge to the same
//     {set, move} blocks via attachModuleReducer.
//
// activateWhen: `[]` means "always active". Module is pending from empty
// sel through to capability ∈ {plateau, agi, asi, stalls}.
//
// No reducerTable — exit space spans 4 different terminal nodes with
// path-specific collapseToFlavor blocks. Walker falls through to normal
// DFS, same as escape / who_benefits / rollout.

const EMERGENCE_NODE_IDS = [
    'capability',
    'stall_duration',
    'stall_recovery',
    'agi_threshold',
    'asi_threshold',
    'automation_recovery',
    'takeoff',
    'governance_window',
];

// Writes = dims that remain in sel (or are markers set in sel) post-exit
// and are read by external consumers downstream. The pure-internal dims
// (stall_recovery, agi_threshold, automation_recovery, takeoff,
// governance_window) each have their own per-edge collapseToFlavor that
// moves them to flavor; we don't list them here.
//
// `capability` never moves to flavor — it's rewritten on module exit to
// one of {plateau, agi, asi} (or stays 'stalls' on the reserved path)
// and is consumed by every downstream branch. Its post-exit value doubles
// as the module's completion marker (see completionMarker below).
// `stall_duration` also persists — it's read by several downstream
// plateau narrative gates (knowledge_rate / physical_rate inside rollout
// discriminate on hours|days|weeks|months).
//
// `asi_happens` is deliberately NOT in writes — see internalMarkers
// below. `agi_happens` is also NOT in writes: every asi_threshold edge
// moves it to flavor, so it's never durable in sel post-exit.
// `asi_threshold` is also NOT in writes: it's mid-flow evicted to flavor
// by per-edge collapseToFlavor (asi_threshold non-never edges + the
// automation_recovery.mild edge). The one case where that eviction
// doesn't fire (asi_threshold=never + automation_recovery in
// {substantial, never}) is handled by attachModuleReducer's
// nodeIds\writes auto-eviction on module exit. No outcome reachable
// clause reads asi_threshold — all narrative uses go through
// resolvedStateWithFlavor (fused state), so flavor is sufficient.
//
// Former writes dropped in the capability-4-value refactor:
//   * `automation` — the derived node was deleted; capability now
//     encodes the deep/shallow distinction directly (asi vs agi).
//   * `stall_later` — replaced by capability='plateau'.
//   * `automation_later` — replaced by capability='agi'.
//   * `emergence_set` — replaced by capability ∈ {plateau, agi, asi}.
const EMERGENCE_WRITES = [
    'capability', 'stall_duration',
    'takeoff_class',
];

// Internal markers: dims set into sel mid-module to gate internal
// activateWhen/hideWhen, but with no external sel-only readers. They
// move to flavor on module exit via attachModuleReducer, keeping the
// post-exit sel surface narrow while still being visible to
// narrative/templates (which read fused sel ∪ flavor).
//
//   * `asi_happens` — set by asi_threshold.yes-path edges and
//     automation_recovery.mild. Consumed by agi_threshold.hideWhen and
//     asi_threshold.hideWhen to suppress re-asking after the asi
//     question resolves. No external reader.
//   * `agi_happens` — set by agi_threshold edges (yes/no) and consumed
//     by asi_threshold.activateWhen / agi_threshold.hideWhen. Always
//     moved to flavor by asi_threshold's own per-edge collapseToFlavor
//     (or by automation_recovery.mild.setFlavor); never durable in sel
//     post-exit and never read externally.
const EMERGENCE_INTERNAL_MARKERS = ['asi_happens', 'agi_happens'];

function emergenceReduce(local) {
    const bundle = {};
    for (const k of EMERGENCE_WRITES) {
        if (local[k] !== undefined) bundle[k] = local[k];
    }
    return bundle;
}

// Exit tuples: 11 edges across 4 nodes. Each sets `capability` to the
// post-exit value that classifies the scenario: one of
//   * `plateau` — stalls path with long / permanent stall
//   * `agi`     — singularity path with asi=never (no ASI, auto-shallow)
//   * `asi`     — singularity path reaching ASI (deep automation)
// (The `stalls` post-exit value is reserved for a future "short stall
//  dead-end" outcome; no current exit tuple sets it.)
//
// The capability value itself serves as the module's completion marker
// (see EMERGENCE_MODULE.completionMarker), replacing the prior
// `emergence_set: 'yes'` marker. Also replaces the prior
// `stall_later: 'yes'` (now = capability: 'plateau') and
// `automation_later: 'yes'` (now = capability: 'agi') markers.
// No `when` gates — the edge id carries the path distinction.
function buildEmergenceExitPlan() {
    const plan = [];
    const add = (nodeId, edgeIds, capabilityValue) => {
        const n = NODE_MAP[nodeId];
        if (!n || !n.edges) return;
        const want = new Set(edgeIds);
        for (const e of n.edges) {
            if (!want.has(e.id)) continue;
            plan.push({
                nodeId, edgeId: e.id,
                when: {},
                set: { capability: capabilityValue },
            });
        }
    };
    // Plateau exit (stalls path, stall_recovery = long/permanent)
    add('stall_recovery', ['substantial', 'never'], 'plateau');
    // AGI-only exit (asi=never, recovery not mild)
    add('automation_recovery', ['substantial', 'never'], 'agi');
    // ASI via fast/explosive takeoff — governance skipped, direct exit
    add('takeoff', ['fast', 'explosive'], 'asi');
    // ASI via normal takeoff — governance answered
    add('governance_window', ['governed', 'partial', 'race'], 'asi');
    return plan;
}

const EMERGENCE_MODULE = {
    id: 'emergence',
    activateWhen: [], // always active — entry module; completion marker gates
    reads: [],
    writes: EMERGENCE_WRITES,
    internalMarkers: EMERGENCE_INTERNAL_MARKERS,
    nodeIds: EMERGENCE_NODE_IDS,
    // Done iff capability has been rewritten from the user-answered
    // {singularity, stalls} to one of the post-exit values. Uses the
    // object-form marker (engine._isModuleDone) since a bare "has value"
    // check matches pre-exit too (capability is user-picked inside the
    // module).
    completionMarker: { dim: 'capability', values: ['plateau', 'agi', 'asi', 'stalls'] },
    reduce: emergenceReduce,
    get exitPlan() { return buildEmergenceExitPlan(); },
};

// ════════════════════════════════════════════════════════
// INTENT_MODULE — the "geopolitics / rival dynamics" sub-loop
// ════════════════════════════════════════════════════════
//
// The Intent question (self_interest / coexistence / escalation /
// international) has a conditional 3-step tail whenever the user picks
// self_interest or international on the "clean win" path (alignment ∈
// robust/brittle, proliferation_control=secure_access,
// proliferation_outcome=holds):
//
//     intent → block_entrants → (block_outcome | new_entrants)
//                             → rival_dynamics?
//
// The tail may override the user's initial pick: if block_outcome=fails
// or new_entrants=emerge, rival_dynamics fires and its value (coexistence
// or escalation) replaces `intent`.
//
// Before modularization, rival_dynamics' override lived in
// intent.deriveWhen as a sel-reading derivation. With the tail now
// evicted to flavor on exit, that rule can no longer see it — the
// reducer here handles the override directly: rival_dynamics exit tuples
// `set: { intent: <rival_dynamics value> }`.
//
// External contract:
//   * writes = [intent] — the one dim downstream consumers need.
//     intent_set is the completion marker (a side-channel write, not in
//     the published reads/writes list since it's internal to module
//     scheduling).
//   * The four tail dims (block_entrants, block_outcome, new_entrants,
//     rival_dynamics) are NOT referenced anywhere outside this cluster
//     (grep-verified in graph.js / data/*.json). They exist purely to
//     compute the final intent value + narrate the geopolitics flavor,
//     and evict to flavor on module exit.
//
// Post-exit intent overrides:
//   The peaceful-war intent overrides (escalation_outcome=agreement |
//   post_war_aims=human_centered → intent='coexistence') live in
//   WAR_MODULE's exit plan, not as intent.deriveWhen rules. WAR is
//   the rightful writer of those dims and writes intent directly on
//   the relevant exit edges, so INTENT_MODULE doesn't need to read
//   any war-internal state.
//
// Exit plan:
//   * intent.coexistence, intent.escalation — always exit.
//   * intent.self_interest, intent.international — exit IFF block_entrants
//     won't activate. Block_entrants requires alignment ∈ (robust,brittle)
//     AND proliferation_control=secure_access AND proliferation_outcome
//     =holds; we encode the negation as three separate exit tuples (OR).
//   * block_outcome.holds — exit (initial intent pick stands).
//   * new_entrants.none — exit (initial intent pick stands).
//   * rival_dynamics.{coexistence,escalation} — exit AND override intent
//     with the rival_dynamics value.
//
// Walker: no reducerTable — exit space is path-dependent (12 tuples).
// /explore falls through to normal DFS like escape / who_benefits.

const INTENT_NODE_IDS = [
    'intent',
    'block_entrants',
    'block_outcome',
    'new_entrants',
    'rival_dynamics',
];

const INTENT_WRITES = ['intent', 'intent_set'];

function intentReduce(local) {
    // rival_dynamics overrides the initial intent pick when the tail
    // fires. Else the user's original intent pick stands.
    if (local.rival_dynamics !== undefined) {
        return { intent: local.rival_dynamics };
    }
    const bundle = {};
    if (local.intent !== undefined) bundle.intent = local.intent;
    return bundle;
}

function buildIntentExitPlan() {
    const plan = [];
    // intent: coexistence / escalation — no tail, direct exit.
    plan.push({
        nodeId: 'intent', edgeId: 'coexistence',
        when: {}, set: { intent_set: 'yes' },
    });
    plan.push({
        nodeId: 'intent', edgeId: 'escalation',
        when: {}, set: { intent_set: 'yes' },
    });
    // intent: self_interest / international — enter tail IFF
    // block_entrants activates (alignment ∈ (robust,brittle) AND
    // proliferation_control=secure_access AND proliferation_outcome=holds).
    // Exit here when ANY of those fails (three separate tuples = OR).
    for (const edgeId of ['self_interest', 'international']) {
        plan.push({
            nodeId: 'intent', edgeId,
            when: { alignment: { not: ['robust', 'brittle'], required: true } },
            set: { intent_set: 'yes' },
        });
        plan.push({
            nodeId: 'intent', edgeId,
            when: { proliferation_control: { not: ['secure_access'], required: true } },
            set: { intent_set: 'yes' },
        });
        plan.push({
            nodeId: 'intent', edgeId,
            when: { proliferation_outcome: { not: ['holds'], required: true } },
            set: { intent_set: 'yes' },
        });
    }
    // block_outcome.holds — blocking succeeded, initial intent stands.
    // block_outcome.fails continues to rival_dynamics.
    plan.push({
        nodeId: 'block_outcome', edgeId: 'holds',
        when: {}, set: { intent_set: 'yes' },
    });
    // new_entrants.none — no rivals arrived, initial intent stands.
    // new_entrants.emerge continues to rival_dynamics.
    plan.push({
        nodeId: 'new_entrants', edgeId: 'none',
        when: {}, set: { intent_set: 'yes' },
    });
    // rival_dynamics terminals — override intent with the rival_dynamics
    // outcome (was intent.deriveWhen's `rival_dynamics: true` rule
    // pre-module; now handled declaratively here).
    const rd = NODE_MAP.rival_dynamics;
    if (rd && rd.edges) {
        for (const e of rd.edges) {
            plan.push({
                nodeId: 'rival_dynamics', edgeId: e.id,
                when: {},
                set: { intent: e.id, intent_set: 'yes' },
            });
        }
    }
    return plan;
}

const INTENT_MODULE = {
    id: 'intent_loop',
    // Mirrors intent.activateWhen verbatim — module is pending exactly
    // while intent is askable.
    activateWhen: [
        { capability: ['asi'], alignment: ['robust', 'brittle'], proliferation_control: true },
        { capability: ['asi'], alignment: ['failed'], containment: ['contained'] },
        { capability: ['asi'], ai_goals: ['marginal'] },
    ],
    reads: [
        // Activation gate
        'capability', 'alignment', 'containment',
        'ai_goals',
        // Tail gating (block_entrants.activateWhen)
        'proliferation_control', 'proliferation_outcome',
        // intent.edges.requires + tail hideWhen chains
        'distribution', 'geo_spread', 'alignment_durability',
    ],
    writes: INTENT_WRITES,
    nodeIds: INTENT_NODE_IDS,
    completionMarker: 'intent_set',
    reduce: intentReduce,
    get exitPlan() { return buildIntentExitPlan(); },
};

// ════════════════════════════════════════════════════════
// WAR_MODULE — the "escalation → conflict → aftermath" sub-loop
// ════════════════════════════════════════════════════════
//
// Fires whenever the rival-powers path reaches intent=escalation.
// Pipeline:
//
//     escalation_outcome
//        ├── standoff  ──────────► exit
//        ├── agreement ──────────► exit
//        └── conflict  → conflict_result
//                          ├── victory     → post_war_aims.* → exit
//                          └── destruction → war_survivors.* → exit
//
// External contract:
//   * writes = [escalation_outcome, conflict_result, post_war_aims,
//     war_survivors] — every dim is consumed by at least one outside
//     consumer (intent.deriveWhen, power_promise.activateWhen/hideWhen,
//     outcome templates, ruin_type.deriveWhen, collateral_impact and
//     catch_outcome hideWhen via war_survivors). Nothing evicts to
//     flavor; moveDims = nodeIds \ writes = [].
//   * war_survivors is the shared dim with ESCAPE_MODULE's
//     collateral_survivors. Both modules are mutually exclusive at
//     activation time (the war path requires intent=escalation on the
//     "clean win" branches; the escape-catch path requires
//     alignment=failed or concentration_type=ai_itself) so only one
//     writer touches war_survivors per run.
//   * completionMarker: `war_set`. Declared explicitly because the
//     auto-detection would pick the last write (war_survivors), which
//     is set on only one of the four exit tails.
//
// Walker: no reducerTable — 7 exit tuples with straightforward
// (nodeId, edgeId) mapping; /explore falls through to normal DFS.

const WAR_NODE_IDS = [
    'escalation_outcome',
    'conflict_result',
    'post_war_aims',
    'war_survivors',
];

const WAR_WRITES = [
    'escalation_outcome',
    'conflict_result',
    'post_war_aims',
    'war_survivors',
    'war_set',
    // WAR overrides intent on peaceful exits (escalation_outcome=agreement
    // or post_war_aims=human_centered → intent='coexistence'). Applied via
    // buildWarExitPlan exit edges. Replaces the old intent.deriveWhen
    // rules so INTENT_MODULE no longer needs to read war-internal dims.
    'intent',
];

function warReduce(local) {
    const bundle = {};
    for (const k of WAR_WRITES) {
        if (local[k] !== undefined) bundle[k] = local[k];
    }
    return bundle;
}

// 7 exit edges:
//   * escalation_outcome.{standoff, agreement} — direct exits.
//   * escalation_outcome.conflict — no exit (continues to conflict_result).
//   * conflict_result.victory — no exit (continues to post_war_aims).
//   * conflict_result.destruction — no exit (continues to war_survivors).
//   * post_war_aims.{human_centered, self_interest} — exits.
//   * war_survivors.{most, remnants, none} — exits.
// All set `war_set: 'yes'`.
function buildWarExitPlan() {
    const plan = [];
    // Peaceful WAR exits override intent → 'coexistence'. Replaces
    // the former intent.deriveWhen rules; WAR is the rightful writer
    // of escalation_outcome / post_war_aims, so it owns the override.
    const PEACEFUL_OVERRIDE = {
        escalation_outcome: new Set(['agreement']),
        post_war_aims: new Set(['human_centered']),
    };
    const buildSet = (nodeId, edgeId) => {
        const set = { war_set: 'yes' };
        if (PEACEFUL_OVERRIDE[nodeId] && PEACEFUL_OVERRIDE[nodeId].has(edgeId)) {
            set.intent = 'coexistence';
        }
        return set;
    };
    const addAll = (nodeId) => {
        const n = NODE_MAP[nodeId];
        if (!n || !n.edges) return;
        for (const e of n.edges) {
            plan.push({
                nodeId, edgeId: e.id,
                when: {},
                set: buildSet(nodeId, e.id),
            });
        }
    };
    const addSome = (nodeId, edgeIds) => {
        const n = NODE_MAP[nodeId];
        if (!n || !n.edges) return;
        const want = new Set(edgeIds);
        for (const e of n.edges) {
            if (!want.has(e.id)) continue;
            plan.push({
                nodeId, edgeId: e.id,
                when: {},
                set: buildSet(nodeId, e.id),
            });
        }
    };
    addSome('escalation_outcome', ['standoff', 'agreement']);
    addAll('post_war_aims');
    addAll('war_survivors');
    return plan;
}

const WAR_MODULE = {
    id: 'war_loop',
    // Mirrors escalation_outcome.activateWhen — module is pending from
    // the moment escalation_outcome would first be askable through to
    // either an early exit (standoff/agreement) or pipeline completion
    // (post_war_aims/war_survivors).
    activateWhen: [
        { intent: ['escalation'] },
    ],
    reads: [
        // Activation gate
        'intent',
    ],
    writes: WAR_WRITES,
    nodeIds: WAR_NODE_IDS,
    completionMarker: 'war_set',
    reduce: warReduce,
    get exitPlan() { return buildWarExitPlan(); },
};

// ════════════════════════════════════════════════════════
// ALIGNMENT_MODULE — the "alignment cluster + deceleration" sub-loop
// ════════════════════════════════════════════════════════
//
// Groups the four stage-2 nodes that together answer "what does the
// world look like alignment-wise, and are we slowing down?":
//   * alignment              — Robust / Brittle / Unsolved
//   * alignment_durability   — (brittle only) Holds / Breaks
//   * containment            — (failed only) Contained / Escaped
//   * gov_action             — (geo_spread=one + sov=state OR
//                               distribution=monopoly) Decelerate /
//                               Accelerate
//
// Paths:
//   * robust → gov_action (if geo_spread=one + sov/dist)
//   * brittle → holds → gov_action (if gates met)
//   * brittle → breaks → containment derives 'escaped' → ESCAPE_MODULE;
//     gov_action hidden (containment=escaped) — module exits on
//     durability.breaks.
//   * failed → contained → gov_action (if gates met)
//   * failed → escaped → ESCAPE_MODULE via ai_goals; gov_action hidden
//     (containment=escaped) — module exits on containment.escaped.
//
// Once the AI has escaped, the deceleration decision is moot — so on
// every containment=escaped path we exit this module on containment
// (or alignment_durability.breaks, which derives containment='escaped'),
// and gov_action's own hideWhen suppresses it for the rest of the flow.
// The only interleaving with ESCAPE_MODULE is visual (two modules
// pending at once is fine — module-first scheduling is advisory for
// priority gates, not a serializer).
//
// External contract:
//   * writes = [alignment, alignment_durability, containment,
//     gov_action, alignment_set] — all four question dims are heavily
//     consumed downstream (template refs, activateWhen/hideWhen gates),
//     so none move to flavor.
//   * nodeIds = the four question dims → move list = writes \ nodeIds
//     is empty.
//
// Completion marker: `alignment_set`. Deferred on alignment.{brittle,
// failed} (which route to the next internal node), otherwise exits
// directly. gov_action's own exit tuples are idempotent for paths
// where an earlier edge already set the marker.
//
// Walker: no reducerTable — enumerating the 4 nodes × their edges ×
// their activation gates would produce many cells with no compression
// win. /explore falls through to normal DFS inside.

const ALIGNMENT_NODE_IDS = [
    'alignment',
    'alignment_durability',
    'containment',
    'gov_action',
];

const ALIGNMENT_WRITES = [
    'alignment',
    'alignment_durability',
    'containment',
    'gov_action',
    'alignment_set',
];

function alignmentReduce(local) {
    const bundle = {};
    for (const k of ALIGNMENT_WRITES) {
        if (local[k] !== undefined) bundle[k] = local[k];
    }
    return bundle;
}

// Exit edges:
//   * alignment.robust — direct exit (durability/containment skip on
//     this path; gov_action's own exit idempotently re-sets the marker
//     if it activates).
//   * alignment.{brittle, failed} — no exit (defer to the next
//     internal node).
//   * alignment_durability.{holds, breaks} — direct exits.
//   * containment.{contained, escaped} — direct exits.
//   * gov_action.{decelerate, accelerate} — direct exits (idempotent
//     when reached after an earlier exit).
// All set `alignment_set: 'yes'`.
function buildAlignmentExitPlan() {
    const plan = [];
    const addSome = (nodeId, edgeIds) => {
        const n = NODE_MAP[nodeId];
        if (!n || !n.edges) return;
        const want = new Set(edgeIds);
        for (const e of n.edges) {
            if (!want.has(e.id)) continue;
            plan.push({
                nodeId, edgeId: e.id,
                when: {},
                set: { alignment_set: 'yes' },
            });
        }
    };
    const addAll = (nodeId) => {
        const n = NODE_MAP[nodeId];
        if (!n || !n.edges) return;
        for (const e of n.edges) {
            plan.push({
                nodeId, edgeId: e.id,
                when: {},
                set: { alignment_set: 'yes' },
            });
        }
    };
    addSome('alignment', ['robust']);
    addAll('alignment_durability');
    addAll('containment');
    addAll('gov_action');
    return plan;
}

const ALIGNMENT_MODULE = {
    id: 'alignment_loop',
    // Mirrors alignment.activateWhen — the module is pending from the
    // moment alignment would first be askable through to whichever
    // internal edge trips its exit tuple.
    activateWhen: [
        { capability: ['asi'] },
    ],
    reads: [
        // activation / gov_action gating
        'capability',
        'geo_spread', 'sovereignty', 'distribution',
        // alignment.deriveWhen marginal-path re-classification; containment
        // activateWhen clause 2 (ai_goals=marginal).
        'ai_goals',
        // gov_action edge collapseToFlavor moves (pre-existing)
        'takeoff_class',
    ],
    writes: ALIGNMENT_WRITES,
    nodeIds: ALIGNMENT_NODE_IDS,
    completionMarker: 'alignment_set',
    reduce: alignmentReduce,
    get exitPlan() { return buildAlignmentExitPlan(); },
};

const MODULES = [DECEL_MODULE, ESCAPE_MODULE, WHO_BENEFITS_MODULE, ROLLOUT_MODULE, EMERGENCE_MODULE, CONTROL_MODULE, PROLIFERATION_MODULE, INTENT_MODULE, WAR_MODULE, ALIGNMENT_MODULE];
const MODULE_MAP = {};
for (const m of MODULES) MODULE_MAP[m.id] = m;

// Derived back-pointer: each node.module = module-id if the node belongs
// to a module's internal nodeIds list, else null. MODULE.nodeIds remains
// the source of truth; `node.module` is populated here so consumers can
// ask "what module is this node in?" without a reverse lookup. A node
// may belong to at most one module.
for (const n of NODES) n.module = null;
for (const m of MODULES) {
    for (const nid of (m.nodeIds || [])) {
        const n = NODE_MAP[nid];
        if (!n) continue;
        if (n.module && n.module !== m.id) {
            throw new Error(`Node "${nid}" claimed by both modules "${n.module}" and "${m.id}"`);
        }
        n.module = m.id;
    }
}

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
