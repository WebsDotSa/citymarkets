import { describe, it, expect } from 'vitest';
import { haversineKm } from '@/lib/delivery';

describe('haversineKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineKm(24.7136, 46.6753, 24.7136, 46.6753)).toBe(0);
  });

  it('matches a known reference (Riyadh → Jeddah ≈ 838 km)', () => {
    // Riyadh: 24.7136, 46.6753
    // Jeddah:  21.4858, 39.1925
    // Reference: ~838 km (great-circle)
    const d = haversineKm(24.7136, 46.6753, 21.4858, 39.1925);
    expect(d).toBeGreaterThan(820);
    expect(d).toBeLessThan(860);
  });

  it('is symmetric — order of points does not matter', () => {
    const a = haversineKm(24.7, 46.7, 21.5, 39.2);
    const b = haversineKm(21.5, 39.2, 24.7, 46.7);
    expect(a).toBeCloseTo(b, 6);
  });

  it('handles the antimeridian without exploding', () => {
    // Two points straddling the date line
    const d = haversineKm(0, 179.9, 0, -179.9);
    expect(d).toBeLessThan(50); // tiny distance, well under 1° of longitude
  });
});
