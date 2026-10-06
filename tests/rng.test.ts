import { describe, it, expect } from 'vitest';
import { RNG, hash2i } from '@ascii-fort/core/RNG';
import { WorldSeed, normalizeSeed } from '@ascii-fort/core/Seed';
import { Noise2D } from '@ascii-fort/core/Noise';

describe('RNG', () => {
  it('même clé → même suite', () => {
    const a = new RNG('x'), b = new RNG('x');
    for (let i = 0; i < 100; i++) expect(a.nextU32()).toBe(b.nextU32());
  });
  it('fork ne dépend pas de la consommation du parent', () => {
    const a = new RNG('k'), b = new RNG('k');
    for (let i = 0; i < 50; i++) b.next();
    expect(a.fork('c').next()).toBe(b.fork('c').next());
  });
  it('les flux de la seed sont indépendants', () => {
    const s = new WorldSeed('TEST-001');
    const t1 = s.stream('settlements').next();
    const m = s.stream('monsters'); for (let i = 0; i < 1000; i++) m.next();
    expect(s.stream('settlements').next()).toBe(t1);
    expect(s.stream('terrain').next()).not.toBe(t1);
  });
  it('hash2i stable', () => {
    expect(hash2i(1, 2, 3)).toBe(hash2i(1, 2, 3));
    expect(hash2i(1, 2, 3)).not.toBe(hash2i(1, 3, 2));
  });
  it('normalisation de seed', () => {
    expect(normalizeSeed('  the ashen kingdom 94721 ')).toBe('THE-ASHEN-KINGDOM-94721');
    expect(normalizeSeed('Été brûlé')).toBe('ETE-BRULE');
  });
  it('bruit déterministe et borné', () => {
    const n1 = new Noise2D(new RNG('n')), n2 = new Noise2D(new RNG('n'));
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37, y = i * -0.71;
      const v = n1.fbm(x, y);
      expect(v).toBe(n2.fbm(x, y));
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });
});
