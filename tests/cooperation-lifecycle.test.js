'use strict';

const { MemoryStorage } = require('../shared/storage');
const { MockBackend } = require('../shared/mock-backend');

describe('cooperation lifecycle', () => {
  test('settles through the last checked date and starts the next stage the following day', async () => {
    let now = new Date('2026-11-10T01:00:00.000Z');
    const backend = new MockBackend({ storage: new MemoryStorage(), now: () => now });
    const employer = backend.as('mock-employer');
    const employee = backend.as('mock-employee');
    await employer.call('bootstrapUser', { role: 'employer' });
    await employee.call('bootstrapUser', { role: 'employee' });
    const created = await employer.call('createContract', validContract({ startDate: '2026-11-01' }));
    await employee.call('joinContract', { inviteCode: created.data.inviteCode });

    now = new Date('2026-11-01T01:00:00.000Z');
    await checkIn(employee);
    now = new Date('2026-11-02T01:00:00.000Z');
    await checkIn(employee);

    now = new Date('2026-11-13T01:00:00.000Z');
    const request = await employer.call('createSettlementRequest', {
      paidAmount: 615.38,
      transferProofs: [{ fileId: 'wxfile://transfer.png' }]
    });
    expect(request.data.settlementRequest).toMatchObject({
      workEndLocalDate: '2026-11-02',
      nextStageStartLocalDate: '2026-11-03',
      days: 2,
      averageArrivalTime: '09:00'
    });

    const confirmed = await employee.call('confirmSettlementRequest');
    expect(confirmed.data.settlement).toMatchObject({
      days: 2,
      averageArrivalTime: '09:00'
    });
    expect(confirmed.data.settlement).not.toHaveProperty('settledByEmployerOpenid');
    expect(confirmed.data.settlement).not.toHaveProperty('confirmedByEmployeeOpenid');
    expect(confirmed.data.nextStage).toMatchObject({
      stageIndex: 2,
      startLocalDate: '2026-11-03',
      status: 'open'
    });
  });

  test('allows another settlement after the new stage has a check-in on the settlement day', async () => {
    let now = new Date('2026-11-10T01:00:00.000Z');
    const backend = new MockBackend({ storage: new MemoryStorage(), now: () => now });
    const employer = backend.as('mock-employer');
    const employee = backend.as('mock-employee');
    await employer.call('bootstrapUser', { role: 'employer' });
    await employee.call('bootstrapUser', { role: 'employee' });
    const created = await employer.call('createContract', validContract({ startDate: '2026-11-10' }));
    await employee.call('joinContract', { inviteCode: created.data.inviteCode });
    await checkIn(employee);

    now = new Date('2026-11-11T01:00:00.000Z');
    await settle(employer, employee);
    await checkIn(employee);

    const request = await employer.call('createSettlementRequest', {
      paidAmount: 307.69,
      transferProofs: [{ fileId: 'wxfile://transfer.png' }]
    });
    expect(request.data.settlementRequest).toMatchObject({
      stageIndex: 2,
      workEndLocalDate: '2026-11-11',
      nextStageStartLocalDate: '2026-11-12',
      days: 1
    });
  });

  test('employer can batch backfill unchecked dates within the current stage', async () => {
    let now = new Date('2026-11-13T01:00:00.000Z');
    const backend = new MockBackend({ storage: new MemoryStorage(), now: () => now });
    const employer = backend.as('mock-employer');
    const employee = backend.as('mock-employee');
    await employer.call('bootstrapUser', { role: 'employer' });
    await employee.call('bootstrapUser', { role: 'employee' });
    const created = await employer.call('createContract', validContract({ startDate: '2026-11-01' }));
    await employee.call('joinContract', { inviteCode: created.data.inviteCode });

    now = new Date('2026-11-01T01:10:00.000Z');
    await checkIn(employee);

    now = new Date('2026-11-13T01:00:00.000Z');
    await expect(employee.call('createBackfillCheckins', {
      localDates: ['2026-11-04'],
      workTime: '09:00',
      reason: '前期补录'
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const result = await employer.call('createBackfillCheckins', {
      localDates: ['2026-11-04', '2026-11-05'],
      workTime: '09:00',
      reason: '前期补录'
    });
    expect(result.data.checkins).toHaveLength(2);
    expect(result.data.checkins[0]).toMatchObject({
      localDate: '2026-11-04',
      workTime: '09:00',
      source: 'employer_backfill',
      reason: '前期补录'
    });

    const state = await employee.call('getCurrentState');
    expect(state.data.currentStage).toMatchObject({ days: 3 });
    expect(state.data.backfill).toMatchObject({
      earliestLocalDate: '2026-11-01',
      latestLocalDate: '2026-11-12',
      defaultWorkTime: '09:00',
      defaultReason: '前期补录'
    });
    expect(state.data.backfill.eligibleLocalDates).not.toContain('2026-11-04');
    expect(state.data.backfill.eligibleLocalDates).not.toContain('2026-11-05');
    expect(state.data.currentStage.backfillDays).toBe(2);
    expect(state.data.cumulativeWorkDays).toBe(3);
    expect(state.data.calendarCheckins.find((item) => item.localDate === '2026-11-04')).toMatchObject({
      time: '09:00',
      source: 'employer_backfill'
    });

    await expect(employer.call('createBackfillCheckins', {
      localDates: ['2026-11-13'],
      workTime: '09:00',
      reason: '前期补录'
    })).rejects.toMatchObject({ code: 'BACKFILL_DATE_NOT_BEFORE_TODAY' });

    await expect(employer.call('createBackfillCheckins', {
      localDates: ['2026-10-13'],
      workTime: '09:00',
      reason: '前期补录'
    })).rejects.toMatchObject({ code: 'BACKFILL_DATE_OUT_OF_RANGE' });

    await expect(employer.call('createBackfillCheckins', {
      localDates: ['2026-11-01'],
      workTime: '09:00',
      reason: '前期补录'
    })).rejects.toMatchObject({ code: 'CHECKIN_ALREADY_EXISTS' });
  });

  test('employer terminates an archived contract and both parties can start a new cooperation', async () => {
    let now = new Date('2026-11-10T01:00:00.000Z');
    const backend = new MockBackend({ storage: new MemoryStorage(), now: () => now });
    const employer = backend.as('mock-employer');
    const employee = backend.as('mock-employee');
    await employer.call('bootstrapUser', { role: 'employer' });
    await employee.call('bootstrapUser', { role: 'employee' });
    const created = await employer.call('createContract', validContract({ startDate: '2026-11-10' }));
    await employee.call('joinContract', { inviteCode: created.data.inviteCode });
    await checkIn(employee);

    now = new Date('2026-11-11T01:00:00.000Z');
    await expect(employer.call('terminateContract', { reason: '阿姨下户' }))
      .rejects.toMatchObject({ code: 'SETTLE_BEFORE_TERMINATION' });
    await settle(employer, employee);

    const terminated = await employer.call('terminateContract', { reason: '阿姨下户' });
    expect(terminated.data.contract).toMatchObject({ status: 'ended', endedReason: '阿姨下户' });
    expect(backend.repository.users.find((user) => user.openid === 'mock-employer').activeContractId).toBeNull();
    expect(backend.repository.users.find((user) => user.openid === 'mock-employee').activeContractId).toBeNull();

    const endedState = await employee.call('getCurrentState');
    expect(endedState.data.contract).toBeNull();
    expect(endedState.data.lastCooperation).toMatchObject({
      status: 'ended',
      endedReason: '阿姨下户',
      summary: { settledStages: 1, totalSettledDays: 1 }
    });

    await expect(employee.call('terminateContract', { reason: '阿姨下户' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });

    const history = await employee.call('listHistory');
    expect(history.data.contracts).toHaveLength(1);
    expect(history.data.contracts[0]).toMatchObject({
      summary: { settledStages: 1, totalSettledDays: 1 }
    });

    const nextContract = await employer.call('createContract', validContract({ startDate: '2026-11-20' }));
    await employee.call('joinContract', { inviteCode: nextContract.data.inviteCode });
    const nextHistory = await employer.call('listHistory');
    expect(nextHistory.data.contracts).toHaveLength(2);
    expect(nextHistory.data.contract).toMatchObject({ status: 'active' });
  });
});

async function checkIn(employee) {
  const challenge = await employee.call('createCheckinChallenge');
  return employee.call('submitCheckin', {
    challenge: challenge.data.challenge.token,
    latitude: 31.2304,
    longitude: 121.4737,
    accuracy: 30
  });
}

async function settle(employer, employee) {
  await employer.call('createSettlementRequest', {
    paidAmount: 307.69,
    transferProofs: [{ fileId: 'wxfile://transfer.png' }]
  });
  return employee.call('confirmSettlementRequest');
}

function validContract(overrides = {}) {
  return {
    totalAmount: 8000,
    targetDays: 26,
    startDate: '2026-11-01',
    address: '上海市黄浦区',
    latitude: 31.2304,
    longitude: 121.4737,
    radiusMeters: 300,
    ...overrides
  };
}
