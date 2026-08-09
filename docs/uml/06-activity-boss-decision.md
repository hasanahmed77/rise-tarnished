# Activity Diagram — Boss L2→L3 Decision Process (one tick)

> Traced to: `src/game/boss/bossCombat.ts` (`step`), `src/game/boss/tactics.ts`
> (`tickTactic`), `src/game/boss/actionSelection.ts` (`selectTopLevel`,
> `selectComboBranch`), `docs/design/BOSS_AI.md` §3–§4.

Chosen because this is explicitly the named criterion — "whose workflow or
decision-making process is best understood through an activity diagram."
Nothing else in the system comes close on decision density: a trigger-
priority check, a rate-limit guard, a hold-timer gate, a softmax-weighted
choice among five tactics, a range/cooldown/repeat-history filter over the
move table, a tactic-match filter with a documented fallback rule, a
weighted pick, and a *separate* combo-branch decision tree for follow-up
hits. A sequence diagram shows *who calls whom*; this shows *why the boss
picked what it picked* — the actual subject of the project's pitch.

**Two structural facts drawn from the real control flow, not assumed**
(both re-verified against `bossCombat.ts` before drawing):

1. **L2 (the tactic machine) runs every tick unconditionally** — before
   the stagger/collapsed/idle gates, not inside them. Intent can shift
   mid-swing or while staggered; only *actions* wait for the animation.
2. **`RECOVER` skips L3 entirely.** When the active tactic is `RECOVER`,
   the boss doesn't call move-selection with a biased weighting — it
   calls `approach()` and returns, full stop. This is the exact mechanism
   PR #48 fixed: before that fix, nothing in the system ever gave the
   player a tick where the boss wasn't trying to select *some* move.

**Notation caveat, on the diagram itself, not just here**: standard UML
decision nodes carry mutually-exclusive *boolean* guards. The two weighted
picks below (L2's softmax over tactics; L3's weighted pick over eligible
moves/combo links) are **probabilistic** — nothing about system state alone
determines the branch taken, only a distribution over branches does. Both
are labelled `{probabilistic}` rather than drawn like an ordinary `if`.

```mermaid
flowchart TD
    Start(("●")) --> Decay[Passive per-tick decay:<br/>poise, posture, selection cooldowns]
    Decay --> L2Start

    subgraph L2["L2 — Tactic Machine (tactics.ts) — runs every tick, unconditionally"]
        direction TB
        L2Start{Punishable opening<br/>AND punishCooldown == 0<br/>AND tactic != PUNISH?}
        L2Start -- yes --> SetPunish[Set tactic = PUNISH<br/>reset F5 cooldown]
        L2Start -- no --> HoldCheck{Hold timer<br/>expired?}
        HoldCheck -- no --> KeepTactic[Keep current tactic]
        HoldCheck -- yes --> Softmax["Softmax pick over<br/>NEUTRAL / PRESSURE / BAIT /<br/>REPOSITION / RECOVER<br/>{probabilistic — weights =<br/>BASE_SCORE × behaviorMod}"]
        Softmax --> NewTactic[New tactic + new<br/>2-5s hold duration]
    end

    SetPunish --> Gate1
    KeepTactic --> Gate1
    NewTactic --> Gate1

    Gate1{staggerTicks > 0?}
    Gate1 -- yes --> WaitStagger[Decrement stagger,<br/>no action this tick]
    Gate1 -- no --> Gate2{Posture critical<br/>window open?}
    Gate2 -- yes --> Frozen[Collapsed — frozen,<br/>vulnerable to a critical hit only]
    Gate2 -- no --> Gate3{action == null<br/>boss idle?}

    subgraph L3["L3 — Action Selection (actionSelection.ts)"]
        direction TB
        Gate3 -- no, mid-action --> AdvancePhase[Advance startup→active→<br/>recovery phase timer]
        AdvancePhase --> RecoveryDone{Recovery phase<br/>just finished?}
        RecoveryDone -- no --> EndTick1[end tick]
        RecoveryDone -- yes --> ComboCheck{Last move had a<br/>combo field AND<br/>chainDepth < maxChain?}

        ComboCheck -- yes --> ComboFilter[Filter combo.next links:<br/>range, cooldown, F8,<br/>player-action condition]
        ComboFilter --> ComboPick["Weighted pick over links<br/>+ unclaimed 'end sequence' mass<br/>{probabilistic — authored weights}"]
        ComboPick --> ComboResult{Link picked?}
        ComboResult -- yes --> StartMove1[startMove — continue combo]
        ComboResult -- no --> SeqEnd1[sequence-end,<br/>start F2 gap]

        ComboCheck -- no --> SeqEnd2[sequence-end,<br/>start F2 gap]

        Gate3 -- yes, idle --> RecoverCheck{Current tactic<br/>== RECOVER?}
        RecoverCheck -- yes --> ApproachOnly["approach() only —<br/>L3 skipped entirely (PR #48)"]
        RecoverCheck -- no --> GapCheck{gapTicksRemaining<br/>> 0?}
        GapCheck -- yes --> ApproachOnly2[no-action: approach]
        GapCheck -- no --> EligFilter[Filter top-level table:<br/>range, cooldown, F8]
        EligFilter --> EligEmpty{Eligible<br/>set empty?}
        EligEmpty -- yes --> ApproachOnly3[no-action: approach]
        EligEmpty -- no --> TacticMatch{Any eligible move's<br/>tags include<br/>current tactic?}
        TacticMatch -- yes --> PoolMatched[pool = tactic-matched subset]
        TacticMatch -- no --> PoolFallback["pool = full eligible set<br/>(documented fallback rule —<br/>never stall)"]
        PoolMatched --> WeightedPick["Weighted pick over pool<br/>{probabilistic — weights =<br/>behaviorMod × tacticFilter}"]
        PoolFallback --> WeightedPick
        WeightedPick --> StartMove2[startMove — fresh sequence]
    end

    WaitStagger --> End(("●"))
    Frozen --> End
    EndTick1 --> End
    StartMove1 --> End
    SeqEnd1 --> End
    SeqEnd2 --> End
    ApproachOnly --> End
    ApproachOnly2 --> End
    ApproachOnly3 --> End
    StartMove2 --> End
```
