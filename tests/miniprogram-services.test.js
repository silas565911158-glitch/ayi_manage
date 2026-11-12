const fs = require('fs');
const path = require('path');

describe('mini program services', () => {
  test('packages shared backend modules inside miniprogramRoot', () => {
    const files = ['domain.js', 'errors.js', 'backend-core.js', 'memory-repository.js', 'mock-backend.js', 'storage.js'];
    for (const file of files) {
      const canonical = fs.readFileSync(path.join(__dirname, '..', 'shared', file), 'utf8');
      const bundled = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'shared', file), 'utf8');
      expect(bundled).toBe(canonical);
    }
  });

  test('formats trustworthy cycle and money view state', () => {
    const {
      buildCycleViewModel,
      buildSettlementsViewModel,
      formatDisplayDate,
      formatMoney
    } = require('../miniprogram/services/view-state');
    expect(formatMoney(4307.69)).toBe('¥4,307.69');
    expect(formatDisplayDate('2026-11-12T16:01:08.000Z')).toBe('2026-11-13 00:01');
    expect(buildCycleViewModel({
      progress: { checkinDays: 27, targetDays: 26, payableAmount: 8307.69 },
      reminder: { required: true, daysOver: 1 }
    })).toMatchObject({
      dayValue: '27/26',
      payableText: '¥8,307.69',
      reminderText: '已超过目标 1 天，请尽快结算',
      isComplete: true
    });
    expect(buildCycleViewModel(null)).toMatchObject({
      dayValue: '--',
      payableText: '¥0.00',
      reminderText: '',
      isComplete: false
    });
    expect(buildSettlementsViewModel([
      { cycleId: 'contract_x_2', amount: 8000, dailySalary: 307.69, settledAt: '2026-12-07T01:00:00.000Z' },
      { cycleId: 'contract_x_1', amount: 4307.69, dailySalary: 307.69, settledAt: '2026-11-25T01:00:00.000Z' }
    ])).toEqual([
      expect.objectContaining({ cycleIndex: 2, amountText: '¥8,000.00' }),
      expect.objectContaining({ cycleIndex: 1, amountText: '¥4,307.69' })
    ]);
  });

  test('shows the contract daily salary while creating a cooperation', () => {
    const { buildContractPricingViewModel } = require('../miniprogram/services/view-state');
    expect(buildContractPricingViewModel({ totalAmount: '8000', targetDays: '26' })).toEqual({
      dailySalaryText: '每天 ¥307.69',
      pricingFormulaText: '按 8000 元 ÷ 26 天计算'
    });
    expect(buildContractPricingViewModel({ totalAmount: '', targetDays: '26' })).toEqual({
      dailySalaryText: '自动计算日薪',
      pricingFormulaText: '请输入合同总金额和约定天数'
    });
  });

  test('builds a simple calendar for the current unsettled stage', () => {
    const { buildCalendarMonth } = require('../miniprogram/services/calendar-state');
    const month = buildCalendarMonth({
      year: 2026,
      month: 12,
      startLocalDate: '2026-11-22',
      today: '2026-12-11',
      checkinDates: ['2026-12-01', '2026-12-02', '2026-12-08']
    });
    expect(month.title).toBe('2026年12月');
    expect(month.weeks).toHaveLength(5);
    expect(month.legend).toEqual([]);
    const days = month.weeks.flat();
    expect(days.filter((day) => day.date).map((day) => day.day)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
      16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31
    ]);
    month.weeks.forEach((week) => expect(week).toHaveLength(7));
    expect(days.find((day) => day.date === '2026-12-01')).toMatchObject({
      day: 1,
      checkedIn: true,
      markText: '✓',
      withinStage: true,
      future: false,
      today: false
    });
    expect(days.find((day) => day.date === '2026-12-11')).toMatchObject({
      today: true,
      checkedIn: false,
      withinStage: true
    });
    expect(days.find((day) => day.date === '2026-12-12')).toMatchObject({
      future: true,
      withinStage: true
    });
  });

  test('marks settled work dates by background without a current-stage check mark', () => {
    const { buildCalendarMonth } = require('../miniprogram/services/calendar-state');
    const month = buildCalendarMonth({
      year: 2026,
      month: 11,
      startLocalDate: '2026-11-10',
      today: '2026-11-12',
      checkinDates: ['2026-11-11'],
      settledDates: ['2026-11-03', '2026-11-05']
    });
    const days = month.weeks.flat();
    expect(days.find((day) => day.date === '2026-11-03')).toMatchObject({
      settled: true,
      checkedIn: false,
      markText: ''
    });
    expect(days.find((day) => day.date === '2026-11-05')).toMatchObject({
      settled: true,
      checkedIn: false,
      markText: ''
    });
    expect(days.find((day) => day.date === '2026-11-11')).toMatchObject({
      settled: false,
      checkedIn: true,
      markText: '✓'
    });
  });

  test('builds calendar navigation boundaries for a stage that crosses months', () => {
    const { getCalendarNavigation } = require('../miniprogram/services/calendar-state');
    expect(getCalendarNavigation({
      startLocalDate: '2026-10-28',
      todayLocalDate: '2026-11-12',
      year: 2026,
      month: 11
    })).toEqual({ canPrevMonth: true, canNextMonth: false });
    expect(getCalendarNavigation({
      startLocalDate: '2026-10-28',
      todayLocalDate: '2026-11-12',
      year: 2026,
      month: 10
    })).toEqual({ canPrevMonth: false, canNextMonth: true });
    expect(getCalendarNavigation({
      startLocalDate: '2026-12-01',
      todayLocalDate: '2026-11-12',
      year: 2026,
      month: 11
    })).toEqual({ canPrevMonth: false, canNextMonth: true });
  });

  test('explains settlement calculations in plain language', () => {
    const {
      buildSettlementExplanation,
      formatChineseDate,
      formatCompactDateWithYear,
      formatCompactMoney,
      formatShanghaiDateInput,
      formatShanghaiClockTime
    } = require('../miniprogram/services/view-state');

    expect(buildSettlementExplanation({
      totalAmount: 8000,
      targetDays: 26,
      days: 10,
      dailySalary: 307.6923077,
      suggestedAmount: 3076.92,
      paidAmount: 3000
    })).toEqual({
      contractText: '8000 元 ÷ 26 天',
      dailySalaryText: '¥307.69 / 天',
      calculationText: '¥307.69 × 10 天',
      formulaText: '8000 ÷ 26 × 10',
      suggestedText: '¥3,076.92',
      paidText: '¥3,000.00',
      differenceText: '实付少 ¥76.92'
    });

    expect(buildSettlementExplanation({
      days: 10,
      dailySalary: 307.6923077,
      suggestedAmount: 3076.92,
      paidAmount: 3076.92
    })).toEqual({
      contractText: '按日薪计算',
      dailySalaryText: '¥307.69 / 天',
      calculationText: '¥307.69 × 10 天',
      formulaText: '日薪 × 10 天',
      suggestedText: '¥3,076.92',
      paidText: '¥3,076.92',
      differenceText: ''
    });

    expect(formatChineseDate('2026-10-28')).toBe('10.28');
    expect(formatChineseDate('2026-11-10')).toBe('11.10');
    expect(formatCompactDateWithYear('2026-10-28')).toBe('2026.10.28');
    expect(formatCompactDateWithYear('2026-11-10')).toBe('2026.11.10');
    expect(formatCompactMoney(16000)).toBe('¥16,000');
    expect(formatCompactMoney(16000.5)).toBe('¥16,000.50');
    expect(formatShanghaiDateInput(new Date('2026-11-11T15:59:08.000Z'))).toBe('2026-11-11');
    expect(formatShanghaiDateInput(new Date('2026-11-11T16:00:08.000Z'))).toBe('2026-11-12');
    expect(formatShanghaiClockTime('2026-11-12T06:32:08.000Z')).toBe('14:32');
  });

  test('mock client persists roles and normalized failures through wx storage', async () => {
    const { createMockClient } = require('../miniprogram/services/mock-client');
    const wxApi = createWxStorage();
    const client = createMockClient(wxApi);

    client.setMockRole('employer');
    const boot = await client.call('bootstrapUser', { role: 'employer' });
    expect(boot).toMatchObject({ ok: true, data: { user: { role: 'employer' } } });

    const failure = await client.call('settleCycle');
    expect(failure).toMatchObject({ ok: false, code: 'UNKNOWN_ACTION', message: expect.any(String) });

    client.setMockRole('employee');
    const employeeBoot = await client.call('bootstrapUser', { role: 'employee' });
    expect(employeeBoot.data.user.openid).toBe('mock-employee');
    expect(wxApi.getStorageSync('aunt-attendance-current-openid')).toBe('mock-employee');
  });

  test('selects the configured backend adapter and normalizes transport failures', async () => {
    const { createApiClient } = require('../miniprogram/services/api');
    const mockBackend = {
      call: jest.fn().mockResolvedValue({ ok: true, data: { marker: 'mock' } }),
      setMockRole: jest.fn(),
      reset: jest.fn()
    };
    const cloudBackend = {
      call: jest.fn().mockRejectedValue(new Error('network down')),
      setMockRole: jest.fn(),
      reset: jest.fn()
    };
    const factories = {
      mockClientFactory: jest.fn(() => mockBackend),
      cloudClientFactory: jest.fn(() => cloudBackend)
    };
    const wxApi = {};

    const mockClient = createApiClient({ runtime: { mode: 'mock' }, wxApi, ...factories });
    await expect(mockClient.call('getCurrentState')).resolves.toMatchObject({ ok: true, data: { marker: 'mock' } });
    expect(factories.mockClientFactory).toHaveBeenCalledWith(wxApi);

    const cloudClient = createApiClient({ runtime: { mode: 'cloud', cloudEnv: 'test-env' }, wxApi, ...factories });
    await expect(cloudClient.call('getCurrentState')).resolves.toMatchObject({
      ok: false,
      code: 'NETWORK_ERROR',
      message: '网络连接失败，请稍后重试'
    });
    expect(factories.cloudClientFactory).toHaveBeenCalledWith(wxApi, { cloudEnv: 'test-env' });
  });
});

function createWxStorage() {
  const data = new Map();
  return {
    getStorageSync: (key) => (data.has(key) ? data.get(key) : ''),
    setStorageSync: (key, value) => data.set(key, value),
    removeStorageSync: (key) => data.delete(key)
  };
}
