// Stat spend → next-attempt scaling (#12): melee damage scaling off
// dexterity, and max HP/stamina scaling off vitality — headless, pure
// functions, no Phaser (mirrors sorcery.test.ts's derived-stat style).

import { describe, expect, it } from 'vitest';
import {
  ATTACK_DAMAGE,
  BASE_MAX_HP,
  BASE_MAX_STAMINA,
  DEX_SOFT_CAP,
  VIT_SOFT_CAP,
  maxHp,
  maxStamina,
  meleeDamage,
} from './frameData';

describe('meleeDamage (dexterity scaling, §6)', () => {
  it('a higher-dex build swings harder', () => {
    expect(meleeDamage('light', 45)).toBeGreaterThan(meleeDamage('light', 10));
    expect(meleeDamage('heavy', 45)).toBeGreaterThan(meleeDamage('heavy', 10));
  });

  it('at dexterity 0, damage is the flat base', () => {
    expect(meleeDamage('light', 0)).toBeCloseTo(ATTACK_DAMAGE.light.hp);
    expect(meleeDamage('heavy', 0)).toBeCloseTo(ATTACK_DAMAGE.heavy.hp);
  });

  it('growth softens past the soft cap', () => {
    const belowCapGain =
      meleeDamage('light', DEX_SOFT_CAP) - meleeDamage('light', DEX_SOFT_CAP / 2);
    const aboveCapGain =
      meleeDamage('light', DEX_SOFT_CAP * 1.5) - meleeDamage('light', DEX_SOFT_CAP);
    expect(aboveCapGain).toBeLessThan(belowCapGain);
  });
});

describe('maxHp (vitality scaling, §6)', () => {
  it('grows linearly at +6/pt below the soft cap', () => {
    expect(maxHp(0)).toBe(BASE_MAX_HP);
    expect(maxHp(10)).toBeCloseTo(BASE_MAX_HP + 60);
    expect(maxHp(VIT_SOFT_CAP)).toBeCloseTo(BASE_MAX_HP + 6 * VIT_SOFT_CAP);
  });

  it('softens growth above the soft cap', () => {
    const belowCapGain = maxHp(VIT_SOFT_CAP) - maxHp(VIT_SOFT_CAP / 2);
    const aboveCapGain = maxHp(VIT_SOFT_CAP * 1.5) - maxHp(VIT_SOFT_CAP);
    expect(aboveCapGain).toBeLessThan(belowCapGain);
  });
});

describe('maxStamina (vitality scaling, §6)', () => {
  it('grows linearly at +2/pt below the soft cap', () => {
    expect(maxStamina(0)).toBe(BASE_MAX_STAMINA);
    expect(maxStamina(10)).toBeCloseTo(BASE_MAX_STAMINA + 20);
    expect(maxStamina(VIT_SOFT_CAP)).toBeCloseTo(BASE_MAX_STAMINA + 2 * VIT_SOFT_CAP);
  });

  it('a tankier build has more max HP and stamina than a fresh one', () => {
    expect(maxHp(30)).toBeGreaterThan(maxHp(10));
    expect(maxStamina(30)).toBeGreaterThan(maxStamina(10));
  });
});
