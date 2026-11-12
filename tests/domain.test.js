const {
  calculateSettlement,
  createInviteCode,
  createChallengeToken,
  evaluateCheckin,
  toShanghaiLocalDate,
  validateContractInput
} = require('../shared/domain');

describe('attendance domain', () => {
  test('calculates settlement amounts with two decimal places', () => {
    expect(calculateSettlement({ totalAmount: 8000, targetDays: 26, days: 0 }).amount).toBe(0);
    expect(calculateSettlement({ totalAmount: 8000, targetDays: 26, days: 14 }).amount).toBe(4307.69);
    expect(calculateSettlement({ totalAmount: 8000, targetDays: 26, days: 26 }).amount).toBe(8000);
    expect(calculateSettlement({ totalAmount: 8000, targetDays: 26, days: 27 }).amount).toBe(8307.69);
    expect(calculateSettlement({ totalAmount: 8000, targetDays: 26, days: 16 }).amount).toBe(4923.08);
  });

  test('uses Asia/Shanghai natural days across UTC date boundaries', () => {
    expect(toShanghaiLocalDate(new Date('2026-11-09T15:59:59.000Z'))).toBe('2026-11-09');
    expect(toShanghaiLocalDate(new Date('2026-11-09T16:00:00.000Z'))).toBe('2026-11-10');
  });

  test('computes Haversine distance and accepts a location inside the fence', () => {
    const result = evaluateCheckin({
      home: { latitude: 31.2304, longitude: 121.4737 },
      location: { latitude: 31.2314, longitude: 121.4747, accuracy: 120 },
      radiusMeters: 300
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.distanceMeters).toBeGreaterThan(120);
    expect(result.distanceMeters).toBeLessThan(180);
  });

  test('rejects a location outside the fence or with poor accuracy', () => {
    const home = { latitude: 31.2304, longitude: 121.4737 };
    expect(evaluateCheckin({
      home,
      location: { latitude: 31.3, longitude: 121.5, accuracy: 100 },
      radiusMeters: 300
    })).toMatchObject({ allowed: false, reason: 'OUT_OF_FENCE' });

    expect(evaluateCheckin({
      home,
      location: { latitude: 31.2304, longitude: 121.4738, accuracy: 501 },
      radiusMeters: 300
    })).toMatchObject({ allowed: false, reason: 'POOR_ACCURACY' });
  });

  test('does not accept missing accuracy or invalid coordinates', () => {
    const home = { latitude: 31.2304, longitude: 121.4737 };
    expect(evaluateCheckin({
      home,
      location: { latitude: 31.2304, longitude: 121.4737 },
      radiusMeters: 300
    })).toMatchObject({ allowed: false, reason: 'POOR_ACCURACY' });

    expect(evaluateCheckin({
      home,
      location: { latitude: 999, longitude: 121.4737, accuracy: 20 },
      radiusMeters: 300
    })).toMatchObject({ allowed: false, reason: 'INVALID_LOCATION' });
  });

  test('generates unambiguous invite codes and challenge tokens', () => {
    const rng = sequenceRng(0.1);
    expect(createInviteCode({ rng })).toBe('DDDDDDDD');
    expect(createInviteCode({ rng })).toHaveLength(8);
    expect(createChallengeToken({ rng })).toHaveLength(32);
  });

  test('validates and normalizes contract input', () => {
    expect(validateContractInput({
      totalAmount: '8000',
      targetDays: '26',
      startDate: '2026-11-11',
      address: '上海市黄浦区',
      latitude: 31.2304,
      longitude: 121.4737,
      radiusMeters: '300'
    })).toEqual({
      totalAmount: 8000,
      targetDays: 26,
      startDate: '2026-11-11',
      homeLocation: {
        address: '上海市黄浦区',
        latitude: 31.2304,
        longitude: 121.4737
      },
      radiusMeters: 300
    });

    expect(() => validateContractInput({
      totalAmount: 0,
      targetDays: 26,
      startDate: '2026-11-11',
      address: 'home',
      latitude: 31,
      longitude: 121,
      radiusMeters: 300
    })).toThrow('INVALID_TOTAL_AMOUNT');
  });
});

function sequenceRng(value) {
  return () => value;
}
