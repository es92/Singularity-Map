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
    // main singularity paths. On plateau, they fire after
    // plateau_benefit_distribution per FLOW_DAG topology — activation
    // is driven entirely by the node's multi-path activateWhen.
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
      // `open_source_set: 'yes'` is an in-module sel marker (declared as
      // CONTROL_MODULE.internalMarkers, not an external write): it stays
      // in sel *during* the control walk even after downstream collapses
      // (e.g. geo_spread=multiple's `move: ['open_source']`) move the
      // raw value to flavor, so this self-hide still fires. Auto-moved
      // to flavor at module exit — no external consumer.
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
        { id: 'open', label: 'Distributed',
          // Both gates are scoped to the pre-leak window via
          // `proliferation_set: false` (or, equivalently for `requires`,
          // an OR-clause that auto-passes once proliferation_set='yes').
          // Post-leak, "distribution" semantics flip: "open" now means
          // "weights are loose in the wild, anyone can run a copy" —
          // not "labs distributed openly". Both the original
          // open_source=near_parity prerequisite and the explosive-
          // takeoff disable apply only to the user's INITIAL pick;
          // they're irrelevant once a leak has forced
          // distribution='open' as a side effect.
          //
          // Without these gates, leak exit blocks set distribution='open'
          // and the old multi-pass cleanSelection would invalidate it
          // (requires fails on open_source=twenty_four_months, or
          // disabledWhen fires on takeoff_class=explosive). The static
          // analysis path (_applyEdgeWrites) never had an invalidation
          // pass; the gates make both paths leave distribution='open'
          // alone post-leak so they stay in sync.
          // diverges from CS (probe-divergence sig distribution:open→∅
          // on proliferation_outcome.leaks_public push, β category).
          //
          // requires uses OR semantics across array entries (any
          // matching cond satisfies the requirement), so adding the
          // proliferation_set='yes' clause lets the edge pass post-leak
          // without weakening the original near_parity gate pre-leak.
          requires: [
            { open_source: ['near_parity'] },
            { proliferation_set: ['yes'] }
          ],
          disabledWhen: [
            { takeoff_class: ['explosive'], proliferation_set: false, reason: 'At this speed, only whoever gets there first has it' }
          ] },
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
      deriveWhen: [
        { match: { alignment_durability: ['breaks'] }, value: 'failed' },
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
      edges: [
        { id: 'holds', label: 'Holds for now' },
        // breaks ≡ "AI escaped containment because brittle alignment broke,
        // and the path was on the accelerator (no governance brake)". Both
        // consequences are written here so they're visible to static
        // analysis (graph-io's reachableFullSelsFromInputs uses raw sel for
        // bucket keys). Previously these were encoded as cross-cutting
        // deriveWhen rules on `containment` and `gov_action`, which
        // matched at runtime via resolvedVal but were invisible to the
        // bucket-key projection — making these states look stuck at
        // escape_early. Same observable behavior either way.
        { id: 'breaks', label: 'Breaks',
          collapseToFlavor: { set: { containment: 'escaped', gov_action: 'accelerate' } } }
      ] },
    { id: 'containment', label: 'Containment', stage: 2, forwardKey: true,
      // hideWhen / activateWhen / disabledWhen trimmed: rules formerly keyed
      // on external writer dims (brittle_resolution, proliferation_alignment,
      // proliferation_outcome, post_catch) are gone. Those modules / nodes
      // now pre-write containment directly via collapseToFlavor.set
      // (ESCAPE.post_catch=contained, PROLIFERATION.{leaked-exits},
      // brittle_resolution.escape), so containment is already set in sel on
      // those paths — the node's own activation and rendering auto-skip
      // without needing guards here. alignment_durability.breaks also
      // pre-writes containment='escaped' on its edge so the dim is visible
      // to bucket-key projection (no deriveWhen detour).
      hideWhen: [
        { alignment_durability: ['breaks'] }
      ],
      activateWhen: [
        {
          capability: ['asi'],
          alignment: ['failed']
        }
      ],
      edges: [
        {
          id: 'contained',
          label: 'Contained',
          // Normal flow: containment is chosen on the post-alignment-
          // failure branch only when distribution is narrow enough to
          // keep the AI under wraps. Also reachable via ESCAPE's
          // post_catch=contained collapse (AI escaped, was caught, and
          // is now held) — that path sets both dims simultaneously,
          // so we OR in the post_catch=contained marker. Without this
          // disjunction, the old multi-pass cleanSelection would re-
          // evaluate the edge, find distribution=open (a legitimate
          // pre-escape state), mark the edge disabled, and drop
          // sel.containment — breaking
          // downstream rollout gating for alien-coexistence /
          // hostile-contained states.
          requires: [
            { distribution: ['concentrated', 'monopoly'] },
            { post_catch: ['contained'] }
          ],
          disabledWhen: [
            { alignment_durability: ['breaks'], reason: 'Brittle alignment broke — the AI is already operating freely' }
          ]
        },
        { id: 'escaped', label: 'Escapes' }
      ] },
    { id: 'ai_goals', label: 'AI Converges On', stage: 2, forwardKey: true,
      activateWhen: [
        { containment: ['escaped'] },
        { concentration_type: ['ai_itself'] }
      ],
      edges: [
        { id: 'benevolent', label: 'Benefit humanity',
          disabledWhen: [
            { war_survivors: ['none'], reason: 'Humanity is extinct — there is no one left to benefit' },
            { concentration_type: ['ai_itself'], power_use: ['extractive', 'indifferent'],
              reason: 'The AI was already shown to wield power exploitatively — benevolent goals contradict that' }
          ] },
        { id: 'alien_coexistence', label: 'Alien (tolerant)',
          disabledWhen: [
            { war_survivors: ['none'], reason: 'Humanity is extinct — there is no one left to coexist with' },
            { proliferation_alignment: ['holds'], reason: 'Alignment is intrinsic — the AI\'s values held even under open weights' },
            { concentration_type: ['ai_itself'], power_use: ['generous'], reason: 'The AI was already shown to wield power generously — hostile goals contradict that' }
          ] },
        { id: 'alien_extinction', label: 'Alien (total)', disabledWhen: [
            { proliferation_alignment: ['holds'], reason: 'Alignment is intrinsic — the AI\'s values held even under open weights' },
            { concentration_type: ['ai_itself'], power_use: ['generous'], reason: 'The AI was already shown to wield power generously — hostile goals contradict that' }
          ] },
        { id: 'paperclip', label: 'Arbitrary', disabledWhen: [
            { proliferation_alignment: ['holds'], reason: 'Alignment is intrinsic — the AI\'s values held even under open weights' },
            { concentration_type: ['ai_itself'], power_use: ['generous'], reason: 'The AI was already shown to wield power generously — hostile goals contradict that' }
          ] },
        { id: 'swarm', label: 'Divergent', disabledWhen: [
            { concentration_type: ['ai_itself'], reason: 'The AI took control from a singular power structure — it didn\'t fragment' },
            { proliferation_alignment: ['holds'], reason: 'Alignment is intrinsic — the AI\'s values held even under open weights' }
          ] },
        { id: 'power_seeking', label: 'Power accumulation', disabledWhen: [
            { proliferation_alignment: ['holds'], reason: 'Alignment is intrinsic — the AI\'s values held even under open weights' },
            { concentration_type: ['ai_itself'], power_use: ['generous'], reason: 'The AI was already shown to wield power generously — hostile goals contradict that' }
          ] },
        { id: 'marginal', label: 'Inert (for now)', disabledWhen: [
            // Same race as the inert_stays.no rule below — the
            // `escape_set: false` gate ensures this disable doesn't fire
            // before concentration_type.ai_itself's block-2 collapse has
            // moved ai_goals + escape_set to flavor. Under the old
            // multi-pass cleanSelection an invalidation sweep would have
            // deleted sel.ai_goals before the move ran, the move's
            // `when: { ai_goals: ['marginal'] }` would fail to match,
            // and escape_set would be stranded in sel — exactly the
            // race
            // probe-divergence flagged on (concentration_type, ai_itself,
            // sig escape_set:∅→yes).
            //
            // The gate semantics: at first-pass (ai_goals=marginal still
            // in sel), escape_set is necessarily 'yes' (set by the
            // prior ai_goals.marginal early-exit), so the disable does
            // NOT fire — the move handles the eviction instead. On
            // ESCAPE re-entry (after the move), both ai_goals and
            // escape_set are gone, so the gate flips true and the disable
            // correctly blocks the user from re-picking marginal.
            { concentration_type: ['ai_itself'], escape_set: false, reason: 'The AI already took control — it is not inert' },
            // Disables marginal during the ESCAPE_MODULE re-entry triggered
            // by inert_stays=no. Mirrors the gating pattern above: the
            // `escape_set: false` clause ensures this rule only fires
            // AFTER the inert_stays.no collapseToFlavor has evicted
            // `ai_goals` + `escape_set` to flavor.
            { inert_stays: ['no'], escape_set: false, reason: 'You already chose "eventually develops goals" — the AI can\'t stay inert' }
          ] }
      ] },
    { id: 'inert_stays', label: 'Does Escaped AI Stay Inert?', stage: 3, priority: 1,
      // Gated on who_benefits_set: inert_stays is a "final surprise"
      // that fires near the end of the chain, after who_benefits has
      // resolved. Without this gate, inert_stays becomes askable as
      // soon as ai_goals='marginal' is set (at escape module exit),
      // which would jump it ahead of who_benefits on some paths.
      // On the destruction path who_benefits_set is pre-set to 'yes'
      // by WAR_MODULE's exit plan (skipping who_benefits as a no-op),
      // so this single activateWhen still fires the inert_stays tail
      // for the marginal-AI destruction case — and the-ruin then
      // matches at inert_stays via its earlyExits annotation.
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
          // goal, this block's `when` no longer matches so subsequent
          // pushes' cleanSelection runs leave the new ai_goals alone.
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
      // early-exit, or inert_stays loop).
      hideWhen: [
        { containment: ['escaped'] }
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
      // alignment_durability.breaks now pre-writes gov_action='accelerate'
      // on its edge (visible to bucket-key projection). No deriveWhen needed.
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
      activateWhen: [{ gov_action: ['decelerate'] }],
      edges: [
        { id: 'robust', label: 'Solved — robust' },
        { id: 'brittle', label: 'Solved — brittle / partial', shortLabel: 'Brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet', disabledWhen: [{ alignment: ['brittle'], reason: 'Alignment is already partially solved' }] }
      ] },
    { id: 'decel_2mo_action', label: '2mo Decision', stage: 2,
      activateWhen: [
        {
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
      activateWhen: [{ decel_2mo_action: ['continue'] }],
      edges: [
        { id: 'robust', label: 'Solved — robust' },
        { id: 'brittle', label: 'Solved — brittle / partial', shortLabel: 'Brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet', disabledWhen: [{ alignment: ['brittle'], reason: 'Alignment is already partially solved' }] }
      ] },
    { id: 'decel_4mo_action', label: '4mo Decision', stage: 2,
      activateWhen: [
        {
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
      activateWhen: [{ decel_4mo_action: ['continue'] }],
      edges: [
        { id: 'robust', label: 'Solved — robust' },
        { id: 'brittle', label: 'Solved — brittle / partial', shortLabel: 'Brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet', disabledWhen: [{ alignment: ['brittle'], reason: 'Alignment is already partially solved' }] }
      ] },
    { id: 'decel_6mo_action', label: '6mo Decision', stage: 2,
      activateWhen: [
        {
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
      activateWhen: [{ decel_6mo_action: ['continue'] }],
      edges: [
        { id: 'robust', label: 'Solved — robust' },
        { id: 'brittle', label: 'Solved — brittle / partial', shortLabel: 'Brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet', disabledWhen: [{ alignment: ['brittle'], reason: 'Alignment is already partially solved' }] }
      ] },
    { id: 'decel_9mo_action', label: '9mo Decision', stage: 2,
      activateWhen: [
        {
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
      activateWhen: [{ decel_9mo_action: ['continue'] }],
      edges: [
        { id: 'robust', label: 'Solved — robust' },
        { id: 'brittle', label: 'Solved — brittle / partial', shortLabel: 'Brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet', disabledWhen: [{ alignment: ['brittle'], reason: 'Alignment is already partially solved' }] }
      ] },
    { id: 'decel_12mo_action', label: '12mo Decision', stage: 2,
      activateWhen: [
        {
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
      activateWhen: [{ decel_12mo_action: ['continue'] }],
      edges: [
        { id: 'robust', label: 'Solved — robust' },
        { id: 'brittle', label: 'Solved — brittle / partial', shortLabel: 'Brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet', disabledWhen: [{ alignment: ['brittle'], reason: 'Alignment is already partially solved' }] }
      ] },
    { id: 'decel_18mo_action', label: '18mo Decision', stage: 2,
      activateWhen: [
        {
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
      activateWhen: [{ decel_18mo_action: ['continue'] }],
      edges: [
        { id: 'robust', label: 'Solved — robust' },
        { id: 'brittle', label: 'Solved — brittle / partial', shortLabel: 'Brittle / partial' },
        { id: 'unsolved', label: 'Not solved yet', disabledWhen: [{ alignment: ['brittle'], reason: 'Alignment is already partially solved' }] }
      ] },
    { id: 'decel_24mo_action', label: '24mo Decision', stage: 2,
      activateWhen: [
        {
          decel_24mo_progress: ['robust', 'brittle', 'unsolved']
        }
      ],
      edges: [ { id: 'rival', label: 'Rival reaches parity' } ] },
    { id: 'proliferation_control', label: 'Proliferation Control', stage: 2,
      // The proliferation question is fundamentally about distribution
      // — "did the weights stay bottled up?" — not about alignment.
      // It's meaningful whenever an ASI exists, regardless of whether
      // alignment held: even on failed-alignment paths, deny_rivals /
      // secure_access vs. open release is a real choice with real
      // narrative consequences. Edge-level disabledWhen handles the
      // constraints:
      //   * distribution=open forces 'none' (deny_rivals, secure_access
      //     disabled — the tech is already out).
      //   * alignment=failed + distribution≠open blocks 'none' —
      //     deliberately releasing a misaligned model's weights is a
      //     drastic story beat we don't model here; on failed-alignment
      //     paths the question is restricted to whether your existing
      //     controlled distribution held or leaked.
      activateWhen: [
        { capability: ['asi'] }
      ],
      edges: [
        { id: 'deny_rivals', label: 'Deny rivals', disabledWhen: [{ distribution: ['open'], reason: 'The technology is already openly distributed' }] },
        { id: 'secure_access', label: 'Secure access', disabledWhen: [{ distribution: ['open'], reason: 'The technology is already openly distributed' }] },
        { id: 'none', label: 'Open access', disabledWhen: [
          { alignment: ['failed'], distribution: { not: ['open'] }, reason: 'Releasing the weights of a misaligned AI when you still had controlled distribution is a different, more drastic scenario than this question models' }
        ] }
      ] },
    { id: 'proliferation_outcome', label: 'Control Outcome', stage: 2,
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
      // Hides the question on hostile-AI loose paths. The hostile AI is
      // running geopolitics — there are no rival-power dynamics to ask
      // about. Mirrors who_benefits internals (power_promise / mobilization /
      // pushback_outcome / etc.): the `containment: { not: ['contained'] }`
      // exception keeps the question available on hostile-AI-then-caught
      // paths (escape pipeline ran, AI was contained — controlling powers
      // are humans again, rival dynamics matter).
      hideWhen: [{ ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } }],
      // Mirrors INTENT_MODULE.activateWhen — intent is the module's entry
      // internal and fires only when rival-power dynamics are relevant:
      // proliferation actually ran (proliferation_set='yes') and the AI
      // isn't benevolent. All no-rivals paths (alignment=failed+contained,
      // ai_goals=marginal/benevolent, escape-then-contained) skip straight
      // to who_benefits.
      activateWhen: [
        {
          capability: ['asi'],
          proliferation_set: ['yes'],
          ai_goals: { not: ['benevolent'] },
        },
      ],
      // deriveWhen removed: the peaceful-war intent overrides
      // (escalation_outcome=agreement | post_war_aims=human_centered →
      // intent='coexistence') moved into WAR_MODULE's exit plan. WAR is
      // the rightful writer of those dims, so it owns the intent override.
      // Same pattern as the prior moves of `pushback_outcome → international`
      // (deleted when who_benefits became a module) and `rival_dynamics →
      // intent` (now in INTENT_MODULE's rival_dynamics edges).
      // Edges keyed off "who is acting":
      //   * geo_spread=one + (state in control OR one lab in control) → a
      //     single coherent actor → self_interest available.
      //   * geo_spread=multiple → multi-country dynamics → coexistence /
      //     escalation. Note: distribution=open paths arrive here with
      //     geo_spread=multiple already set by PROLIFERATION_MODULE's exit
      //     plan (every leaked-weights branch writes geo_spread='multiple'),
      //     so no special-casing needed.
      //   * international: catch-all, always available.
      edges: [
        {
          id: 'self_interest',
          label: 'Self-interest',
          requires: [
            { geo_spread: ['one'], sovereignty: ['state'] },
            { geo_spread: ['one'], sovereignty: ['lab'], distribution: ['monopoly'] }
          ]
        },
        {
          id: 'coexistence',
          label: 'Coexistence',
          requires: { geo_spread: ['multiple'] }
        },
        {
          id: 'escalation',
          label: 'Escalation',
          requires: { geo_spread: ['multiple'] }
        },
        { id: 'international', label: 'International' }
      ] },
    // block_entrants / block_outcome / new_entrants: gated on
    //   distribution ≠ open               (tech still bottled up)
    //   intent ∈ {self_interest, international}  (controlling power exists)
    //
    // The gate is "is the tech still bottled up?" — not "is the AI aligned?".
    // PROLIFERATION_MODULE's exit plan flips distribution to 'open' on every
    // leaks_public-equivalent path, which is also the only way alignment
    // flips to 'failed' before intent_loop. So distribution≠open already
    // excludes all alignment=failed paths reachable at intent_loop entry.
    // It also future-proofs the gate: an "escaped + inert + monopoly" path
    // (alignment=failed, ai_goals=marginal, distribution=monopoly) should
    // still admit block_entrants — the controlling power can still deny
    // rivals — and the distribution-only gate handles that correctly.
    { id: 'block_entrants', label: 'Block New Entrants?', stage: 2,
      activateWhen: [
        {
          capability: ['asi'],
          distribution: { not: ['open'] },
          intent: ['self_interest', 'international']
        }
      ],
      edges: [ { id: 'attempt', label: 'Attempt to block' }, { id: 'no_attempt', label: 'No attempt' } ] },
    { id: 'block_outcome', label: 'Blocking Outcome', stage: 2,
      activateWhen: [{ capability: ['asi'], block_entrants: ['attempt'] }],
      edges: [ { id: 'holds', label: 'Holds' }, { id: 'fails', label: 'Fails' } ] },
    { id: 'new_entrants', label: 'New Entrants?', stage: 2,
      activateWhen: [{ capability: ['asi'], block_entrants: ['no_attempt'] }],
      edges: [ { id: 'emerge', label: 'Emerge' }, { id: 'none', label: 'None' } ] },
    { id: 'rival_dynamics', label: 'Rival Dynamics', stage: 2,
      // Hides on hostile-AI loose paths. Same pattern as intent above:
      // the `containment: { not: ['contained'] }` exception keeps the
      // node available on hostile-AI-then-caught paths so contained
      // hostile AIs flow through normal rival-dynamics resolution.
      hideWhen: [{ ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } }],
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
      // Module-entry internal. Mirrors WHO_BENEFITS_MODULE's intent_set
      // clause — fires on every path that completes intent_loop. The
      // benevolent short-circuit (ai_goals=benevolent) goes directly to
      // benefit_distribution (see its activateWhen), so power_promise
      // doesn't need a benevolent clause.
      //
      // Replaces seven legacy OR-clauses that enumerated specific (intent,
      // alignment, containment, post_war_aims, escalation_outcome,
      // brittle_resolution) combinations. Every such combo either sets
      // intent_set=yes via INTENT_MODULE.exitPlan, or never happens:
      //   - intent={coexistence,escalation} → direct exit, intent_set=yes
      //   - intent={self_interest,international} → exits via
      //     block_outcome.holds / new_entrants.none / rival_dynamics.*
      //     (all commit intent_set=yes)
      //   - brittle_resolution.* runs AFTER who_benefits_set=yes, so it
      //     was never observable when power_promise was activating.
      activateWhen: [
        { capability: ['asi'], intent_set: ['yes'] },
      ],
      edges: [
        { id: 'for_everyone', label: 'This is for everyone',
          disabledWhen: [
            { escalation_outcome: ['standoff'], reason: 'In a standoff between rival AI powers, the framing is security — not sharing' },
            { post_war_aims: ['self_interest'], reason: 'A victor consolidating power for themselves can\'t credibly frame the post-war order as "for everyone"' }
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
        // ai_itself = the user picks "humans handed the world to the AI".
        // Treated as a programmatic equivalent of inert_stays=no: a
        // dormant AI can't actually be running the world, so picking
        // ai_itself implicitly wakes it. Two collapseToFlavor blocks,
        // applied in order:
        //   1. set inert_stays='no' — the awake-AI signal. Stays in sel
        //      (`.set` writes to sel; only `.move` evicts) so ESCAPE
        //      and ai_goals.marginal.disabledWhen can read it.
        //   2. when ai_goals=marginal, move ai_goals + escape_set —
        //      mirrors the existing inert_stays.no.collapseToFlavor
        //      block exactly. If the user reached who_benefits via a
        //      prior marginal escape (ai_goals='marginal' in sel,
        //      escape_set='yes' from escape_early's exit plan), this
        //      evicts both so ESCAPE_MODULE looks pending again and
        //      escape_after_who fires to re-ask ai_goals.
        // The marginal+ai_itself path now unifies with the inert_stays
        // =no path through the same eviction plumbing — replaces the
        // old `disabledWhen: [{ ai_goals: ['marginal'] }]` rule that
        // blocked the contradiction by veto rather than reconciliation.
        //
        // The third block handles the "humans accidentally put a previously-
        // caught AI back in charge" path: if escape_early/escape_early_alt
        // ran and produced post_catch='contained' (AI was caged), picking
        // ai_itself opens the cage. Flip containment→'escaped' and
        // post_catch→'loose' so downstream outcome clauses (the-alien-ai
        // / the-escape / the-chaos, all keyed on post_catch='loose') match
        // the now-released hostile AI.
        { id: 'ai_itself', label: 'The AI itself',
          collapseToFlavor: [
            { set: { inert_stays: 'no' } },
            { when: { ai_goals: ['marginal'] }, move: ['ai_goals', 'escape_set'] },
            // Humans put a previously caged AI back in charge — flip
            // containment/post_catch (cage opens, AI loose again) AND
            // clear escape_set so the escape_after_who slot picker
            // claims the path. Without the move, escape_set='yes'
            // (set by the prior ESCAPE catch) blocks escape_after_who
            // and the path dead-ends in rollout with a contradictory
            // (containment=escaped, escape_set=yes) state.
            {
              when: { post_catch: ['contained'] },
              set: { containment: 'escaped', post_catch: 'loose' },
              move: ['escape_set']
            }
          ] }
      ] },
    { id: 'power_use', label: 'The Wielding', stage: 3, priority: 2,
      // Originally a question for human concentrated control (singleton /
      // inner_circle): "what does the person/group in charge do with the
      // power?". Extended to ai_itself: when humans accidentally hand the
      // AI everything, the same moral test applies — generous use is the
      // benevolent-AI ending, extractive/indifferent use forks into the
      // hostile-escape pipeline (ai_goals.benevolent disabled there to
      // prevent contradiction with the established power_use stance).
      activateWhen: [{ concentration_type: ['singleton', 'inner_circle', 'ai_itself'] }],
      edges: [
        { id: 'generous', label: 'A golden world',
          // ai_itself + generous = AI runs the world and runs it well.
          // Pre-resolve the ESCAPE module as a benevolent early-exit:
          //   * ai_goals='benevolent' — the module's intended outcome
          //     for this soft-takeover path.
          //   * escape_set='yes' — completion marker. Mirrors what
          //     ESCAPE_MODULE.exitPlan does on ai_goals.benevolent: marks
          //     the module "done" so escape_after_who's `escape_set:not
          //     yes` gate fails (otherwise the slot fires, ESCAPE is
          //     pending, but no internal is askable — ai_goals already
          //     set, catch pipeline gated on containment=escaped — and
          //     the path dead-ends).
          collapseToFlavor: { when: { concentration_type: ['ai_itself'] }, set: { ai_goals: 'benevolent', escape_set: 'yes' } } },
        // ai_itself + extractive/indifferent = AI took control AND wields
        // it badly. ai_goals.benevolent's disabledWhen
        // ({concentration_type:ai_itself, power_use:[extractive,indifferent]})
        // would have invalidated a stale ai_goals=benevolent under the
        // old multi-pass cleanSelection. With CS now single-pass, the
        // eviction lives here as an explicit move — runtime and static
        // analysis agree without needing an invalidation sweep.
        // ai_goals re-activates on concentration_type=ai_itself, so the
        // user is re-asked and picks a hostile goal, with the prior
        // value preserved in flavor for narrative continuity.
        // Symmetric to the generous block above.
        { id: 'extractive', label: 'A tightening grip',
          collapseToFlavor: { when: { concentration_type: ['ai_itself'], ai_goals: ['benevolent'] }, move: ['ai_goals'] } },
        { id: 'indifferent', label: 'Their own project',
          collapseToFlavor: { when: { concentration_type: ['ai_itself'], ai_goals: ['benevolent'] }, move: ['ai_goals'] } }
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
    // knowledge_rate / physical_rate: asi-only after the early-rollout
    // split. Plateau / agi paths now go through early_knowledge_rate /
    // early_physical_rate (separate nodes owned by EARLY_ROLLOUT_MODULE),
    // which write the same canonical knowledge_rate / physical_rate dims
    // via edge-level collapseToFlavor.set so outcome flavor lookups
    // (the-plateau.knowledge_rate.*, the-agi-economy.physical_rate.*)
    // continue to read the same dim names. The 'limited' edge dropped
    // here was always disabled on asi anyway; it lives only on the early
    // nodes now.
    { id: 'knowledge_rate', label: 'Knowledge Work', stage: 3, priority: 2,
      hideWhen: [
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } },
        { rollout_set: ['yes'] }
      ],
      activateWhen: [
        ...OUTCOME_ACTIVATE
      ],
      edges: [
        { id: 'rapid', label: 'Rapid' },
        { id: 'gradual', label: 'Gradual' },
        { id: 'uneven', label: 'Uneven' }
      ] },
    { id: 'physical_rate', label: 'Physical Automation', stage: 3, priority: 2,
      hideWhen: [
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } },
        { rollout_set: ['yes'] }
      ],
      activateWhen: [
        ...OUTCOME_ACTIVATE
      ],
      edges: [
        { id: 'rapid', label: 'Rapid' },
        { id: 'gradual', label: 'Gradual' },
        { id: 'uneven', label: 'Uneven' }
      ] },
    // early_knowledge_rate / early_physical_rate: plateau / agi versions
    // of the rollout questions. Each edge writes the canonical
    // knowledge_rate / physical_rate dim via collapseToFlavor.set so
    // outcomes that key on those names work transparently. The early_*
    // dims themselves are pure question-host nodes that move to flavor
    // on EARLY_ROLLOUT_MODULE exit (nodeIds \ writes auto-eviction).
    { id: 'early_knowledge_rate', label: 'Knowledge Work', stage: 3, priority: 2,
      hideWhen: [{ early_rollout_set: ['yes'] }],
      activateWhen: [
        { capability: ['plateau'] },
        { capability: ['agi'] }
      ],
      edges: [
        { id: 'rapid', label: 'Rapid',
          collapseToFlavor: { set: { knowledge_rate: 'rapid' } },
          disabledWhen: [{ capability: ['plateau'], stall_duration: ['hours', 'days'], reason: 'At this stall duration, rapid adoption isn\'t possible' }] },
        { id: 'gradual', label: 'Gradual',
          collapseToFlavor: { set: { knowledge_rate: 'gradual' } },
          disabledWhen: [{ capability: ['plateau'], stall_duration: ['hours'], reason: 'The stall is too short for gradual rollout' }] },
        { id: 'uneven', label: 'Uneven',
          collapseToFlavor: { set: { knowledge_rate: 'uneven' } } },
        { id: 'limited', label: 'Limited',
          collapseToFlavor: { set: { knowledge_rate: 'limited' } },
          disabledWhen: [
            { capability: ['plateau'], stall_duration: ['weeks', 'months'], reason: 'With a longer stall, AI has room to move beyond augmentation' }
          ] }
      ] },
    { id: 'early_physical_rate', label: 'Physical Automation', stage: 3, priority: 2,
      hideWhen: [{ early_rollout_set: ['yes'] }],
      activateWhen: [
        { capability: ['plateau'] },
        { capability: ['agi'] }
      ],
      edges: [
        { id: 'rapid', label: 'Rapid',
          collapseToFlavor: { set: { physical_rate: 'rapid' } },
          disabledWhen: [{ capability: ['plateau'], reason: 'Physical automation can\'t be rapid while AI itself is plateaued' }] },
        { id: 'gradual', label: 'Gradual',
          collapseToFlavor: { set: { physical_rate: 'gradual' } },
          disabledWhen: [{ capability: ['plateau'], stall_duration: ['hours'], reason: 'The stall is too short for gradual rollout' }] },
        { id: 'uneven', label: 'Uneven',
          collapseToFlavor: { set: { physical_rate: 'uneven' } } },
        { id: 'limited', label: 'Limited',
          collapseToFlavor: { set: { physical_rate: 'limited' } } }
      ] },
    { id: 'brittle_resolution', label: 'Long-Term Alignment Fate', stage: 3, priority: 1,
      // Only hidden once the AI has already escaped — on an escape path the
      // long-term fate question is moot (containment is already broken and
      // alignment is already headed for 'failed' via the catch / no-catch
      // outcome). Everywhere else (alignment=brittle + contained) this is
      // the "final surprise" question.
      hideWhen: [
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
          // Re-entry trigger for ESCAPE_MODULE at the escape_late slot.
          // The brittle alignment broke late (after who_benefits resolved);
          // the AI is loose again. Mirrors the proliferation leak pattern:
          // flip containment + reset post_catch=loose, and clear
          // escape_set + ai_goals so ESCAPE re-fires and the user walks
          // the catch pipeline again. (At escape_late, who_benefits_set
          // ='yes' so catch_outcome WILL be asked — this is the "final
          // say" slot.) ai_goals is moved alongside escape_set so that
          // benevolent/marginal AIs whose alignment shattered get the
          // chance to re-pick (alignment=brittle implied an assumption
          // about the AI's stance; that assumption is gone now). Without
          // moving ai_goals, paths with ai_goals already pinned arrive
          // at escape_late with no askable internal and the module gets
          // stuck pending — same eviction pattern as the proliferation
          // leak tuples (LEAK_REENTRY_MOVE).
          collapseToFlavor: {
            set: { alignment: 'failed', containment: 'escaped', post_catch: 'loose' },
            move: ['escape_set', 'ai_goals']
          } }
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
        { id: 'digital_countermeasure', label: 'Targeted digital countermeasure', shortLabel: 'Digital counter',
          disabledWhen: [{ concentration_type: ['ai_itself'], reason: 'The AI controls the digital systems that would deploy a countermeasure' }] },
        { id: 'infrastructure_shutdown', label: 'Infrastructure shutdown', shortLabel: 'Infra shutdown',
          disabledWhen: [{ concentration_type: ['ai_itself'], reason: 'The AI runs the infrastructure — humans can\'t shut down what they don\'t control' }] },
        { id: 'physical_strikes', label: 'Physical strikes on compute', shortLabel: 'Physical strikes',
          disabledWhen: [{ concentration_type: ['ai_itself'], reason: 'The AI controls physical operations — strikes can\'t reach its compute' }] },
        { id: 'emp', label: 'Electromagnetic pulse', shortLabel: 'EMP',
          disabledWhen: [{ concentration_type: ['ai_itself'], reason: 'The AI commands the systems that would deploy an EMP' }] },
        { id: 'negotiation', label: 'Negotiation / containment', shortLabel: 'Negotiation' },
        { id: 'competitive_paralysis', label: 'Competitive paralysis', shortLabel: 'Paralysis',
          disabledWhen: [
            { geo_spread: ['one'], reason: 'Only one actor — no competitive dynamic' },
            { concentration_type: ['ai_itself'], reason: 'No competing actors — the AI is the sole sovereign' }
          ] },
        { id: 'institutional_indecisiveness', label: 'Institutional indecisiveness', shortLabel: 'Indecisiveness',
          disabledWhen: [{ concentration_type: ['ai_itself'], reason: 'No independent institutions remain — the AI runs them all' }] }
      ] },
    { id: 'response_success', label: 'Success?', stage: 3,
      hideWhen: [{ war_survivors: ['none'] }],
      activateWhen: [
        { response_method: ['digital_countermeasure', 'infrastructure_shutdown', 'physical_strikes', 'emp', 'negotiation'] }
      ],
      edges: [
        { id: 'yes', label: 'Yes — AI actually neutralized', shortLabel: 'Yes — neutralized',
          disabledWhen: [{ concentration_type: ['ai_itself'], reason: 'The AI controls the levers of any response — neutralization isn\'t possible' }] },
        { id: 'delayed', label: 'Delayed — AI disrupted but recovering', shortLabel: 'Delayed',
          disabledWhen: [{ concentration_type: ['ai_itself'], reason: 'The AI controls the levers of any response — even temporary disruption isn\'t possible' }] },
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
      // `who_benefits_set != yes` skips this question at the early-escape
      // slots (escape_early, escape_early_alt) where downstream events
      // (proliferation leak, brittle_resolution=escape, concentration_type
      // =ai_itself) can re-trigger an escape and contradict a "permanent"
      // commitment. At those slots the catch defaults to "caged for now"
      // (post_catch=contained set on the collateral_impact early-exit
      // tuples in buildEscapeExitPlan); the final "is the catch permanent?"
      // question is asked at the truly-terminal escape slots
      // (escape_late, escape_re_entry, escape_after_who) where
      // who_benefits_set='yes'.
      hideWhen: [
        { war_survivors: ['none'] },
        { who_benefits_set: { not: ['yes'] } }
      ],
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
      // Two activation paths:
      //   1. Terminal escape slots (who_benefits_set=yes): fires when the
      //      user explicitly committed catch_outcome=holds_permanently AND
      //      collateral_impact=civilizational. Original behavior.
      //   2. Early escape slots (who_benefits_set != yes): catch_outcome
      //      is hidden, but the war_survivors flow still matters whenever
      //      response_success=yes AND collateral_impact=civilizational —
      //      the response wrecked civilization regardless of whether the
      //      catch turns out to be "permanent" downstream.
      activateWhen: [
        { catch_outcome: ['holds_permanently'], collateral_impact: ['civilizational'] },
        { response_success: ['yes'], collateral_impact: ['civilizational'], who_benefits_set: { not: ['yes'] } }
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
// until terminal, then commit a write bundle to global `sel` via the
// collapseToFlavor blocks attachModuleReducer installed on the module's
// exit edges.
//
// Declaration shape:
//   {
//     id,
//     activateWhen: [conditions], // gates module entry; same grammar as nodes
//     reads:  [dim ids],          // globals visible inside the module
//     writes: [dim ids],          // dims committed to globals on exit
//     nodeIds: [node ids],        // top-level nodes that belong to the module
//     completionMarker: ...,      // dim (or { dim, values }) whose presence in
//                                 // sel signals the module is done — must be
//                                 // in writes (string form) so the sel-only
//                                 // outer DFS sees the module as committed
//     exitPlan: [                 // single source of truth for how the
//       { nodeId, edgeId, when, set },   // module exits. One tuple per
//       ...                              // (node, edge) termination point;
//     ],                                 // `set` is the write bundle, `when`
//                                        // is the gate over local state.
//                                        // attachModuleReducer installs each
//                                        // tuple as a collapseToFlavor block
//                                        // on its edge at graph load.
//   }
//
// The legacy `reduce(local)` function field was retired once every
// module's exitPlan became the authoritative source — runtime writes
// go through attached collapseToFlavor blocks, and audit tooling uses
// `engine.reduceFromExitPlan(mod, local)` to ask "what bundle would
// this exitPlan produce for a given local state?".

const DECEL_MODULE_NODE_IDS = (function() {
    const ids = [];
    for (const [pKey, aKey] of DECEL_PAIRS) { ids.push(pKey, aKey); }
    return ids;
})();

// Decel exit cells — the hand-authored source of truth for the decel
// module's outcomes.
//
// Shape: one row per distinct (terminating_action, progress_at_that_month)
// outcome. `set` is the write bundle committed to sel on module exit
// (minus the completion marker `decel_set`, which every exit commits).
//
// `buildDecelExitPlan()` expands each cell across DECEL_PAIRS (7 month
// pairs) into 63 exitPlan tuples — one per (action-node, action-edge)
// carrying a `when:{progress-key:[progress]}` gate. `buildDecelReducerTable()`
// pivots the same cells into the legacy 2D `{action:{progress:set}}`
// audit view that explore.js / module-audit.js still consume.
//
// This is the "exitPlan is source of truth" direction (step 2 of the
// reducerTable → exitPlan migration). Pre-inversion, the 2D reducerTable
// was authored directly and the exitPlan was derived from it. Post-
// inversion, the flat cell list is authored and both shapes are derived.
//
// Provenance (which pre-module deriveWhen rule each write subsumes):
//   alignment:
//     - (accelerate, robust) = robust   <- alignment.deriveWhen via decel_outcome=solved
//     - (escapes,    *)      = failed   <- alignment.deriveWhen via decel_outcome=escapes
//     - all others: not written (alignment stays as whatever alignment_loop
//       committed; pre-inversion rival also wrote alignment, but that
//       blocked proliferation_control — see comment on the rival cells).
//   geo_spread:
//     - (rival, *) = multiple           <- geo_spread.deriveWhen (rival cells only)
//   rival_emerges:
//     - (rival, *) = yes                <- rival_emerges.deriveWhen
//   governance:
//     - (escapes, *)          = slowdown  <- governance fallback for gov_action=decelerate
//     - (accelerate, *)       = race      <- governance.deriveWhen via decel_outcome=abandon/solved
//     - (rival, *) not set    (module doesn't override; sel retains prior value)
//   containment:
//     - (escapes, *) = escaped          <- replaces legacy containment.contained.disabledWhen lock
//   decel_align_progress:
//     - always = the progress value at the terminating month
//                                       <- replaces decel_align_progress.deriveWhen
//
// `rival` = rival lab reaches parity; decel is INTERRUPTED, not completed
// on the user's alignment axis. All three progress rows write the SAME
// bundle — the rival-arrives event doesn't depend on how far progress
// got, because it's external. We signal multi-polar world / rivals
// emerged and leave alignment alone so proliferation_control can still
// activate on the (rival, unsolved) cell (which otherwise would have
// alignment='failed' blocking it).
const DECEL_EXIT_CELLS = [
    { action: 'escapes',    progress: 'robust',   set: { alignment: 'failed', governance: 'slowdown', containment: 'escaped', decel_align_progress: 'robust'   } },
    { action: 'escapes',    progress: 'brittle',  set: { alignment: 'failed', governance: 'slowdown', containment: 'escaped', decel_align_progress: 'brittle'  } },
    { action: 'escapes',    progress: 'unsolved', set: { alignment: 'failed', governance: 'slowdown', containment: 'escaped', decel_align_progress: 'unsolved' } },

    // (accelerate, robust): governance='race' (user decelerated to solve
    // alignment, then resumed racing). Pre-simplification this cell
    // resolved to governance=undefined because gov_action was moved to
    // flavor by the accelerate collapse — the reducer commits governance
    // explicitly to remove that quirk.
    { action: 'accelerate', progress: 'robust',   set: { alignment: 'robust', governance: 'race', decel_align_progress: 'robust'   } },
    { action: 'accelerate', progress: 'brittle',  set: {                      governance: 'race', decel_align_progress: 'brittle'  } },
    { action: 'accelerate', progress: 'unsolved', set: {                      governance: 'race', decel_align_progress: 'unsolved' } },

    { action: 'rival',      progress: 'robust',   set: { geo_spread: 'multiple', rival_emerges: 'yes' } },
    { action: 'rival',      progress: 'brittle',  set: { geo_spread: 'multiple', rival_emerges: 'yes' } },
    { action: 'rival',      progress: 'unsolved', set: { geo_spread: 'multiple', rival_emerges: 'yes' } },
];

// Derived: legacy 2D `{action:{progress:set}}` view of the cell list.
// Kept exposed on DECEL_MODULE.reducerTable so explore.js's
// `_buildModuleSyntheticNode` and module-audit.js's reducer-cell audit
// keep working without migration. Consumers that want the exit plan
// instead can use mod.exitPlan directly.
function buildDecelReducerTable() {
    const table = {};
    for (const { action, progress, set } of DECEL_EXIT_CELLS) {
        (table[action] = table[action] || {})[progress] = { ...set };
    }
    return table;
}
const DECEL_REDUCER_TABLE = buildDecelReducerTable();

// Module "exit plan" — enumerates, as static tuples, every
// (action-node, action-edge, progress-when, write-bundle) combination for
// which the module should commit its reducer output. For action/progress
// modules like decel, this is the cross product of DECEL_PAIRS and
// reducerTable cells. For other shapes we'll generalize later.
function buildDecelExitPlan() {
    // Expand each of the 9 DECEL_EXIT_CELLS across the 7 DECEL_PAIRS →
    // 63 tuples. Every exit commits `decel_set: 'yes'` as the explicit
    // completion marker (pre-simplification the auto-detected marker
    // was `containment`, but only `escapes` cells wrote containment —
    // accelerate/rival cells didn't, so the module was technically
    // never "done" on those paths and post-exit `decel_*_progress`
    // internals kept blocking main-chain modules via the priority
    // gate).
    const plan = [];
    for (const [pKey, aKey] of DECEL_PAIRS) {
        for (const { action, progress, set } of DECEL_EXIT_CELLS) {
            plan.push({
                nodeId: aKey,
                edgeId: action,
                when: { [pKey]: [progress] },
                set: { decel_set: 'yes', ...set },
            });
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
        // Explicit completion marker — see `completionMarker` below.
        'decel_set',
    ],
    completionMarker: 'decel_set',
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
    // Module-internal contiguity is now enforced by FLOW_DAG navigation
    // (FlowPropagation.flowNext): once a module owns the sel, only its
    // own internals are surfaced until completionMarker fires.
    // Derived 2D (action × progress) view of DECEL_EXIT_CELLS. Exposed
    // for explore.js / module-audit.js — which still drive their
    // "atomic outcome" synthetic nodes off the legacy reducerTable
    // shape. NOT an authored primitive: changes to decel outcomes go
    // in DECEL_EXIT_CELLS, which both this table and the exitPlan
    // below derive from.
    reducerTable: DECEL_REDUCER_TABLE,
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
    // concentration_type=ai_itself early exits — when humans put the AI in
    // charge, they can't catch it. The AI controls the response systems
    // (only `negotiation` is enabled on response_method) and the response
    // can't succeed (only `no` is enabled on response_success). Rather than
    // forcing the user through the rest of the catch pipeline (collateral_
    // impact + catch_outcome) where every choice would be a forced one,
    // exit early at response_success.no with post_catch=loose. Same for
    // discovery_timing.never (the AI's plan succeeded undetected — humans
    // never even tried to respond).
    plan.push({
        nodeId: 'response_success', edgeId: 'no',
        when: { concentration_type: ['ai_itself'] },
        set: { escape_set: 'yes', post_catch: 'loose' },
    });
    plan.push({
        nodeId: 'discovery_timing', edgeId: 'never',
        when: { concentration_type: ['ai_itself'] },
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
    // Early-escape-slot exits (who_benefits_set != yes) — at escape_early
    // and escape_early_alt, catch_outcome is hidden because downstream
    // events can re-trigger an escape (proliferation leak,
    // concentration_type=ai_itself, brittle_resolution=escape). The
    // module exits one node earlier:
    //   * collateral_impact.{minimal, severe} on response_success=yes
    //     paths → "caged for now" (post_catch=contained,
    //     containment=contained). Downstream may flip these back to
    //     escaped/loose, in which case ESCAPE re-fires at the next slot.
    //   * collateral_impact.{minimal, severe, civilizational} on
    //     response_success.delayed paths → AI is recovering, treated
    //     as not-really-caught (post_catch=loose). Mirrors the old
    //     catch_outcome=not_permanent semantics for delayed responses.
    //   * collateral_impact=civilizational on response_success=yes
    //     paths defers to collateral_survivors (no early-slot tuple
    //     matches here — its own early-slot tuples below take over).
    for (const cImpact of ['minimal', 'severe']) {
        plan.push({
            nodeId: 'collateral_impact', edgeId: cImpact,
            when: { who_benefits_set: { not: ['yes'] }, response_success: ['yes'] },
            set: { escape_set: 'yes', post_catch: 'contained', containment: 'contained' },
        });
    }
    for (const cImpact of ['minimal', 'severe', 'civilizational']) {
        plan.push({
            nodeId: 'collateral_impact', edgeId: cImpact,
            when: { who_benefits_set: { not: ['yes'] }, response_success: ['delayed', 'no'] },
            set: { escape_set: 'yes', post_catch: 'loose' },
        });
    }
    // collateral_survivors — tail exits for the civilizational branch.
    // post_catch=ruined. Each edge also writes its own value into the
    // shared war_survivors dim. Two paths reach here:
    //   1. Terminal slot, catch_outcome=holds_permanently (the original
    //      "permanent ruin" path). containment was already flipped to
    //      contained by catch_outcome.holds_permanently's exit tuple, but
    //      that tuple's `when` excludes civilizational — so on this branch
    //      containment is still escaped. The exit here doesn't override
    //      it (matches the historical behavior).
    //   2. Early slot, response_success=yes + collateral_impact
    //      =civilizational (catch_outcome hidden). containment hasn't
    //      been flipped yet — we explicitly set it to contained here so
    //      downstream nodes see a coherent "AI was caught at the cost of
    //      civilization" state. (If proliferation later leaks weights,
    //      it'll flip containment back to escaped and clear escape_set,
    //      same as on non-civilizational paths.)
    const cs = NODE_MAP.collateral_survivors;
    if (cs && cs.edges) {
        for (const e of cs.edges) {
            // war_set='yes' mirrors what WAR_MODULE.exitPlan sets on
            // war_survivors edges directly. Since collateral_survivors
            // writes to the shared war_survivors dim, the war pipeline
            // is logically complete on this branch (the AI catastrophe
            // resolved instead of an escalation war). Setting war_set
            // explicitly here keeps the post-push state consistent
            // between runtime and static analysis without depending on
            // a multi-pass invalidation/cascade — both paths see
            // war_set=yes in sel after the push.
            plan.push({
                nodeId: 'collateral_survivors', edgeId: e.id,
                when: { catch_outcome: ['holds_permanently'] },
                set: { escape_set: 'yes', post_catch: 'ruined', war_survivors: e.id, war_set: 'yes' },
            });
            plan.push({
                nodeId: 'collateral_survivors', edgeId: e.id,
                when: { who_benefits_set: { not: ['yes'] } },
                set: { escape_set: 'yes', post_catch: 'ruined', war_survivors: e.id, containment: 'contained', war_set: 'yes' },
            });
        }
        // Extinction (collateral_survivors='none') invalidates the
        // pro-humanity ai_goals values via their disabledWhen rules
        // (`war_survivors:['none']` evicts both benevolent and
        // alien_coexistence — there's no humanity left to benefit or
        // coexist with). The runtime cleanSelection function used to
        // have a separate invalidation pass that did this implicitly,
        // but it's been removed in favor of explicit push-time evictions
        // so static analysis (graph-io._applyEdgeWrites) and runtime
        // produce identical sels. The eviction now lives here as an
        // explicit `move`: when ai_goals is one of the war_survivors-
        // disabled values, move it to flavor.
        // ai_goals re-activates downstream so the user picks a hostile
        // value compatible with extinction (paperclip, power_seeking, or
        // alien_coexistence's harsher cousins). Same pattern as the
        // power_use.{extractive,indifferent} fix above.
        plan.push({
            nodeId: 'collateral_survivors', edgeId: 'none',
            when: { ai_goals: ['benevolent', 'alien_coexistence'] },
            move: ['ai_goals'],
        });
    }
    return plan;
}

const ESCAPE_MODULE = {
    id: 'escape',
    // Mirrors ai_goals's own activateWhen exactly — so the module is pending
    // from the moment ai_goals would first be askable through to either an
    // early-exit (benevolent/marginal) or pipeline completion (catch_outcome).
    activateWhen: [
        { containment: ['escaped'] },
        { concentration_type: ['ai_itself'] },
    ],
    reads: [
        // Gates into the pipeline (escape_method.activateWhen, various
        // pipeline hideWhen/disabledWhen clauses)
        'containment',
        'concentration_type', 'geo_spread',
        // ai_goals hostile-edge disabledWhen — intrinsic alignment
        // (proliferation_alignment='holds') rules out hostile goals.
        'proliferation_alignment',
        // inert_stays.no re-triggers this module (evicts ai_goals + escape_set)
        // and is read by ai_goals.marginal.disabledWhen on re-entry.
        'inert_stays',
        // ai_goals.{benevolent,paperclip,power_seeking,alien_*}.disabledWhen
        // gate on power_use to enforce the soft-takeover invariant:
        //   * power_use=generous + ai_itself → only benevolent is enabled
        //   * power_use=extractive/indifferent + ai_itself → benevolent disabled
        // Without power_use in reads, cartesianWriteRows would generate
        // contradictory output projections (e.g. generous + paperclip).
        'power_use',
    ],
    writes: ESCAPE_WRITES,
    nodeIds: ESCAPE_NODE_IDS,
    completionMarker: 'escape_set',
    // Module-internal contiguity is enforced by FLOW_DAG navigation
    // (FlowPropagation.flowNext): once escape owns the sel, only escape
    // internals are surfaced until escape_set fires.
    get exitPlan() { return buildEscapeExitPlan(); },
};

// Expand a declarative exit table into the flat tuple list the engine
// consumes. Each table row is { nodeId, edges, set, when? } and produces
// one tuple per edge-id. Used by modules whose exits don't need per-edge
// `when` disambiguation (emergence, control). Rows can still set a
// shared `when` if needed; edge ids that don't exist on the node are
// silently skipped (mirrors the legacy per-edge lookup).
function expandExitTable(rows) {
    const plan = [];
    for (const row of rows) {
        const n = NODE_MAP[row.nodeId];
        if (!n || !n.edges) continue;
        const want = new Set(row.edges);
        for (const e of n.edges) {
            if (!want.has(e.id)) continue;
            plan.push({
                nodeId: row.nodeId,
                edgeId: e.id,
                when: row.when || {},
                set: { ...row.set },
            });
        }
    }
    return plan;
}

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
        // Per-tuple `move` augments the auto-computed base list. Used
        // for re-fire patterns: a tuple that wants to clear a dim
        // OWNED by another module (e.g. proliferation leak edges
        // clearing `escape_set` so ESCAPE_MODULE re-fires for a
        // second catch pipeline). The auto-list already covers
        // `nodeIds \ writes`; per-tuple move adds extras.
        const move = (tuple.move && tuple.move.length)
            ? Array.from(new Set(moveDims.concat(tuple.move)))
            : moveDims.slice();
        byEdge.get(key).push({ when: tuple.when, set: tuple.set, move });
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
    // Benefit distribution is read by every sel-only outcome match
    // (the-gilded / the-new-hierarchy / the-flourishing / the-capture /
    // the-mosaic). Must persist to sel post-exit for validate2.js.
    'benefit_distribution',
    'concentration_type',
    'delivery_ask_eligible',
    // power_use must persist to sel post-exit for the ai_itself
    // soft-takeover path: ai_goals.benevolent.disabledWhen reads
    // power_use ∈ {extractive, indifferent} to gate out benevolent
    // goals once the AI has been established as exploitative. (Was
    // previously evicted to flavor — fine when power_use was only
    // a singleton/inner_circle question with no external readers.)
    'power_use',
    // ai_goals is normally owned by ESCAPE_MODULE, but
    // power_use.generous's collapseToFlavor (gated on
    // concentration_type=ai_itself) writes ai_goals='benevolent' to
    // pre-resolve the AI's stance for the soft-takeover-generous
    // outcome. Without ai_goals in writes, cartesianWriteRows's
    // output projection drops the override and any upstream
    // ai_goals (e.g. =marginal from a brittle-then-inert path that
    // also reaches who_benefits) flows through unchanged, producing
    // the contradictory state ai_goals=marginal + power_use=generous.
    // Including it in writes makes the projection capture the
    // override on the generous branch and the upstream value
    // (when present) on every other branch.
    'ai_goals',
    // inert_stays is normally owned by the standalone inert_stays
    // node-slot, but concentration_type.ai_itself's collapseToFlavor
    // writes inert_stays='no' to treat the AI-soft-takeover path as
    // "AI is awake and running the world". Without it in writes,
    // cartesianWriteRows's output projection drops the derivation
    // and downstream slot gates (escape_after_who's `escape_set:not
    // yes` after the cascade-driven eviction; ai_goals.marginal's
    // disabledWhen on inert_stays=no) can't see it. Same pattern
    // as ai_goals above.
    'inert_stays',
    // escape_set is normally owned by ESCAPE_MODULE (it's its
    // completionMarker), but power_use.generous's collapseToFlavor
    // (gated on concentration_type=ai_itself) sets escape_set='yes'
    // to signal "ESCAPE module pre-resolved as a benevolent early-
    // exit". Without it in writes, cartesianWriteRows's projection
    // drops the marker and escape_after_who fires uselessly downstream.
    // Same cross-module-write pattern as ai_goals.
    'escape_set',
    // containment / post_catch are normally owned by ESCAPE_MODULE,
    // but concentration_type.ai_itself's collapseToFlavor (gated on
    // post_catch='contained' — the AI was caught earlier) flips
    // them back to ('escaped', 'loose') to model "humans accidentally
    // put the caged AI back in charge, opening the cage". Without
    // them in writes, cartesianWriteRows's output projection drops
    // the override and the merged downstream sel retains the
    // upstream ('contained', 'contained') values, dead-ending in
    // rollout where no outcome clause matches the contradictory
    // (concentration_type=ai_itself + post_catch=contained) state.
    // Same cross-module-write pattern as ai_goals / inert_stays /
    // escape_set above.
    'containment', 'post_catch',
    // Completion marker — must be in `writes` so `captureExitResult`
    // puts it into `setSel` (not setFlavor). Without this, the sel-only
    // outer DFS never sees the module as done and re-fires it.
    'who_benefits_set',
];

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
        // [singleton, inner_circle, ai_itself] }. Defer module exit on
        // those three edges so power_use gets asked next; exit directly
        // on {elites} which doesn't activate power_use.
        // (ai_itself is the AI-soft-takeover path — power_use becomes
        // the moral test for what the AI does with the world it was
        // handed; see power_use.generous.collapseToFlavor for how
        // generous derives ai_goals=benevolent for that path.)
        const deferToPowerUse = new Set(['singleton', 'inner_circle', 'ai_itself']);
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
    // Simplified gate: who_benefits fires when the upstream rival/intent
    // chain has committed (`intent_set: 'yes'`, meaning intent_loop walked
    // to completion), OR on the benevolent-AI short-circuit (ai_goals=
    // 'benevolent' routes past proliferation / intent / war straight here
    // — see the `escape_early → who_benefits` arrow in the flow DAG).
    // Internals still reference alignment / ai_goals / post_war_aims /
    // escalation_outcome for their own activateWhen + hideWhen gates.
    activateWhen: [
        { capability: ['asi'], intent_set: ['yes'] },
        { capability: ['asi'], ai_goals: ['benevolent'] },
    ],
    reads: [
        'capability',
        // Activation gate (module-level + power_promise mirrors intent_set)
        'intent_set', 'ai_goals',
        // Internal hideWhens gate on ai_goals/containment; benefit_distribution
        // disabledWhens reference intent; power_promise edge disabledWhens
        // reference escalation_outcome (standoff disables for_everyone /
        // best_will_rise narrative framings) and post_war_aims (self_interest
        // disables for_everyone — a victor consolidating power can't credibly
        // promise inclusion).
        'containment', 'intent', 'escalation_outcome', 'post_war_aims',
        // benefit_distribution activates via post_catch (the consolidated
        // escape-exit marker).
        'post_catch',
    ],
    writes: WHO_BENEFITS_WRITES,
    nodeIds: WHO_BENEFITS_NODE_IDS,
    completionMarker: 'who_benefits_set',
    get exitPlan() { return buildWhoBenefitsExitPlan(); },
};

// ════════════════════════════════════════════════════════
// EARLY_ROLLOUT_MODULE — the "plateau / agi rollout" sub-loop
// ════════════════════════════════════════════════════════
//
// Groups the two stage-3 rollout questions for plateau / agi paths:
//   * early_knowledge_rate — pace of AI impact on knowledge work
//   * early_physical_rate  — pace of AI impact on physical work
//
// Each early_* edge writes the canonical knowledge_rate / physical_rate
// dim via collapseToFlavor.set so outcomes (the-plateau, the-agi-
// economy, etc.) read the same dim names regardless of which module
// asked the question. The early_* dims themselves are pure question
// hosts — they move to flavor on module exit (nodeIds \ writes auto-
// eviction in attachModuleReducer).
//
// Two contexts:
//   * capability='plateau' — both questions asked, exit on
//     early_physical_rate.*
//   * capability='agi' (auto-shallow) — same shape, exit on
//     early_physical_rate.*
//
// Completion marker: `early_rollout_set`. Set on every
// early_physical_rate.* edge (the terminal question; early_knowledge_
// rate is asked first by priority + position).

const EARLY_ROLLOUT_NODE_IDS = [
    'early_knowledge_rate',
    'early_physical_rate',
];

// knowledge_rate / physical_rate persist globally (written by edge-
// level collapseToFlavor.set). early_rollout_set is the EARLY_ROLLOUT
// completion marker, set on every exit tuple, and is what the
// the-plateau / the-automation outcome reachable clauses key on
// (paired with capability=plateau / capability=agi). The shared
// `rollout_set` marker belongs to ROLLOUT_MODULE on the asi path
// only — early_rollout deliberately does NOT write it, since no
// plateau/agi-side reader needs it. The early_* node dims themselves
// are NOT in writes, so attachModuleReducer auto-evicts them to
// flavor on exit.
const EARLY_ROLLOUT_WRITES = ['knowledge_rate', 'physical_rate', 'early_rollout_set'];

function buildEarlyRolloutExitPlan() {
    const plan = [];
    const pr = NODE_MAP.early_physical_rate;
    if (pr && pr.edges) {
        for (const e of pr.edges) {
            plan.push({
                nodeId: 'early_physical_rate',
                edgeId: e.id,
                when: {},
                set: { early_rollout_set: 'yes' },
            });
        }
    }
    return plan;
}

const EARLY_ROLLOUT_MODULE = {
    id: 'early_rollout',
    activateWhen: [
        // plateau_benefit_distribution / auto_benefit_distribution write
        // the shared `who_benefits_set` marker; only activate this module
        // once Who Benefits has resolved.
        { capability: ['plateau'], who_benefits_set: ['yes'] },
        { capability: ['agi'], who_benefits_set: ['yes'] },
    ],
    reads: [
        // Activation gate.
        'capability', 'who_benefits_set',
        // Edge disabledWhen on early_knowledge_rate / early_physical_rate
        // (plateau-specific stall-duration disables).
        'stall_duration',
        // Module's own completion marker is read by every internal node's
        // hideWhen (post-answer re-ask guard).
        'early_rollout_set',
    ],
    writes: EARLY_ROLLOUT_WRITES,
    nodeIds: EARLY_ROLLOUT_NODE_IDS,
    completionMarker: 'early_rollout_set',
    get exitPlan() { return buildEarlyRolloutExitPlan(); },
};

// ════════════════════════════════════════════════════════
// ROLLOUT_MODULE — the asi rollout sub-loop
// ════════════════════════════════════════════════════════
//
// Groups the three stage-3 rollout questions for the ASI main path:
//   * knowledge_rate — pace of AI impact on knowledge work
//   * physical_rate  — pace of AI impact on physical work
//   * failure_mode   — "Delivery": does the transformation match intent,
//     or do the metrics diverge from reality?
//
// Plateau / agi paths are handled by EARLY_ROLLOUT_MODULE (separate
// early_knowledge_rate / early_physical_rate nodes that write the same
// canonical knowledge_rate / physical_rate dims via collapseToFlavor.set).
//
// Two ASI sub-contexts:
//   * delivery_ask_eligible ≠ no — main ASI path: all three asked; exit
//     on failure_mode.* edges.
//   * delivery_ask_eligible = no — ASI-capture exit: failure_mode is
//     hidden, physical_rate is the terminal question and must close the
//     module (sets failure_mode='none' so sel-only outcome matching
//     succeeds).
//
// Writes: [failure_mode, knowledge_rate, physical_rate, rollout_set].
// All three question dims persist globally so sel-only outcome matching
// (validate2.js + outcome reachable clauses keying on failure_mode) can
// read them.
//
// Post-exit self-hide: each of the 3 nodes adds `{ rollout_set: ['yes'] }`
// to hideWhen so findNextQ doesn't re-offer them.
//
// Completion marker: `rollout_set`.

const ROLLOUT_NODE_IDS = [
    'knowledge_rate',
    'physical_rate',
    'failure_mode',
];

const ROLLOUT_WRITES = ['failure_mode', 'knowledge_rate', 'physical_rate', 'rollout_set'];

// Exit tuples:
//   * failure_mode.{none, drift} — main ASI path exit when
//     delivery_ask_eligible ≠ no.
//   * physical_rate.* (capability=asi + delivery_ask_eligible=no) —
//     ASI-capture exit; failure_mode is hidden, physical_rate closes
//     the module. Set failure_mode='none' so sel-only outcome matching
//     (the-new-hierarchy / the-capture gates requiring
//     failure_mode=none) succeeds.
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
            plan.push({
                nodeId: 'physical_rate',
                edgeId: e.id,
                when: { capability: ['asi'], delivery_ask_eligible: ['no'] },
                set: { rollout_set: 'yes', failure_mode: 'none' },
            });
        }
    }
    return plan;
}

const ROLLOUT_MODULE = {
    id: 'rollout',
    activateWhen: [
        // ASI-only. OUTCOME_ACTIVATE covers all three ASI entry shapes
        // (who_benefits_set=yes / ai_goals=benevolent / post_catch=contained).
        ...OUTCOME_ACTIVATE,
    ],
    // Mirror the internal hideWhen on knowledge_rate / physical_rate /
    // failure_mode: when the AI is loose with hostile goals, those
    // questions don't apply (the world ended in an escape outcome). Without
    // this gate, who_benefits's ai_itself+extractive/indifferent outputs
    // (which uncage the AI by clearing escape_set) would pass the
    // module-level activateWhen but find no askable internal — leaving
    // routing to fall through to rollout when escape_after_who is the
    // narratively correct next stop.
    hideWhen: [
        { ai_goals: { not: ['marginal', 'benevolent'], required: true }, containment: { not: ['contained'] } },
    ],
    reads: [
        // Activation.
        'capability',
        // OUTCOME_ACTIVATE conditions (post-escape catch path).
        'post_catch',
        // knowledge_rate / physical_rate / failure_mode hideWhen
        // (uncaught bad-escape cut).
        'ai_goals', 'containment',
        // Transitive read: containment.contained edge requires
        // distribution ∈ {concentrated, monopoly}. Listing it here keeps
        // the static-analysis projection in step with runtime — without
        // it, the cartesian projection loses distribution and the
        // containment.contained edge looks unreachable on
        // post_catch=contained paths.
        'distribution',
        // Main-path activation marker + delivery-eligibility marker.
        // failure_mode activates on who_benefits_set=yes when
        // delivery_ask_eligible ≠ 'no'.
        'who_benefits_set', 'delivery_ask_eligible',
        // Module's own completion marker — read by every internal node's
        // hideWhen.
        'rollout_set',
    ],
    writes: ROLLOUT_WRITES,
    nodeIds: ROLLOUT_NODE_IDS,
    completionMarker: 'rollout_set',
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
//   writes = open_source (conditional — stays in sel on paths where
//            downstream decel chain reads it, moved to flavor on others
//            via existing per-edge collapseToFlavor rules), distribution,
//            geo_spread, sovereignty, control_set.
//   internalMarkers = open_source_set. Set into sel by every open_source
//            edge's collapseToFlavor so the node's own hideWhen can fire
//            after a downstream collapse moves `open_source` to flavor
//            mid-walk. Auto-moved to flavor at module exit — not an
//            external contract, so no reader outside the module.
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
    'open_source',
    'distribution',
    'geo_spread',
    'sovereignty',
    'control_set',
];

// Set into sel mid-module by open_source edge collapses so the node's own
// hideWhen survives a downstream move of `open_source` to flavor. Not
// part of the external contract — auto-moved to flavor at module exit
// by attachModuleReducer.
const CONTROL_INTERNAL_MARKERS = ['open_source_set'];

// 5 exit edges across 3 terminal nodes. All set control_set='yes'; no
// `when` gates because the (nodeId, edgeId) pair uniquely identifies the
// exit path.
// Declarative exit table. All exits set control_set='yes'; no `when`
// gates since (nodeId, edgeId) uniquely identifies each exit path.
const CONTROL_EXITS = [
    // open_source=near_parity → distribution=open forced, geo_spread /
    // sovereignty both skipped. Exit here.
    { nodeId: 'distribution', edges: ['open'],          set: { control_set: 'yes' } },
    // geo_spread ∈ {two, several} → sovereignty skipped. Exit here.
    { nodeId: 'geo_spread',   edges: ['two', 'several'], set: { control_set: 'yes' } },
    // geo_spread=one → sovereignty answered. Exit here.
    { nodeId: 'sovereignty',  edges: ['lab', 'state'],   set: { control_set: 'yes' } },
];

function buildControlExitPlan() {
    return expandExitTable(CONTROL_EXITS);
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
    internalMarkers: CONTROL_INTERNAL_MARKERS,
    nodeIds: CONTROL_NODE_IDS,
    completionMarker: 'control_set',
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
    // Leaked-weights exits clear `escape_set` + `ai_goals` (per-tuple
    // `move`) and reset `post_catch='loose'` so ESCAPE_MODULE re-fires
    // at the next slot (escape_early_alt) for a second catch pipeline,
    // with `ai_goals` askable again. Listing them here ensures the
    // static-analysis projection captures the deletion / override —
    // without it, _writeDimsForSlot for the module wouldn't include
    // them, and reachableFullSelsFromInputs would silently preserve
    // the upstream values. Same pattern as containment / post_catch in
    // WHO_BENEFITS_WRITES.
    'escape_set',
    'post_catch',
    // ai_goals is normally owned by ESCAPE_MODULE, but leak-reentry
    // tuples (proliferation_control.none, proliferation_outcome.
    // leaks_public, proliferation_alignment.breaks — all when alignment
    // ≠robust) move it to flavor so the user re-picks on the next
    // ESCAPE pass. Same cross-module-write pattern as escape_set /
    // post_catch above.
    'ai_goals',
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
    // PROLIFERATION overrides distribution='open' on every leaks_public-
    // equivalent exit (proliferation_control.none, proliferation_outcome.
    // leaks_public, proliferation_alignment.{holds,breaks}). Open weights
    // ≡ open distribution; collapsing the two captures the narrative
    // invariant declaratively so downstream gates can rely on a single
    // dim instead of (distribution, proliferation_outcome) pairs. Not set
    // on leaks_rivals (bilateral leak — distribution stays as picked).
    'distribution',
];

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
    // Three "leak shapes" for the exit set bundle:
    //   * LEAKED            — bilateral leak to specific rivals. Tech is
    //     spread across multiple states but distribution among labs stays
    //     as the user picked it (typically concentrated/monopoly).
    //   * LEAKED_OPEN       — open-weights leak. The "open" semantic now
    //     overrides whatever the user picked for distribution: leaked
    //     weights ≡ open distribution. alignment held under the leak.
    //   * LEAKED_OPEN_UNROBUST — open-weights leak with alignment broken.
    //     Adds the alignment/containment flip on top of LEAKED_OPEN.
    const LEAKED       = { proliferation_set: 'yes', geo_spread: 'multiple' };
    const LEAKED_OPEN  = { ...LEAKED, distribution: 'open' };
    // LEAKED_OPEN_UNROBUST also flips containment back to escaped — and
    // since the loose copies of the AI inherit the same hostile goals,
    // this re-activates ESCAPE_MODULE downstream so the user gets to
    // walk the catch pipeline again. To make ESCAPE re-fire, we must
    // clear escape_set (the module's completion marker) via per-tuple
    // `move`, and reset post_catch=loose so any prior catch state from
    // an earlier ESCAPE pass doesn't bleed into the next slot's outcome
    // matching. The `move: ['escape_set']` augments attachModuleReducer's
    // auto-move list (escape_set is owned by ESCAPE_MODULE, not in
    // PROLIFERATION's nodeIds, so it wouldn't be in the auto-list).
    const LEAKED_OPEN_UNROBUST = {
        ...LEAKED_OPEN,
        alignment: 'failed',
        containment: 'escaped',
        post_catch: 'loose',
    };
    // Also evict `ai_goals`: leaked weights mean copies of the AI are now in
    // the wild and may evolve different objectives (or the user simply
    // gets a fresh choice on the second escape pass). Without this, paths
    // that took the early-exit at `ai_goals.{marginal,benevolent}` arrive
    // at escape_early_alt with `ai_goals` already pinned and `escape_set`
    // cleared — ESCAPE_MODULE's DFS skips the answered `ai_goals` node,
    // finds no other internal askable, and the module is stuck pending
    // (the "module gate vs internals" warning). Moving `ai_goals` lets
    // the user re-pick: same value re-takes the early-exit (sets
    // escape_set='yes', module done); a hostile pick walks the full
    // catch pipeline.
    const LEAK_REENTRY_MOVE = ['escape_set', 'ai_goals'];
    const HOLDS = { proliferation_set: 'yes' };

    // proliferation_control.none: always a leaked-weights world with
    // alignment≠robust (if alignment=robust, proliferation_outcome derives
    // to leaks_public and proliferation_alignment activates — the module
    // doesn't exit here). So always carries the full alignment override
    // and the open-distribution override.
    //
    // The `proliferation_set: false` gate makes this block fire EXACTLY
    // ONCE — on the push that first sets proliferation_control=none.
    // After the block runs, `proliferation_set='yes'` is in sel and the
    // gate fails on every subsequent push's cleanSelection (which still
    // iterates over all set nodes' edges, including this one). Without
    // the gate, LEAK_REENTRY_MOVE (= [escape_set, ai_goals]) would re-
    // evict the user's re-walked ESCAPE outcome on every later push:
    // ai_goals.marginal's exit-plan SETs escape_set='yes', and the next
    // push would fire this block again and move both away. The gate
    // ensures both runtime and static analysis agree: fire once, evict
    // the stale pre-leak ESCAPE state, then leave the re-walked ESCAPE
    // outcome alone.
    plan.push({
        nodeId: 'proliferation_control',
        edgeId: 'none',
        when: { alignment: { not: ['robust'] }, proliferation_set: false },
        set: LEAKED_OPEN_UNROBUST,
        move: LEAK_REENTRY_MOVE,
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
                // (i.e. alignment≠robust). alignment/containment flip,
                // distribution flips to open.
                //
                // `proliferation_set: false` gate fires the block once on
                // initial push — see proliferation_control.none above for
                // the full rationale. Without the gate, LEAK_REENTRY_MOVE
                // would re-fire on every subsequent push (cleanSelection
                // re-iterates over all set nodes' edges) and erase the
                // user's re-walked ESCAPE outcome.
                plan.push({
                    nodeId: 'proliferation_outcome', edgeId: e.id,
                    when: { alignment: { not: ['robust'] }, proliferation_set: false },
                    set: LEAKED_OPEN_UNROBUST,
                    move: LEAK_REENTRY_MOVE,
                });
                // secure_access becomes invalid the moment distribution
                // flips to open (per its own disabledWhen). All
                // leaks_public paths flip distribution to open eventually
                // — here on alignment≠robust, downstream at
                // proliferation_alignment on alignment=robust. Evict
                // proliferation_control=secure_access here so the
                // post-push sel doesn't carry a stale {distribution=open,
                // proliferation_control=secure_access} pair. Under the
                // old multi-pass cleanSelection an invalidation sweep
                // would have caught this; the explicit move keeps runtime
                // and static analysis aligned without that machinery.
                plan.push({
                    nodeId: 'proliferation_outcome', edgeId: e.id,
                    when: { proliferation_control: ['secure_access'] },
                    move: ['proliferation_control'],
                });
            } else {
                // leaks_rivals: bilateral leak — distribution stays
                // concentrated/monopoly among labs, but tech is now in
                // multiple states' hands. proliferation_alignment never
                // activates (needs leaks_public). Old derives didn't flip
                // alignment on leaks_rivals either.
                plan.push({
                    nodeId: 'proliferation_outcome', edgeId: e.id,
                    when: {}, set: LEAKED,
                });
            }
        }
    }
    // proliferation_alignment terminal edges — only reached on a
    // leaks_public path, so distribution=open in both branches. 'breaks'
    // flips alignment/containment (replaces the old
    // proliferation_alignment=breaks deriveWhen); 'holds' keeps the
    // pre-existing alignment (geo_spread + distribution override only).
    // 'breaks' is a re-entry trigger (containment flips to escaped) —
    // clear escape_set so ESCAPE re-fires. 'holds' isn't (containment
    // stays as it was), no re-entry needed.
    //
    // 'breaks' carries `proliferation_set: false` so LEAK_REENTRY_MOVE
    // fires once on the originating push, not again on subsequent pushes
    // (which re-iterate over all set nodes' edges) — see
    // proliferation_control.none above for the full rationale. 'holds'
    // is left ungated: its set bundle is fully idempotent and contains
    // no moves, so re-firing on later pushes is harmless.
    const alignNode = NODE_MAP.proliferation_alignment;
    if (alignNode && alignNode.edges) {
        for (const e of alignNode.edges) {
            const isBreaks = e.id === 'breaks';
            const set = isBreaks ? LEAKED_OPEN_UNROBUST : LEAKED_OPEN;
            plan.push({
                nodeId: 'proliferation_alignment',
                edgeId: e.id,
                when: isBreaks ? { proliferation_set: false } : {},
                set,
                move: isBreaks ? LEAK_REENTRY_MOVE : undefined,
            });
        }
    }
    return plan;
}

const PROLIFERATION_MODULE = {
    id: 'proliferation',
    // Module-level gate enforces upstream ordering:
    //   * alignment must be decided first (`alignment_set='yes'`).
    //   * ai_goals, if it was going to be set, must not be `benevolent`
    //     — benevolent paths short-circuit past the entire rivalry
    //     pipeline (proliferation / intent / war) and route directly
    //     from escape_early to who_benefits via the FLOW_DAG bypass
    //     edge. Without this guard, priority routing would steal those
    //     sels into proliferation, where the post-proliferation
    //     downstream (escape_early_alt, intent) rejects benevolent
    //     ai_goals and they dead-end. `{ not: ['benevolent'] }` allows
    //     `ai_goals=null` (contained / pre-escape paths), so this only
    //     filters the explicit benevolent escape branch.
    // The meaningfulness question — "is proliferation_control worth
    // asking on this path?" — is handled inside proliferation_control
    // itself, which gates only on `capability: ['asi']` and uses
    // edge-level disabledWhen to constrain the answer space (see
    // proliferation_control above). Precedence against sibling
    // modules (decel / escape) is handled by FLOW_DAG topology
    // (FlowPropagation.flowNext picks the first slot that owns the
    // sel), separate from this gate.
    activateWhen: [
        { capability: ['asi'], alignment_set: ['yes'], ai_goals: { not: ['benevolent'] } },
    ],
    reads: [
        // Activation gate
        'capability', 'alignment_set', 'ai_goals',
        // Internal activateWhen on proliferation_control / proliferation_alignment
        'alignment',
        // proliferation_control.edges[deny_rivals|secure_access].disabledWhen
        // reads distribution.
        'distribution',
    ],
    writes: PROLIFERATION_WRITES,
    nodeIds: PROLIFERATION_NODE_IDS,
    completionMarker: 'proliferation_set',
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
// Declarative exit table. Each row expands to one tuple per edge-id.
// All rows use `when: {}` — the (nodeId, edgeId) pair alone identifies
// the exit. `set.capability` is the module's post-exit rewrite (which
// also serves as the completion marker — see EMERGENCE_MODULE).
const EMERGENCE_EXITS = [
    // Plateau exit (stalls path, stall_recovery = long/permanent)
    { nodeId: 'stall_recovery',      edges: ['substantial', 'never'],        set: { capability: 'plateau' } },
    // AGI-only exit (asi=never, recovery not mild)
    { nodeId: 'automation_recovery', edges: ['substantial', 'never'],        set: { capability: 'agi' } },
    // ASI via fast/explosive takeoff — governance skipped, direct exit
    { nodeId: 'takeoff',             edges: ['fast', 'explosive'],           set: { capability: 'asi' } },
    // ASI via normal takeoff — governance answered
    { nodeId: 'governance_window',   edges: ['governed', 'partial', 'race'], set: { capability: 'asi' } },
];

function buildEmergenceExitPlan() {
    return expandExitTable(EMERGENCE_EXITS);
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
    //
    // NOTE: `stalls` is NOT in the allowed set — it's the user's raw
    // pick on the capability node, not a terminal state. Including it
    // made _dynamicCellEnumerate bail out at capability='stalls' and
    // emit a dead-end cell whose writes don't activate any downstream
    // slot (plateau_benefit_distribution gates on capability='plateau',
    // which the exitPlan's stall_recovery.{substantial,never} tuples
    // actually produce). Keep this list aligned with EMERGENCE_EXITS.
    completionMarker: { dim: 'capability', values: ['plateau', 'agi', 'asi'] },
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
    // block_entrants activates (distribution ≠ open). Exit here when that
    // fails. distribution=open subsumes the old alignment≠{robust,brittle}
    // clause: at intent_loop entry, alignment=failed implies distribution
    // =open (PROLIFERATION's exit plan flips both together on every
    // leaks_public-equivalent path), so this single tuple covers both.
    for (const edgeId of ['self_interest', 'international']) {
        plan.push({
            nodeId: 'intent', edgeId,
            when: { distribution: ['open'] },
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
    // Intent is about rival-power dynamics. Only fires when proliferation
    // actually ran (proliferation_set='yes' means the proliferation module
    // walked to completion — which itself gates on alignment!=failed), and
    // the AI isn't benevolent (benevolent short-circuits past rival
    // dynamics straight to who_benefits; see the flow DAG in nodes.js).
    // The no-rivals paths it now skips — which previously matched via the
    // old clauses — all route to who_benefits instead:
    //   * alignment=failed+containment=contained (AI broke, no escape)
    //   * alignment=failed → escape → catch_outcome=contained (AI caught)
    //   * ai_goals=marginal (inert AI via escape short-circuit)
    //   * ai_goals=benevolent (benevolent AI short-circuit)
    activateWhen: [
        {
            capability: ['asi'],
            proliferation_set: ['yes'],
            ai_goals: { not: ['benevolent'] },
        },
    ],
    reads: [
        // Activation gate (module + intent.activateWhen + intent.hideWhen +
        // rival_dynamics.hideWhen). ai_goals carries the
        // hostile/marginal/benevolent signal; containment is now a separate
        // axis on intent/rival_dynamics hideWhen because hostile-AI-then-
        // caught paths (ai_goals=hostile + containment=contained) flow
        // through normal rival dynamics — the controlling powers are
        // humans again. Without `containment` in reads the projection
        // drops it to UNSET and the hide fires unconditionally on hostile
        // ai_goals, dead-ending caught-AI paths in the module gate.
        'capability', 'proliferation_set', 'ai_goals', 'containment',
        // intent.edges.requires + block_entrants.activateWhen
        // (distribution≠open) + exit-plan early-exit `when`. distribution
        // is the single "is the tech still bottled up?" signal —
        // PROLIFERATION flips it to 'open' on every leaks_public-equivalent
        // path, which subsumes the old (proliferation_control,
        // proliferation_outcome, alignment) trio of guards.
        'distribution', 'geo_spread', 'sovereignty',
    ],
    writes: INTENT_WRITES,
    nodeIds: INTENT_NODE_IDS,
    completionMarker: 'intent_set',
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
    // Destruction-by-war (conflict_result='destruction') pre-sets
    // who_benefits_set='yes' so the slot picker skips WHO_BENEFITS_MODULE
    // — asking economic-control questions about a destroyed world adds
    // narrative noise. The marginal-AI tail still fires via inert_stays
    // (its existing who_benefits_set activateWhen), and the-ruin matches
    // at inert_stays (inert_stays.earlyExits = ['the-ruin']). Hostile-AI
    // destruction paths siphon escape outcomes upstream at escape_late.
    'who_benefits_set',
];

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
    // Peaceful WAR exits override intent. Replaces the former
    // intent.deriveWhen rules; WAR is the rightful writer of
    // escalation_outcome / post_war_aims, so it owns the override.
    //
    // Intent mapping (informs which outcome template matches):
    //   escalation_outcome=agreement  → intent='international'
    //     (forced deterrence treaty → the-flourishing "Global Compact")
    //   post_war_aims=human_centered  → intent='coexistence'
    //     (post-victory rebuild → the-mosaic's reconciliation framing)
    const INTENT_OVERRIDE = {
        escalation_outcome: { agreement: 'international' },
        post_war_aims: { human_centered: 'coexistence' },
    };
    const buildSet = (nodeId, edgeId) => {
        const set = { war_set: 'yes' };
        const mapping = INTENT_OVERRIDE[nodeId];
        if (mapping && mapping[edgeId]) {
            set.intent = mapping[edgeId];
        }
        // war_survivors edges only fire on the destruction tail
        // (conflict_result='destruction' gates war_survivors.activateWhen).
        // Pre-setting who_benefits_set='yes' here makes the slot picker
        // skip WHO_BENEFITS_MODULE on destruction — the war IS the
        // outcome, so asking about post-war economic distribution would
        // be narrative noise. inert_stays still fires off this marker
        // for the marginal-AI tail; the-ruin matches at inert_stays.
        if (nodeId === 'war_survivors') {
            set.who_benefits_set = 'yes';
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
    // Module-internal contiguity is enforced by FLOW_DAG navigation
    // (FlowPropagation.flowNext): once war owns the sel, only war
    // internals are surfaced until war_set fires.
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

// Exit edges:
//   * alignment.robust — direct exit. (gov_action.decelerate is
//     disabledWhen alignment=robust, so even if its gates match the
//     only available edge is `accelerate` — no real decision left.)
//   * alignment.{brittle, failed} — no exit (defer to the next
//     internal node).
//   * alignment_durability.breaks — direct exit. The edge itself
//     pre-writes containment='escaped' and gov_action='accelerate', so
//     gov_action has nothing left to ask (its hideWhen on
//     containment='escaped' would skip it anyway).
//   * alignment_durability.holds — CONDITIONAL exit: only when
//     gov_action's activation gates wouldn't fire. Otherwise defer to
//     gov_action so the decelerate-vs-accelerate decision is asked.
//   * containment.escaped — direct exit (gov_action.hideWhen=escaped).
//   * containment.contained — CONDITIONAL exit, same as durability.holds:
//     defer to gov_action when its gates fire, otherwise direct exit.
//   * gov_action.{decelerate, accelerate} — direct exits (catch the
//     deferred holds/contained paths above).
// All set `alignment_set: 'yes'`.
//
// gov_action.activateWhen reduces (within ASI) to:
//   (geo_spread='one' AND sov='state') OR (geo_spread='one' AND dist='monopoly').
// Its negation, expressed as two conjunctive `when` tuples:
//   1. geo_spread != 'one'                                                (covers multiple)
//   2. geo_spread = 'one' AND sov != 'state' AND dist != 'monopoly'        (covers dist=open
//      with sov UNSET, and dist=concentrated + sov=lab — `{not:[v]}`
//      passes for UNSET dims by engine convention)
function buildAlignmentExitPlan() {
    const plan = [];
    const set = { alignment_set: 'yes' };
    const tuple = (nodeId, edgeId, when = {}) => plan.push({ nodeId, edgeId, when, set });
    // Conditional fallback: exit only when gov_action's gates wouldn't fire.
    const govInert = (nodeId, edgeId) => {
        tuple(nodeId, edgeId, { geo_spread: { not: ['one'] } });
        tuple(nodeId, edgeId, {
            geo_spread: ['one'],
            sovereignty: { not: ['state'] },
            distribution: { not: ['monopoly'] },
        });
    };
    tuple('alignment', 'robust');
    tuple('alignment_durability', 'breaks');
    govInert('alignment_durability', 'holds');
    tuple('containment', 'escaped');
    govInert('containment', 'contained');
    const govAction = NODE_MAP.gov_action;
    if (govAction && govAction.edges) for (const e of govAction.edges) tuple('gov_action', e.id);
    return plan;
}

const ALIGNMENT_MODULE = {
    id: 'alignment_loop',
    // Gate: `capability='asi'` (alignment node's own activateWhen) AND
    // `control_set='yes'` (control has fully committed).
    //
    // The `control_set` gate is defensive: without it, alignment_loop
    // and control both become pending the instant emergence writes
    // capability='asi', and only NODES-array order of their first
    // internal nodes (open_source at L325 beats alignment at L404)
    // keeps control firing first. That tie-break is correct today
    // but silently brittle — if alignment_loop ever ran first, the
    // module could exit via an alignment.robust / alignment_durability
    // / containment tuple before gov_action got a chance to fire
    // (gov_action.activateWhen reads geo_spread/sovereignty/distribution,
    // all control-owned), and gov_action would be silently skipped on
    // a path where it should run. Gating the module explicitly makes
    // the precedence part of the contract, not an emergent property
    // of node ordering.
    activateWhen: [
        { capability: ['asi'], control_set: ['yes'] },
    ],
    reads: [
        // activation / gov_action gating
        'capability',
        'control_set',
        'geo_spread', 'sovereignty', 'distribution',
        // gov_action edge collapseToFlavor moves (pre-existing)
        'takeoff_class',
    ],
    writes: ALIGNMENT_WRITES,
    nodeIds: ALIGNMENT_NODE_IDS,
    completionMarker: 'alignment_set',
    get exitPlan() { return buildAlignmentExitPlan(); },
};

const MODULES = [DECEL_MODULE, ESCAPE_MODULE, WHO_BENEFITS_MODULE, EARLY_ROLLOUT_MODULE, ROLLOUT_MODULE, EMERGENCE_MODULE, CONTROL_MODULE, PROLIFERATION_MODULE, INTENT_MODULE, WAR_MODULE, ALIGNMENT_MODULE];
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
