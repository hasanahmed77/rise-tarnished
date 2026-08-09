# Sequence Diagram — Fight the Adaptive Boss (one tick, a light attack connects)

> Drawn by: Member B. Traced to: `src/game/scenes/CombatScene.ts`
> (`update`, `resolvePlayerAttackOnBoss`), `src/game/combat/playerCombat.ts`
> (`step`), `src/game/boss/bossCombat.ts` (`step`, `resolveBossHit`),
> `src/game/boss/tactics.ts` (`tickTactic`),
> `src/game/boss/actionSelection.ts` (`selectTopLevel`),
> `src/game/attempt/outcome.ts` (`determineFightOutcome`).

Scope is deliberately **one representative tick**, not the whole multi-
minute fight — a sequence diagram trying to show "loop 3,600+ times" end to
end would be unreadable and would communicate less than one real tick
does. The 60Hz loop itself is the outer `loop` fragment; it repeats until
`determineFightOutcome` returns non-null (see UC-05 in
`02-use-case-description-fight-the-adaptive-boss.md` for the full
multi-tick use case).

```mermaid
sequenceDiagram
    actor Player
    participant Scene as CombatScene
    participant PC as playerCombat<br/>(pure)
    participant BC as bossCombat<br/>(pure)
    participant Tac as TacticMachine<br/>(tactics.ts)
    participant Sel as ActionSelection<br/>(actionSelection.ts)

    loop every 60Hz tick, until determineFightOutcome() != null
        Player->>Scene: keyboard input this frame
        Scene->>Scene: sampleInput() → CombatInput

        Scene->>PC: step(sim, input, ctx)
        PC-->>Scene: {state, events: [attack:active]}

        alt attack:active event (light attack)
            Scene->>Scene: resolvePlayerAttackOnBoss('light')
            Scene->>Scene: meleeDamage('light', build.dexterity)
            Scene->>BC: resolveBossHit(boss, {hp, poise, postureDamage})
            BC-->>Scene: {state, wasCritical}
            Scene->>Scene: triggerHitstop() / shake() / sfx('hit')
        end

        Scene->>BC: step(boss, bossCtx)
        BC->>Tac: tickTactic(prev, getSignals, ctx)
        Note over Tac: runs unconditionally every tick —<br/>even mid-swing or staggered
        Tac-->>BC: {state, changed}

        alt boss idle (action == null) and tactic != RECOVER
            BC->>Sel: selectTopLevel(table, ids, distance, state, weighting)
            Sel-->>BC: {kind:'move', moveId} or {kind:'no-action'}
        else tactic == RECOVER
            Note over BC: selection skipped —<br/>approach() only
        end
        BC-->>Scene: {state, events}

        Scene->>Scene: determineFightOutcome(boss.hp, sim.hp)
        Scene->>Scene: render() — sprites, HUD, audio
    end

    Scene-->>Player: outcome reached → fight:outcome emitted
```

## Notes

- **Client-authoritative, deterministic sim.** No network round-trip
  happens during the fight itself — `playerCombat.step` and
  `bossCombat.step` are pure functions over local state, which is what
  makes the fixed-timestep loop replayable from a seed.
- **The `RECOVER` branch is drawn explicitly** because it's the one place
  the boss's L3 (move selection) is skipped outright rather than merely
  filtered — the fix behind PR #48's "the boss now gives a smothered
  player real relief" behavior.
- **`meleeDamage` is the §6 stat-scaling formula**, not a flat number —
  `damage = weapon_base × (1 + coeff × softcap(dexterity)) × type_modifier`.
