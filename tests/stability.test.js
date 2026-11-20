'use strict';

const { MemoryStorage } = require('../shared/storage');
const { MockBackend } = require('../shared/mock-backend');
const { MemoryRepository, emptyDatabase } = require('../shared/memory-repository');
const { buildCalendarMonth } = require('../miniprogram/services/calendar-state');
const { buildBackfillBoard } = require('../miniprogram/services/backfill-state');

describe('release stability', () => {
  test('renders Monday-first calendars consistently in current and backfill views', () => {
    const current = buildCalendarMonth({
      year: 2026,
      month: 11,
      checkinRecords: [],
      settledRecords: [],
      todayLocalDate: '2026-11-19',
      stageStartLocalDate: '2026-11-10'
    });
    expect(current.weeks[0][6]).toMatchObject({ date: '2026-11-01', day: 1 });

    const backfill = buildBackfillBoard({
      earliestLocalDate: '2026-11-01',
      latestLocalDate: '2026-11-30',
      eligibleLocalDates: ['2026-11-01']
    });
    expect(backfill.boards[0].weeks[0][6]).toMatchObject({ date: '2026-11-01', day: 1 });
  });

  test('keeps settled dates unavailable when a later stage is backfilled', async () => {
    let now = fixedDate('2026-11-01');
    const backend = new MockBackend({ storage: new MemoryStorage(), now: () => now });
    const employer = backend.as('mock-employer');
    const employee = backend.as('mock-employee');
    await employer.call('bootstrapUser', { role: 'employer' });
    await employee.call('bootstrapUser', { role: 'employee' });
    const created = await employer.call('createContract', validContract({ startDate: '2026-11-01' }));
    await employee.call('joinContract', { inviteCode: created.data.inviteCode });
    await checkIn(employee);
    now = fixedDate('2026-11-02');
    await checkIn(employee);
    now = fixedDate('2026-11-11');
    await settle(employer, employee, 615.38);

    const state = await employer.call('getCurrentState');
    expect(state.data.currentStage).toMatchObject({ stageIndex: 2, startLocalDate: '2026-11-03' });
    ['2026-11-01', '2026-11-02'].forEach((date) => {
      expect(state.data.backfill.eligibleLocalDates).not.toContain(date);
    });
    expect(state.data.backfill.eligibleLocalDates).not.toContain('2026-10-30');

  });

  test('does not let a future contract become check-in enabled by an earlier backfill', async () => {
    let now = fixedDate('2026-11-19');
    const backend = new MockBackend({ storage: new MemoryStorage(), now: () => now });
    const employer = backend.as('mock-employer');
    const employee = backend.as('mock-employee');
    await employer.call('bootstrapUser', { role: 'employer' });
    await employee.call('bootstrapUser', { role: 'employee' });
    const created = await employer.call('createContract', validContract({ startDate: '2026-12-01' }));
    await employee.call('joinContract', { inviteCode: created.data.inviteCode });
    await employer.call('createBackfillCheckins', {
      localDates: ['2026-11-10'],
      workTime: '09:00',
      reason: '前期补录'
    });

    const state = await employee.call('getCurrentState');
    expect(state.data.currentStage).toMatchObject({ startLocalDate: '2026-11-10', days: 1 });
    expect(state.data.canCheckin).toBe(false);
    await expect(employee.call('createCheckinChallenge')).rejects.toMatchObject({
      code: 'BEFORE_START_DATE'
    });
  });

  test('isolates backfill records by contract instead of leaking prior cooperation dates', async () => {
    let now = fixedDate('2026-11-10');
    const backend = new MockBackend({ storage: new MemoryStorage(), now: () => now });
    const employer = backend.as('mock-employer');
    const employee = backend.as('mock-employee');
    await employer.call('bootstrapUser', { role: 'employer' });
    await employee.call('bootstrapUser', { role: 'employee' });
    const first = await employer.call('createContract', validContract({ startDate: '2026-11-10' }));
    await employee.call('joinContract', { inviteCode: first.data.inviteCode });
    await employer.call('createBackfillCheckins', {
      localDates: ['2026-11-05'],
      workTime: '09:00',
      reason: '前期补录'
    });
    now = fixedDate('2026-11-11');
    await settle(employer, employee);
    await employer.call('terminateContract', { reason: '合作结束' });

    const second = await employer.call('createContract', validContract({ startDate: '2026-11-11' }));
    await employee.call('joinContract', { inviteCode: second.data.inviteCode });
    const nextState = await employer.call('getCurrentState');
    expect(nextState.data.backfill.eligibleLocalDates).toContain('2026-11-05');
    expect(nextState.data.backfill.checkedLocalDates).not.toContain('2026-11-05');
    expect(nextState.data.historicalCalendarCheckins).toEqual([]);
    expect(nextState.data.settlementSummary).toEqual({
      settledStages: 0,
      totalPaidAmount: 0,
      totalSettledDays: 0
    });
    expect(nextState.data.lifetimeSummary).toEqual({
      settledStages: 1,
      totalPaidAmount: 307.69,
      totalSettledDays: 1
    });
    expect(nextState.data.cumulativeWorkDays).toBe(0);
    expect(nextState.data.lifetimeWorkDays).toBe(1);
    const employeeState = await employee.call('getCurrentState');
    expect(employeeState.data.historicalCalendarCheckins).toEqual([]);
    expect(employeeState.data.backfill.checkedLocalDates).not.toContain('2026-11-05');
    expect(employeeState.data.backfill.eligibleLocalDates).toContain('2026-11-05');
    expect(employeeState.data.cumulativeWorkDays).toBe(0);
    expect(employeeState.data.lifetimeWorkDays).toBe(1);
    await employer.call('createBackfillCheckins', {
      localDates: ['2026-11-05'],
      workTime: '09:00',
      reason: '前期补录'
    });
    const afterBackfill = await employer.call('getCurrentState');
    expect(afterBackfill.data.currentStage).toMatchObject({
      days: 1,
      backfillDays: 1,
      startLocalDate: '2026-11-05'
    });
    expect(afterBackfill.data.calendarCheckins).toEqual([
      expect.objectContaining({ localDate: '2026-11-05', source: 'employer_backfill' })
    ]);
  });

  test('uses one contract lifecycle lock for settlement, work, and termination writes', () => {
    const repository = new MemoryRepository(emptyDatabase());
    repository.users.push(
      { openid: 'employer', role: 'employer', activeContractId: 'contract_1' },
      { openid: 'employee', role: 'employee', activeContractId: 'contract_1' }
    );
    repository.contracts.push({
      _id: 'contract_1',
      status: 'active',
      employerOpenid: 'employer',
      employeeOpenid: 'employee',
      pendingSettlementRequestId: null
    });
    repository.cycles.push({
      _id: 'stage_1',
      contractId: 'contract_1',
      cycleIndex: 1,
      status: 'open',
      startLocalDate: '2026-11-01',
      checkinCount: 1
    });
    repository.challenges.push({
      _id: 'challenge_1',
      token: 'token',
      usedAt: null
    });
    repository.checkins.push({
      _id: 'contract_1:2026-11-01',
      cycleId: 'stage_1',
      contractId: 'contract_1',
      employeeOpenid: 'employee',
      localDate: '2026-11-01'
    });
    const request = {
      _id: 'request_1',
      contractId: 'contract_1',
      stageId: 'stage_1',
      status: 'pending_employee',
      days: 1
    };

    repository.insertSettlementRequest(request);
    expect(repository.contracts[0].pendingSettlementRequestId).toBe('request_1');
    expect(() => repository.insertSettlementRequest({ ...request, _id: 'request_2' }))
      .toThrow('SETTLEMENT_REQUEST_PENDING');
    expect(() => repository.completeCheckin(repository.challenges[0], {
      _id: 'contract_1:2026-11-02',
      cycleId: 'stage_1',
      contractId: 'contract_1',
      employeeOpenid: 'employee',
      localDate: '2026-11-02',
      serverTime: '2026-11-02T01:00:00.000Z'
    })).toThrow('SETTLEMENT_REQUEST_PENDING');
    expect(() => repository.insertBackfillCheckins({
      contractId: 'contract_1',
      stageId: 'stage_1',
      checkins: [{
        _id: 'contract_1:2026-11-03',
        localDate: '2026-11-03'
      }]
    })).toThrow('SETTLEMENT_REQUEST_PENDING');
    expect(() => repository.terminateContract({
      contractId: 'contract_1',
      stageId: 'stage_1',
      contractPatch: {},
      cyclePatch: {},
      employerOpenid: 'employer',
      employeeOpenid: 'employee'
    })).toThrow('SETTLEMENT_REQUEST_PENDING');

    repository.transitionSettlementRequest({
      requestId: 'request_1',
      expectedStatuses: ['pending_employee', 'disputed'],
      patch: { status: 'cancelled' },
      clearContractLock: true
    });
    expect(repository.contracts[0].pendingSettlementRequestId).toBeNull();
  });

  test('releases the employer atomically when an unmatched cooperation is cancelled', () => {
    const repository = new MemoryRepository(emptyDatabase());
    repository.users.push({
      openid: 'employer',
      role: 'employer',
      activeContractId: 'contract_1'
    });
    repository.contracts.push({
      _id: 'contract_1',
      status: 'active',
      employerOpenid: 'employer',
      employeeOpenid: null,
      inviteCode: 'ABCDEFGH'
    });
    repository.cycles.push({
      _id: 'stage_1',
      contractId: 'contract_1',
      status: 'open'
    });

    repository.cancelUnmatchedCooperation({
      contractId: 'contract_1',
      cycleId: 'stage_1',
      employerOpenid: 'employer'
    });

    expect(repository.users[0].activeContractId).toBeNull();
    expect(repository.contracts[0].status).toBe('cancelled');
  });

  test('still confirms a successful check-in if only the audit log write fails', async () => {
    let now = fixedDate('2026-11-01');
    const backend = new MockBackend({ storage: new MemoryStorage(), now: () => now });
    const employer = backend.as('mock-employer');
    const employee = backend.as('mock-employee');
    await employer.call('bootstrapUser', { role: 'employer' });
    await employee.call('bootstrapUser', { role: 'employee' });
    const created = await employer.call('createContract', validContract({ startDate: '2026-11-01' }));
    await employee.call('joinContract', { inviteCode: created.data.inviteCode });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const originalInsertAttempt = backend.repository.insertAttempt.bind(backend.repository);
    backend.repository.insertAttempt = (attempt) => {
      if (attempt.successful) throw new Error('AUDIT_UNAVAILABLE');
      return originalInsertAttempt(attempt);
    };
    const result = await checkIn(employee);
    warnSpy.mockRestore();
    expect(result.ok).toBe(true);
    expect(backend.repository.checkins).toHaveLength(1);
  });
});

function fixedDate(localDate) {
  return new Date(`${localDate}T01:00:00.000Z`);
}

async function checkIn(employee) {
  const challenge = await employee.call('createCheckinChallenge');
  return employee.call('submitCheckin', {
    challenge: challenge.data.challenge.token,
    latitude: 31.2304,
    longitude: 121.4737,
    accuracy: 30
  });
}

async function settle(employer, employee, paidAmount = 307.69) {
  const request = await employer.call('createSettlementRequest', {
    paidAmount,
    transferProofs: [{ fileId: 'wxfile://transfer.png' }]
  });
  return employee.call('confirmSettlementRequest', { requestId: request.data.settlementRequest._id });
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
