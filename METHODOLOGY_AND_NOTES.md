<!--
Write the public Methodology & Notes page content here.
This file is rendered at #/methodology-and-notes.
-->

# Graph Structure

Questions are structured under the hood as a series of modules:

<div data-methodology-module="flow-dag"></div>

The question tree is defined as a dynamically-unfolding DAG over state, both within and outside of modules. As you answer questions, you are modifying a state vector. What questions can appear and in what order is a function of that state vector. In this way the DAG is constructed "backwards" by evaluating question eligibility at each state, instead of forwards (enumerating the forward possibilities from each state seemed harder to get narratively correct). Once in a module, that module is completed before matching outcomes or next potential modules.

Graph validity is checked with a verifier that ensures that all paths lead to a valid outcome, and do not dead-end (a risk with the "backwards" question & module eligibility approach). This is made tractable by constructing tables within modules, and de-duplicating state between modules. I'm hopeful this has been sufficient in eliminating dead-ends.

## Emergence Module

If I took more time for this project, it would have been great to spend more time on the emergence / capabilities section. Ultimately for this project, I wanted the user to get a place where they output one of { powerful tool, agi, asi }, but I suspect in reality the path to asi could be slightly messier, and it is interesting to ask, will current tools recursively self improve to remove hurdles, or are genuine breakthroughs needed? As if genuine breakthroughs are needed, we still may see a plateau period before further acceleration.

I suspect with all of the capital being poured into the AI space this would be a short plateau if any, but it still would give more time for work on alignment and social readiness, which would be helpful. Again, I'm not expecting it, but would be nice to know if it was the case.

Some capabilities that could be interesting to explore are:

| Capability | Current models capable? |
| --- | --- |
| Do anything in distribution | ✅ established |
| Long term memory retrieval | ✅ established |
| Achieve out of distribution through slow RL (many samples, like RLHF) | ✅ established |
| Achieve out of distribution through fast RL (few samples, like humans) | ❌ not yet |
| Long task execution (horizon) | 🟡 emerging |
| Fine motor skills | 🟡 emerging |
| Consistent causal / dynamical understanding | 🔬 early research |
| Model-based planning (world models) | 🔬 early research |
| Calibrated uncertainty | 🔬 early research |
| Continuous learning | 🔬 early research |

I suspect that not all of these are needed to unlock the recursive improvements such that we reach an AI that can solve all of them with low effort, but could be interesting to understand how different people understand that (I personally would have thought until recently that fast RL would be needed to approach stronger intelligence, but no longer think that after seeing how models have recently progressed, for example).

## Geopolitical complexities

How the world exactly reacts to ASI is not something I claim this game precisely does (nor do I think any simple model like this can do), though I do think it can help expose some of the key levers for it.

Outside of the contents presented here, there are many other factors which I suspect will be influential. Particularly, regional politics and conflicts, related to on-the-ground realities of markets, politics, and environmental factors. This is how I suspect the geopolitical reality of ASI will unfold (assuming it is kept aligned and contained), and is something we can each have an impact on.

By default, I suspect decision making to lean on our historical set of political and economic narratives. These are already, at least in my opinion, becoming outdated as the world changes. These should be avoided, as they will increasingly not reflect the reality we will find ourselves in; in the same way a medieval lord might have tried to reason about industrialization. Sticking to our values while leaning on the vastly more powerful intelligences we will have available seems a more reliable approach in this new world.

## How ASI unfolds

If we make it through the rollout of ASI, I think we will see a great transformation of humanity, beyond just material or intellectual change. The closest I can envision to it is the world set out in the Culture novels; though I could imagine us wanting to preserve more collective agency depending on how much ASI is able to deduce about our reality and what kinds of lives we want to live.

The key thing I think today is whether we can make it through this period of potentially great change, and whether we can do so in a way that leads to a world we want to live in. I'm hopeful about this, but we certainly have a big challenge ahead of us, to avoid all of the potential pitfalls of realizing superintelligence.

# Probability Analysis

A really interesting use case for this map could be to chart out the likelihoods of different paths and outcomes. I haven't added a full mode for this yet, but could be a useful follow up.

<!--
but wanted to share my most likely paths and reasoning for them here:

## Emergence:

My current reasoning for this module is:
- 80% that systems keep doubling task-length capability as is
- 20% that they hit some stumbling block.

80%, since I suspect that even just through RLHF, labs can keep patching holes that come up in capabilities, to achieve longer and longer task lengths.

20% that there is some hole here.

I think what happens here will depend on how large the capability gaps grow as task length increases -- as long as it doesn't increase substantially with task length, then the labs should be able to continue increasing task length without issue. I suspect that this is likely the case. However, there is always the chance that capability gaps grow much faster as task length increases, or that there is some fundamental capability missing that prevents agents from solving very long tasks (like continual learning, or being able to leverage world models, etc).

This is getting me to the 80% continues to scale, 20% not.

In the 20% not case, I think that given how much capital has been poured into the space, it is 80% likely that a breakthrough comes relatively soon, on whatever the isuse is. This restores the path to ASI pretty quickly.

I think that once an AI can do tasks on the order of several days, it is likely to be at the same level as humans, and on the order of several months, almost certainly at the same level or above humans. By this point I also suspect recursive R&D to be quite practical. However there could always be some reason tasks are solvable at this length while ASI is not achieved. We can put this at a conservative 5% as a possibility.

In some, I come out of the emergence module with:
* a ~91% chance that we see a takeoff to ASI within the next 1-2 years
* a ~9% chance that we see some kind of multi-year stall.

## Rest of the flow

From here, it gets quite messy, and I feel like I would need a tool assist to quantify likelihoods

-->
