const { MemoryStorage } = require('../shared/storage');
const { MockBackend } = require('../shared/mock-backend');

describe('two-party settlement flow', () => {
  test('employer requests settlement, employee confirmation opens the next stage, and check-in resumes', async () => {
    let now = new Date('2026-12-11T01:00:00.000Z');
    const backend = new MockBackend({ storage: new MemoryStorage(), now: () => now });
    const employer = backend.as('mock-employer');
    const employee = backend.as('mock-employee');
    await employer.call('bootstrapUser', { role: 'employer' });
    await employee.call('bootstrapUser', { role: 'employee' });
    const created = await employer.call('createContract', validContract({
      startDate: '2026-11-22'
    }));
    await employee.call('joinContract', { inviteCode: created.data.inviteCode });

    for (let day = 0; day < 16; day += 1) {
      now = new Date(Date.parse('2026-11-22T01:00:00.000Z') + day * 86400000);
      await checkIn(employee);
    }

    now = new Date('2026-12-11T01:00:00.000Z');
    const request = await employer.call('createSettlementRequest', {
      paidAmount: 4900,
      differenceReason: '双方约定抹零',
      transferProofs: [{ fileId: 'wxfile://transfer-1.png' }]
    });
    expect(request.data.settlementRequest).toMatchObject({
      status: 'pending_employee',
      stageStartLocalDate: '2026-11-22',
      workEndLocalDate: '2026-12-07',
      days: 16,
      totalAmount: 8000,
      targetDays: 26,
      dailySalary: 307.69,
      suggestedAmount: 4923.08,
      paidAmount: 4900,
      differenceAmount: -23.08
    });

    const lockedState = await employee.call('getCurrentState');
    expect(lockedState.data.pendingSettlement.status).toBe('pending_employee');
    expect(lockedState.data.canCheckin).toBe(false);
    await expect(employee.call('createCheckinChallenge')).rejects.toMatchObject({
      code: 'SETTLEMENT_PENDING'
    });

    const confirmed = await employee.call('confirmSettlementRequest');
    expect(confirmed.data.settlement).toMatchObject({
      days: 16,
      totalAmount: 8000,
      targetDays: 26,
      paidAmount: 4900,
      suggestedAmount: 4923.08,
      differenceAmount: -23.08,
      differenceReason: '双方约定抹零',
      status: 'confirmed'
    });
    expect(confirmed.data.nextStage).toMatchObject({
      stageIndex: 2,
      startLocalDate: '2026-12-08',
      status: 'open'
    });

    const reopened = await employee.call('getCurrentState');
    expect(reopened.data.pendingSettlement).toBeNull();
    expect(reopened.data.currentStage).toMatchObject({ stageIndex: 2, days: 0 });
    expect(reopened.data.canCheckin).toBe(true);
    await checkIn(employee);
    const afterReopen = await employer.call('getCurrentState');
    expect(afterReopen.data.currentStage).toMatchObject({ stageIndex: 2, days: 1 });
  });

  test('requires a proof image, a difference reason, and settles through today’s check-in', async () => {
    let now = new Date('2026-12-10T01:00:00.000Z');
    const backend = new MockBackend({ storage: new MemoryStorage(), now: () => now });
    const employer = backend.as('mock-employer');
    const employee = backend.as('mock-employee');
    await employer.call('bootstrapUser', { role: 'employer' });
    await employee.call('bootstrapUser', { role: 'employee' });
    const created = await employer.call('createContract', validContract({ startDate: '2026-12-10' }));
    await employee.call('joinContract', { inviteCode: created.data.inviteCode });
    await checkIn(employee);
    now = new Date('2026-12-11T01:00:00.000Z');

    await expect(employer.call('createSettlementRequest', {
      paidAmount: 307.69
    })).rejects.toMatchObject({ code: 'TRANSFER_PROOF_REQUIRED' });

    await expect(employer.call('createSettlementRequest', {
      paidAmount: 300,
      transferProofs: [{ fileId: 'wxfile://transfer.png' }]
    })).rejects.toMatchObject({ code: 'DIFFERENCE_REASON_REQUIRED' });

    await expect(employer.call('createSettlementRequest', {
      paidAmount: 307.69,
      transferProofs: [{ fileId: 'wxfile://transfer.png' }]
    })).resolves.toMatchObject({ ok: true });

    await employee.call('confirmSettlementRequest');
    await checkIn(employee);
    const request = await employer.call('createSettlementRequest', {
      paidAmount: 307.69,
      transferProofs: [{ fileId: 'wxfile://transfer.png' }]
    });
    expect(request.data.settlementRequest).toMatchObject({
      workEndLocalDate: '2026-12-11',
      nextStageStartLocalDate: '2026-12-12'
    });
  });

  test('rejects more than three proofs and invalid cloud file IDs', async () => {
    let now = new Date('2026-12-10T01:00:00.000Z');
    const backend = new MockBackend({ storage: new MemoryStorage(), now: () => now });
    const employer = backend.as('mock-employer');
    const employee = backend.as('mock-employee');
    await employer.call('bootstrapUser', { role: 'employer' });
    await employee.call('bootstrapUser', { role: 'employee' });
    const created = await employer.call('createContract', validContract({ startDate: '2026-12-10' }));
    await employee.call('joinContract', { inviteCode: created.data.inviteCode });
    await checkIn(employee);
    now = new Date('2026-12-11T01:00:00.000Z');

    await expect(employer.call('createSettlementRequest', {
      paidAmount: 307.69,
      transferProofs: [1, 2, 3, 4].map((index) => ({ fileId: `wxfile://proof-${index}.png` }))
    })).rejects.toMatchObject({ code: 'TRANSFER_PROOF_LIMIT' });

    backend.repository.storageType = 'cloud';
    await expect(employer.call('createSettlementRequest', {
      paidAmount: 307.69,
      transferProofs: [{ fileId: 'wxfile://not-cloud.png' }]
    })).rejects.toMatchObject({ code: 'INVALID_TRANSFER_PROOF' });
    await expect(employer.call('createSettlementRequest', {
      paidAmount: 307.69,
      transferProofs: [{ fileId: `cloud://bucket/transfer-proofs/other-contract/proof.png` }]
    })).rejects.toMatchObject({ code: 'INVALID_TRANSFER_PROOF' });
    await expect(employer.call('createSettlementRequest', {
      paidAmount: 307.69,
      transferProofs: [{
        fileId: `cloud://bucket/transfer-proofs/${created.data.contract._id}/proof.png`
      }]
    })).resolves.toMatchObject({ ok: true });
  });

  test('dispute locks work until the employer cancels; cancelled requests do not create history', async () => {
    let now = new Date('2026-12-10T01:00:00.000Z');
    const backend = new MockBackend({ storage: new MemoryStorage(), now: () => now });
    const employer = backend.as('mock-employer');
    const employee = backend.as('mock-employee');
    await employer.call('bootstrapUser', { role: 'employer' });
    await employee.call('bootstrapUser', { role: 'employee' });
    const created = await employer.call('createContract', validContract({ startDate: '2026-12-10' }));
    await employee.call('joinContract', { inviteCode: created.data.inviteCode });
    await checkIn(employee);
    now = new Date('2026-12-11T01:00:00.000Z');
    await employer.call('createSettlementRequest', {
      paidAmount: 307.69,
      differenceReason: '按日薪支付',
      transferProofs: [{ fileId: 'wxfile://transfer.png' }]
    });

    const disputed = await employee.call('disputeSettlementRequest', { reason: '金额不对' });
    expect(disputed.data.settlementRequest).toMatchObject({ status: 'disputed' });
    await expect(employee.call('createCheckinChallenge')).rejects.toMatchObject({
      code: 'SETTLEMENT_PENDING'
    });
    await expect(employee.call('confirmSettlementRequest')).rejects.toMatchObject({
      code: 'SETTLEMENT_DISPUTED'
    });

    const cancelled = await employer.call('cancelSettlementRequest');
    expect(cancelled.data.settlementRequest.status).toBe('cancelled');
    const state = await employee.call('getCurrentState');
    expect(state.data.pendingSettlement).toBeNull();
    expect(state.data.canCheckin).toBe(true);

    const history = await employer.call('listHistory');
    expect(history.data.summary).toMatchObject({ settledStages: 0, totalPaidAmount: 0 });
    expect(history.data.settlements).toHaveLength(0);
  });

  test('history summarizes confirmed stages and exposes payment proofs', async () => {
    let now = new Date('2026-12-10T01:00:00.000Z');
    const backend = new MockBackend({ storage: new MemoryStorage(), now: () => now });
    const employer = backend.as('mock-employer');
    const employee = backend.as('mock-employee');
    await employer.call('bootstrapUser', { role: 'employer' });
    await employee.call('bootstrapUser', { role: 'employee' });
    const created = await employer.call('createContract', validContract({ startDate: '2026-12-10' }));
    await employee.call('joinContract', { inviteCode: created.data.inviteCode });
    await checkIn(employee);
    now = new Date('2026-12-11T01:00:00.000Z');
    await employer.call('createSettlementRequest', {
      paidAmount: 4900,
      differenceReason: '抹零',
      transferProofs: [{ fileId: 'wxfile://transfer.png' }]
    });
    await employee.call('confirmSettlementRequest');

    const history = await employer.call('listHistory');
    expect(history.data.summary).toEqual({
      settledStages: 1,
      totalPaidAmount: 4900,
      totalSettledDays: 1
    });
    expect(history.data.settlements[0]).toMatchObject({
      stageIndex: 1,
      stageStartLocalDate: '2026-12-10',
      workEndLocalDate: '2026-12-10',
      paidAmount: 4900,
      transferProofs: [{ fileId: 'wxfile://transfer.png' }]
    });
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

function validContract(overrides = {}) {
  return {
    totalAmount: 8000,
    targetDays: 26,
    startDate: '2026-11-22',
    address: '上海市黄浦区',
    latitude: 31.2304,
    longitude: 121.4737,
    radiusMeters: 300,
    ...overrides
  };
}
