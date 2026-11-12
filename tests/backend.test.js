const { MemoryStorage } = require('../shared/storage');
const { MockBackend } = require('../shared/mock-backend');

describe('attendance backend workflow', () => {
  test('supports employer contract creation, employee joining, check-in, settlement, and a new cycle', async () => {
    let now = new Date('2026-11-11T01:00:00.000Z');
    const backend = new MockBackend({
      storage: new MemoryStorage(),
      now: () => now
    });
    const employer = backend.as('mock-employer');
    const employee = backend.as('mock-employee');

    await employee.call('bootstrapUser', { role: 'employee' });
    const boot = await employer.call('bootstrapUser', { role: 'employer' });
    expect(boot.ok).toBe(true);
    expect(boot.data.user.role).toBe('employer');

    const created = await employer.call('createContract', validContract());
    expect(created.data.contract.totalAmount).toBe(8000);
    expect(created.data.contract.targetDays).toBe(26);
    expect(created.data.inviteCode).toHaveLength(8);
    expect(created.data.contract.homeLocation.address).toBe('上海市黄浦区');

    await expect(employee.call('createContract', validContract())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const joined = await employee.call('joinContract', { inviteCode: created.data.inviteCode });
    expect(joined.data.contract.employeeOpenid).toBe('mock-employee');
    await expect(employee.call('joinContract', { inviteCode: created.data.inviteCode })).rejects.toMatchObject({ code: 'EMPLOYEE_ALREADY_JOINED' });

    const challengeResult = await employee.call('createCheckinChallenge');
    const challenge = challengeResult.data.challenge;
    const checkin = await employee.call('submitCheckin', {
      challenge: challenge.token,
      latitude: 31.2305,
      longitude: 121.4738,
      accuracy: 80
    });
    expect(checkin.data.checkin.localDate).toBe('2026-11-11');
    expect(checkin.data.checkin.distanceMeters).toBeLessThan(300);

    await expect(employee.call('submitCheckin', {
      challenge: challenge.token,
      latitude: 31.2305,
      longitude: 121.4738,
      accuracy: 80
    })).rejects.toMatchObject({ code: 'CHALLENGE_USED' });

    await expect(employee.call('createCheckinChallenge')).rejects.toMatchObject({ code: 'DUPLICATE_CHECKIN' });

    const employerState = await employer.call('getCurrentState');
    expect(employerState.data.progress.checkinDays).toBe(1);
    expect(employerState.data.progress.payableAmount).toBe(307.69);
    expect(employerState.data.reminder.required).toBe(false);
    const employeeState = await employee.call('getCurrentState');
    expect(employeeState.data.checkins[0]).not.toHaveProperty('latitude');
    expect(employeeState.data.checkins[0]).not.toHaveProperty('longitude');
    expect(employeeState.data.today.checkin).not.toHaveProperty('latitude');
    expect(employeeState.data.today.checkin).not.toHaveProperty('longitude');

    now = new Date('2026-11-12T01:00:00.000Z');
    await employer.call('createSettlementRequest', {
      paidAmount: 307.69,
      transferProofs: [{ fileId: 'wxfile://transfer.png' }]
    });
    const settled = await employee.call('confirmSettlementRequest');
    expect(settled.data.settlement).toMatchObject({ days: 1, paidAmount: 307.69 });
    expect(settled.data.settlement.settledCheckinDates).toEqual(['2026-11-11']);
    expect(settled.data.nextStage).toMatchObject({ stageIndex: 2, status: 'open' });

    const history = await employer.call('listHistory');
    expect(history.data.settlements[0]).toMatchObject({ days: 1, paidAmount: 307.69 });
    const afterSettlement = await employer.call('getCurrentState');
    expect(afterSettlement.data.progress.checkinDays).toBe(0);
    expect(afterSettlement.data.settledCheckinDates).toEqual(['2026-11-11']);
  });

  test('expires invite codes and records failed location attempts', async () => {
    let now = new Date('2026-11-11T01:00:00.000Z');
    const backend = new MockBackend({
      storage: new MemoryStorage(),
      now: () => now
    });
    const employer = backend.as('mock-employer');
    const employee = backend.as('mock-employee');
    await employer.call('bootstrapUser', { role: 'employer' });
    await employee.call('bootstrapUser', { role: 'employee' });
    const created = await employer.call('createContract', validContract());

    now = new Date('2026-11-12T01:00:01.000Z');
    await expect(employee.call('joinContract', { inviteCode: created.data.inviteCode })).rejects.toMatchObject({ code: 'INVITE_EXPIRED' });

    const cleanBackend = new MockBackend({
      storage: new MemoryStorage(),
      now: () => new Date('2026-11-11T01:00:00.000Z')
    });
    const cleanEmployer = cleanBackend.as('mock-employer');
    const cleanEmployee = cleanBackend.as('mock-employee');
    await cleanEmployer.call('bootstrapUser', { role: 'employer' });
    await cleanEmployee.call('bootstrapUser', { role: 'employee' });
    const fresh = await cleanEmployer.call('createContract', validContract());
    await cleanEmployee.call('joinContract', { inviteCode: fresh.data.inviteCode });
    const challenge = await cleanEmployee.call('createCheckinChallenge');
    await expect(cleanEmployee.call('submitCheckin', {
      challenge: challenge.data.challenge.token,
      latitude: 31.4,
      longitude: 121.6,
      accuracy: 100
    })).rejects.toMatchObject({ code: 'OUT_OF_FENCE' });

    const attempts = cleanBackend.repository.checkin_attempts;
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ reason: 'OUT_OF_FENCE', successful: false });
  });

  test('lets an employer regenerate an unbound expired invite code', async () => {
    let now = new Date('2026-11-11T01:00:00.000Z');
    const backend = new MockBackend({ storage: new MemoryStorage(), now: () => now });
    const employer = backend.as('mock-employer');
    const employee = backend.as('mock-employee');
    await employer.call('bootstrapUser', { role: 'employer' });
    await employee.call('bootstrapUser', { role: 'employee' });
    const created = await employer.call('createContract', validContract());

    now = new Date('2026-11-12T01:00:01.000Z');
    const expiredState = await employer.call('getCurrentState');
    expect(expiredState.data.contract.inviteCode).toBeNull();
    const regenerated = await employer.call('regenerateInviteCode');
    expect(regenerated.data.inviteCode).not.toBe(created.data.inviteCode);
    expect(new Date(regenerated.data.inviteExpiresAt).getTime()).toBe(now.getTime() + 24 * 60 * 60 * 1000);

    await expect(employee.call('joinContract', { inviteCode: created.data.inviteCode }))
      .rejects.toMatchObject({ code: 'INVITE_NOT_FOUND' });
    await expect(employee.call('joinContract', { inviteCode: regenerated.data.inviteCode }))
      .resolves.toMatchObject({ ok: true });

    await expect(employer.call('regenerateInviteCode')).rejects.toMatchObject({ code: 'CONTRACT_ALREADY_BOUND' });
  });

  test('allows correcting a role before a cooperation is created', async () => {
    const now = new Date('2026-11-11T01:00:00.000Z');
    const backend = new MockBackend({ storage: new MemoryStorage(), now: () => now });
    const user = backend.as('mock-user');
    await user.call('bootstrapUser', { role: 'employee' });
    const corrected = await user.call('bootstrapUser', { role: 'employer' });
    expect(corrected.data.user.role).toBe('employer');

    await user.call('createContract', validContract());
    await expect(user.call('bootstrapUser', { role: 'employee' }))
      .rejects.toMatchObject({ code: 'ROLE_ALREADY_SET' });
  });

  test('previews an invite before the employee confirms matching', async () => {
    const now = new Date('2026-11-11T01:00:00.000Z');
    const backend = new MockBackend({ storage: new MemoryStorage(), now: () => now });
    const employer = backend.as('mock-employer');
    const employee = backend.as('mock-employee');
    await employer.call('bootstrapUser', { role: 'employer' });
    await employee.call('bootstrapUser', { role: 'employee' });
    const created = await employer.call('createContract', validContract());

    const preview = await employee.call('previewInvite', { inviteCode: created.data.inviteCode });
    expect(preview.data.invite).toMatchObject({
      totalAmount: 8000,
      targetDays: 26,
      startDate: '2026-11-11',
      radiusMeters: 300,
      address: validContract().address
    });
    expect(preview.data.invite.employerOpenid).toBeUndefined();
    expect(preview.data.invite.employeeOpenid).toBeUndefined();
    expect(preview.data.invite.homeLocation).toBeUndefined();
    expect(preview.data.invite.latitude).toBeUndefined();
    expect(preview.data.invite.longitude).toBeUndefined();

    const unmatched = await employee.call('getCurrentState');
    expect(unmatched.data.contract).toBeNull();
    await employee.call('joinContract', { inviteCode: created.data.inviteCode });
    const matched = await employer.call('getCurrentState');
    expect(matched.data.contract.employeeOpenid).toBe('mock-employee');
  });

  test('lets the employer revise an unbound cooperation and its first stage', async () => {
    const now = new Date('2026-11-11T01:00:00.000Z');
    const backend = new MockBackend({ storage: new MemoryStorage(), now: () => now });
    const employer = backend.as('mock-employer');
    const employee = backend.as('mock-employee');
    await employer.call('bootstrapUser', { role: 'employer' });
    await employee.call('bootstrapUser', { role: 'employee' });
    const created = await employer.call('createContract', validContract());

    const updated = await employer.call('updateContract', {
      totalAmount: 9000,
      targetDays: 30,
      startDate: '2026-11-15',
      address: '上海市徐汇区新的家庭地址',
      latitude: 31.19,
      longitude: 121.43,
      radiusMeters: 400
    });
    expect(updated.data.contract).toMatchObject({
      totalAmount: 9000,
      targetDays: 30,
      startDate: '2026-11-15',
      radiusMeters: 400
    });
    expect(updated.data.contract.inviteCode).not.toBe(created.data.inviteCode);
    await expect(employee.call('joinContract', { inviteCode: created.data.inviteCode }))
      .rejects.toMatchObject({ code: 'INVITE_NOT_FOUND' });
    expect(updated.data.cycle).toMatchObject({
      startLocalDate: '2026-11-15',
      status: 'open'
    });

    await employee.call('joinContract', { inviteCode: updated.data.contract.inviteCode });
    await expect(employer.call('updateContract', validContract()))
      .rejects.toMatchObject({ code: 'CONTRACT_ALREADY_BOUND' });
    await expect(employee.call('updateContract', validContract()))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('resets an unmatched cooperation so the user can choose another role', async () => {
    const now = new Date('2026-11-11T01:00:00.000Z');
    const backend = new MockBackend({ storage: new MemoryStorage(), now: () => now });
    const employer = backend.as('mock-employer');
    const employee = backend.as('mock-employee');
    await employer.call('bootstrapUser', { role: 'employer' });
    await employee.call('bootstrapUser', { role: 'employee' });
    const created = await employer.call('createContract', validContract());

    const reset = await employer.call('resetUnmatchedCooperation');
    expect(reset.data.reset).toBe(true);
    expect(backend.repository.contracts[0]).toMatchObject({
      _id: created.data.contract._id,
      status: 'cancelled',
      inviteCode: null
    });
    expect(backend.repository.cycles[0].status).toBe('cancelled');

    const changedRole = await employer.call('bootstrapUser', { role: 'employee' });
    expect(changedRole.data.user.role).toBe('employee');

    const clean = new MockBackend({ storage: new MemoryStorage(), now: () => now });
    const cleanEmployer = clean.as('mock-employer');
    const cleanEmployee = clean.as('mock-employee');
    await cleanEmployer.call('bootstrapUser', { role: 'employer' });
    await cleanEmployee.call('bootstrapUser', { role: 'employee' });
    const contract = await cleanEmployer.call('createContract', validContract());
    await cleanEmployee.call('joinContract', { inviteCode: contract.data.inviteCode });
    await expect(cleanEmployer.call('resetUnmatchedCooperation'))
      .rejects.toMatchObject({ code: 'COOPERATION_ALREADY_MATCHED' });
  });

  test('prevents settlement by an employee and rejects settlement without work', async () => {
    const backend = new MockBackend({ storage: new MemoryStorage(), now: () => new Date('2026-11-11T01:00:00.000Z') });
    const employer = backend.as('mock-employer');
    const employee = backend.as('mock-employee');
    await employer.call('bootstrapUser', { role: 'employer' });
    await employee.call('bootstrapUser', { role: 'employee' });
    const created = await employer.call('createContract', validContract());
    await employee.call('joinContract', { inviteCode: created.data.inviteCode });

    await expect(employee.call('createSettlementRequest', {
      paidAmount: 0,
      transferProofs: [{ fileId: 'wxfile://transfer.png' }]
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(employer.call('createSettlementRequest', {
      paidAmount: 0,
      transferProofs: [{ fileId: 'wxfile://transfer.png' }]
    })).rejects.toMatchObject({ code: 'NO_CHECKINS_TO_SETTLE' });
  });

  test('reminds at 26 days and lets work resume after employee confirms settlement', async () => {
    let now = new Date('2026-11-11T01:00:00.000Z');
    const backend = new MockBackend({ storage: new MemoryStorage(), now: () => now });
    const employer = backend.as('mock-employer');
    const employee = backend.as('mock-employee');
    await employer.call('bootstrapUser', { role: 'employer' });
    await employee.call('bootstrapUser', { role: 'employee' });
    const created = await employer.call('createContract', validContract());
    await employee.call('joinContract', { inviteCode: created.data.inviteCode });

    for (let index = 0; index < 26; index += 1) {
      now = new Date(Date.parse('2026-11-11T01:00:00.000Z') + index * 24 * 60 * 60 * 1000);
      const challenge = await employee.call('createCheckinChallenge');
      await employee.call('submitCheckin', {
        challenge: challenge.data.challenge.token,
        latitude: 31.2304,
        longitude: 121.4737,
        accuracy: 30
      });
    }

    const beforeSettlement = await employer.call('getCurrentState');
    expect(beforeSettlement.data.progress).toMatchObject({ checkinDays: 26, payableAmount: 8000 });
    expect(beforeSettlement.data.reminder).toMatchObject({ required: true, daysOver: 0 });

    now = new Date('2026-12-07T01:00:00.000Z');
    await employer.call('createSettlementRequest', {
      paidAmount: 8000,
      transferProofs: [{ fileId: 'wxfile://transfer.png' }]
    });
    await expect(employee.call('createCheckinChallenge')).rejects.toMatchObject({
      code: 'SETTLEMENT_PENDING'
    });
    const confirmed = await employee.call('confirmSettlementRequest');
    expect(confirmed.data.settlement).toMatchObject({ days: 26, paidAmount: 8000 });
    expect(confirmed.data.nextStage).toMatchObject({ stageIndex: 2, startLocalDate: '2026-12-07' });

    const afterSettlement = await employer.call('getCurrentState');
    expect(afterSettlement.data.currentStage).toMatchObject({ stageIndex: 2, days: 0 });
    const challenge = await employee.call('createCheckinChallenge');
    await employee.call('submitCheckin', {
      challenge: challenge.data.challenge.token,
      latitude: 31.2304,
      longitude: 121.4737,
      accuracy: 30
    });
    const resumed = await employer.call('getCurrentState');
    expect(resumed.data.currentStage).toMatchObject({ stageIndex: 2, days: 1 });
  });

  test('rejects an expired challenge and allows a fresh one on the same day', async () => {
    let now = new Date('2026-11-11T01:00:00.000Z');
    const backend = new MockBackend({ storage: new MemoryStorage(), now: () => now });
    const employer = backend.as('mock-employer');
    const employee = backend.as('mock-employee');
    await employer.call('bootstrapUser', { role: 'employer' });
    await employee.call('bootstrapUser', { role: 'employee' });
    const created = await employer.call('createContract', validContract());
    await employee.call('joinContract', { inviteCode: created.data.inviteCode });

    const expired = await employee.call('createCheckinChallenge');
    now = new Date(now.getTime() + 2 * 60 * 1000 + 1);
    await expect(employee.call('submitCheckin', {
      challenge: expired.data.challenge.token,
      latitude: 31.2304,
      longitude: 121.4737,
      accuracy: 30
    })).rejects.toMatchObject({ code: 'CHALLENGE_EXPIRED' });

    const fresh = await employee.call('createCheckinChallenge');
    const successful = await employee.call('submitCheckin', {
      challenge: fresh.data.challenge.token,
      latitude: 31.2304,
      longitude: 121.4737,
      accuracy: 30
    });
    expect(successful.data.checkin.localDate).toBe('2026-11-11');
  });
});

function validContract() {
  return {
    totalAmount: 8000,
    targetDays: 26,
    startDate: '2026-11-11',
    address: '上海市黄浦区',
    latitude: 31.2304,
    longitude: 121.4737,
    radiusMeters: 300
  };
}
