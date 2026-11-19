const { MemoryRepository, emptyDatabase } = require('../shared/memory-repository');
const { CloudDatabaseRepository } = require('../cloudfunctions/attendance/repository');

describe('attendance repositories', () => {
  test('makes unbound-contract transitions reject a contract matched during the read/write gap', () => {
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
      inviteCode: null,
      totalAmount: 8000,
      targetDays: 26,
      startDate: '2026-11-11',
      homeLocation: { address: 'home', latitude: 31.2, longitude: 121.4 },
      radiusMeters: 300
    });
    repository.cycles.push({
      _id: 'cycle_1',
      contractId: 'contract_1',
      status: 'open',
      startLocalDate: '2026-11-11'
    });

    const staleContract = { ...repository.contracts[0], employeeOpenid: null };
    expect(() => repository.bindEmployeeToUnboundContract({
      contractId: 'contract_1',
      expectedInviteCode: 'ABCDEFGH',
      employeeOpenid: 'employee'
    })).toThrow('CONTRACT_ALREADY_BOUND');
    expect(() => repository.updateUnboundContract({
      contractId: 'contract_1',
      cycleId: 'cycle_1',
      contractPatch: { totalAmount: 9000 },
      cyclePatch: {}
    })).toThrow('CONTRACT_ALREADY_BOUND');
    expect(() => repository.regenerateInviteForUnboundContract({
      contractId: 'contract_1',
      inviteCode: 'NEWCODE1',
      inviteExpiresAt: '2026-11-12T01:00:00.000Z'
    })).toThrow('CONTRACT_ALREADY_BOUND');
    expect(() => repository.cancelUnmatchedCooperation({
      contractId: 'contract_1',
      cycleId: 'cycle_1'
    })).toThrow('CONTRACT_ALREADY_BOUND');
    expect(staleContract.employeeOpenid).toBeNull();
  });

  test('cloud repository rechecks unbound contracts inside transactions', async () => {
    const contract = {
      _id: 'contract_1',
      status: 'active',
      inviteCode: null,
      employeeOpenid: 'employee'
    };
    const cycle = { _id: 'cycle_1', contractId: 'contract_1', status: 'open' };
    const updates = [];
    let committed = false;
    const transaction = {
      collection(name) {
        return {
          async add({ data }) {
            if (name === 'contracts') contractCopy = { ...data };
            if (name === 'cycles') cycleCopy = { ...data };
          },
          doc(id) {
            return {
              async get() {
                if (name === 'contracts') return { data: contract };
                if (name === 'users') {
                  return { data: { _id: id, openid: id, role: 'employee', activeContractId: null } };
                }
                return { data: cycle };
              },
              async update({ data }) {
                updates.push({ name, id, data });
              }
            };
          }
        };
      },
      async commit() { committed = true; },
      async rollback() { committed = false; }
    };
    const repository = new CloudDatabaseRepository({
      startTransaction: async () => transaction
    });

    await expect(repository.bindEmployeeToUnboundContract({
      contractId: 'contract_1',
      expectedInviteCode: 'ABCDEFGH',
      employeeOpenid: 'employee'
    })).rejects.toThrow('CONTRACT_ALREADY_BOUND');
    await expect(repository.updateUnboundContract({
      contractId: 'contract_1',
      cycleId: 'cycle_1',
      contractPatch: {},
      cyclePatch: {}
    })).rejects.toThrow('CONTRACT_ALREADY_BOUND');
    await expect(repository.cancelUnmatchedCooperation({
      contractId: 'contract_1',
      cycleId: 'cycle_1'
    })).rejects.toThrow('CONTRACT_ALREADY_BOUND');
    expect(updates).toEqual([]);
    expect(committed).toBe(false);
  });

  test('cancels an unmatched contract even when its stage record is missing', () => {
    const repository = new MemoryRepository(emptyDatabase());
    repository.contracts.push({
      _id: 'contract_1',
      status: 'active',
      employeeOpenid: null,
      inviteCode: 'ABCDEFGH'
    });

    const result = repository.cancelUnmatchedCooperation({ contractId: 'contract_1' });
    expect(result.contract).toMatchObject({
      status: 'cancelled',
      inviteCode: null,
      inviteExpiresAt: null
    });
    expect(result.cycle).toBeNull();
  });

  test('cloud repository commits an atomic employee match', async () => {
    const contract = {
      _id: 'contract_1',
      status: 'active',
      inviteCode: 'ABCDEFGH',
      employeeOpenid: null
    };
    const cycle = { _id: 'cycle_1', contractId: 'contract_1', status: 'open' };
    const updates = [];
    let committed = false;
    const transaction = {
      collection(name) {
        return {
          doc(id) {
            return {
              async get() {
                if (name === 'contracts') return { data: contract };
                if (name === 'users') {
                  return {
                    data: {
                      _id: id,
                      openid: id,
                      role: 'employee',
                      activeContractId: null
                    }
                  };
                }
                return { data: cycle };
              },
              async update({ data }) {
                updates.push({ name, id, data });
              }
            };
          }
        };
      },
      async commit() { committed = true; },
      async rollback() { committed = false; }
    };
    const repository = new CloudDatabaseRepository({
      startTransaction: async () => transaction
    });

    const result = await repository.bindEmployeeToUnboundContract({
      contractId: 'contract_1',
      expectedInviteCode: 'ABCDEFGH',
      employeeOpenid: 'employee-openid'
    });
    expect(result.contract).toMatchObject({
      employeeOpenid: 'employee-openid',
      inviteCode: null
    });
    expect(updates).toEqual([{
      name: 'contracts',
      id: 'contract_1',
      data: { employeeOpenid: 'employee-openid', inviteCode: null }
    }, {
      name: 'users',
      id: 'employee-openid',
      data: { activeContractId: 'contract_1' }
    }]);
    expect(committed).toBe(true);
  });

  test('cloud repository returns participant contracts from paginated arrays', async () => {
    const contracts = [
      {
        _id: 'contract_1',
        status: 'ended',
        employerOpenid: 'employer',
        employeeOpenid: 'employee',
        endedAt: '2026-11-01T00:00:00.000Z'
      },
      {
        _id: 'contract_2',
        status: 'active',
        employerOpenid: 'employer',
        employeeOpenid: 'employee',
        createdAt: '2026-11-02T00:00:00.000Z'
      }
    ];
    const db = {
      collection() {
        return {
          where(where) {
            return {
              limit(pageSize) {
                return {
                  skip(offset) {
                    return {
                      async get() {
                        const matches = contracts.filter((contract) =>
                          Object.entries(where).every(([key, value]) => contract[key] === value)
                        );
                        return { data: matches.slice(offset, offset + pageSize) };
                      }
                    };
                  }
                };
              }
            };
          }
        };
      }
    };
    const repository = new CloudDatabaseRepository(db, { contractPageSize: 1 });

    await expect(repository.listContractsForParticipant('employer')).resolves.toEqual([
      contracts[1],
      contracts[0]
    ]);
  });

  test('cloud repository treats missing backfill check-in documents as absent', async () => {
    const contract = {
      _id: 'contract_1',
      status: 'active',
      employeeOpenid: 'employee',
      pendingSettlementRequestId: null
    };
    const stage = {
      _id: 'stage_1',
      contractId: 'contract_1',
      status: 'open',
      startLocalDate: '2026-11-10',
      checkinCount: 0
    };
    let committed = false;
    const transaction = {
      collection(name) {
        return {
          async add({ data }) {
            if (name !== 'checkins') throw new Error('unexpected addition');
            expect(data._id).toBe('contract_1:2026-11-04');
          },
          doc(id) {
            return {
              async get() {
                if (name === 'contracts') return { data: contract };
                if (name === 'cycles') return { data: stage };
                throw new Error(`document.get:fail document with _id ${id} does not exist`);
              },
              async update({ data }) {
                expect(name).toBe('cycles');
                expect(data).toEqual({ startLocalDate: '2026-11-04', checkinCount: 1 });
              }
            };
          }
        };
      },
      async commit() { committed = true; },
      async rollback() { committed = false; }
    };
    const repository = new CloudDatabaseRepository({ startTransaction: async () => transaction });

    await repository.insertBackfillCheckins({
      contractId: 'contract_1',
      stageId: 'stage_1',
      checkins: [{ _id: 'contract_1:2026-11-04', localDate: '2026-11-04' }]
    });
    expect(committed).toBe(true);
  });

  test('cloud repository commits a check-in when its deterministic document is absent', async () => {
    const contract = {
      _id: 'contract_1',
      status: 'active',
      employeeOpenid: 'employee',
      pendingSettlementRequestId: null
    };
    const cycle = {
      _id: 'cycle_1',
      contractId: 'contract_1',
      status: 'open',
      checkinCount: 0
    };
    const challenge = { _id: 'challenge_1', usedAt: null };
    const checkin = {
      _id: 'contract_1:2026-11-19',
      contractId: 'contract_1',
      cycleId: 'cycle_1',
      employeeOpenid: 'employee',
      serverTime: '2026-11-19T01:00:00.000Z'
    };
    const additions = [];
    const updates = [];
    let committed = false;
    const transaction = {
      collection(name) {
        return {
          async add({ data }) {
            additions.push({ name, data });
          },
          doc(id) {
            return {
              async get() {
                if (name === 'contracts') return { data: contract };
                if (name === 'cycles') return { data: cycle };
                if (name === 'challenges') return { data: challenge };
                throw new Error(`document.get:fail document with _id ${id} does not exist`);
              },
              async update({ data }) {
                updates.push({ name, id, data });
              }
            };
          }
        };
      },
      async commit() { committed = true; },
      async rollback() { committed = false; }
    };
    const repository = new CloudDatabaseRepository({ startTransaction: async () => transaction });

    await expect(repository.completeCheckin(challenge, checkin)).resolves.toBe(checkin);
    expect(additions).toEqual([{ name: 'checkins', data: checkin }]);
    expect(updates).toEqual([
      { name: 'challenges', id: 'challenge_1', data: { usedAt: checkin.serverTime } },
      { name: 'cycles', id: 'cycle_1', data: { checkinCount: 1 } }
    ]);
    expect(committed).toBe(true);
  });

  test('cloud repository atomically inserts backfills and terminates a bound contract', async () => {
    const contract = {
      _id: 'contract_1',
      status: 'active',
      employerOpenid: 'employer',
      employeeOpenid: 'employee'
    };
    const stage = { _id: 'stage_1', contractId: 'contract_1', status: 'open', checkinCount: 0 };
    const additions = [];
    const updates = [];
    let committed = false;
    const transaction = {
      collection(name) {
        return {
          async add({ data }) { additions.push({ name, data }); },
          doc(id) {
            return {
              async get() {
                if (name === 'contracts') return { data: contract };
                if (name === 'cycles') return { data: stage };
                if (name === 'users') return { data: { _id: id, activeContractId: 'contract_1' } };
                return { data: null };
              },
              async update({ data }) { updates.push({ name, id, data }); }
            };
          }
        };
      },
      async commit() { committed = true; },
      async rollback() { committed = false; }
    };
    const repository = new CloudDatabaseRepository({ startTransaction: async () => transaction });
    const checkins = [
      { _id: 'stage_1:2026-11-04', localDate: '2026-11-04' },
      { _id: 'stage_1:2026-11-05', localDate: '2026-11-05' }
    ];

    await repository.insertBackfillCheckins({
      contractId: 'contract_1',
      stageId: 'stage_1',
      checkins
    });
    expect(additions.filter((item) => item.name === 'checkins')).toHaveLength(2);

    await repository.terminateContract({
      contractId: 'contract_1',
      stageId: 'stage_1',
      contractPatch: { status: 'ended' },
      cyclePatch: { status: 'ended' },
      employerOpenid: 'employer',
      employeeOpenid: 'employee'
    });
    expect(updates).toEqual([
      {
        name: 'cycles',
        id: 'stage_1',
        data: { startLocalDate: '2026-11-04', checkinCount: 2 }
      },
      { name: 'contracts', id: 'contract_1', data: { status: 'ended' } },
      { name: 'cycles', id: 'stage_1', data: { status: 'ended' } },
      { name: 'users', id: 'employer', data: { activeContractId: null } },
      { name: 'users', id: 'employee', data: { activeContractId: null } }
    ]);
    expect(committed).toBe(true);
  });

  test('cloud repository rejects lifecycle writes when a settlement lock is already held', async () => {
    const contract = {
      _id: 'contract_1',
      status: 'active',
      employerOpenid: 'employer',
      employeeOpenid: 'employee',
      pendingSettlementRequestId: 'request_1'
    };
    const transaction = {
      collection(name) {
        return {
          async add() {},
          doc(id) {
            return {
              async get() {
                if (name === 'contracts') return { data: contract };
                if (name === 'cycles') {
                  return { data: { _id: id, contractId: 'contract_1', status: 'open', checkinCount: 0 } };
                }
                return { data: null };
              },
              async update() {}
            };
          }
        };
      },
      async commit() {},
      async rollback() {}
    };
    const repository = new CloudDatabaseRepository({ startTransaction: async () => transaction });
    const request = {
      _id: 'request_2',
      contractId: 'contract_1',
      stageId: 'stage_1',
      days: 0,
      status: 'pending_employee'
    };

    await expect(repository.insertSettlementRequest(request))
      .rejects.toThrow('SETTLEMENT_REQUEST_PENDING');
    await expect(repository.insertBackfillCheckins({
      contractId: 'contract_1',
      stageId: 'stage_1',
      checkins: [{ _id: 'contract_1:2026-11-01', localDate: '2026-11-01' }]
    })).rejects.toThrow('SETTLEMENT_REQUEST_PENDING');
    await expect(repository.completeCheckin(
      { _id: 'challenge_1', usedAt: null },
      {
        _id: 'contract_1:2026-11-02',
        contractId: 'contract_1',
        cycleId: 'stage_1',
        employeeOpenid: 'employee',
        localDate: '2026-11-02',
        serverTime: '2026-11-02T01:00:00.000Z'
      }
    )).rejects.toThrow('SETTLEMENT_REQUEST_PENDING');
    await expect(repository.terminateContract({
      contractId: 'contract_1',
      stageId: 'stage_1',
      contractPatch: {},
      cyclePatch: {},
      employerOpenid: 'employer',
      employeeOpenid: 'employee'
    })).rejects.toThrow('SETTLEMENT_REQUEST_PENDING');
  });

  test('cloud repository paginates long check-in histories', async () => {
    const skipCalls = [];
    const firstPage = [{ _id: 'checkin-1' }, { _id: 'checkin-2' }];
    const secondPage = [{ _id: 'checkin-3' }];
    const db = {
      collection(name) {
        return {
          where(where) {
            return {
              orderBy(field, direction) {
                return {
                  limit(pageSize) {
                    return {
                      skip(offset) {
                        skipCalls.push({ name, where, field, direction, pageSize, offset });
                        return {
                          async get() {
                            return { data: offset === 0 ? firstPage : secondPage };
                          }
                        };
                      }
                    };
                  }
                };
              }
            };
          }
        };
      }
    };
    const repository = new CloudDatabaseRepository(db, { queryPageSize: 2 });

    await expect(repository.listCheckinsByContract('contract_1')).resolves.toHaveLength(3);
    expect(skipCalls.map((item) => item.offset)).toEqual([0, 2]);
  });

  test('memory repository enforces one active cooperation per participant', () => {
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
      inviteCode: null,
      totalAmount: 8000,
      targetDays: 26,
      startDate: '2026-11-11',
      homeLocation: { address: 'home', latitude: 31.2, longitude: 121.4 },
      radiusMeters: 300
    });
    repository.cycles.push({
      _id: 'cycle_1',
      contractId: 'contract_1',
      status: 'open'
    });

    const secondContract = {
      _id: 'contract_2',
      status: 'active',
      employerOpenid: 'employer',
      employeeOpenid: null,
      inviteCode: 'ABCDEFGH',
      totalAmount: 8000,
      targetDays: 26,
      startDate: '2026-11-11',
      homeLocation: { address: 'home', latitude: 31.2, longitude: 121.4 },
      radiusMeters: 300
    };
    const secondCycle = { _id: 'cycle_2', contractId: 'contract_2', status: 'open' };
    repository.contracts.push(secondContract);
    repository.cycles.push(secondCycle);
    expect(() => repository.createContractIfEmployerIdle({
      employerOpenid: 'employer',
      contract: secondContract,
      cycle: secondCycle
    })).toThrow('CONTRACT_EXISTS');
    expect(() => repository.bindEmployeeToUnboundContract({
      contractId: 'contract_2',
      expectedInviteCode: 'ABCDEFGH',
      employeeOpenid: 'employee'
    })).toThrow('EMPLOYEE_ALREADY_JOINED');
  });

  test('cloud repository creates a contract and updates its employer atomically', async () => {
    const user = { _id: 'employer', openid: 'employer', role: 'employer', activeContractId: null };
    const additions = [];
    const updates = [];
    let committed = false;
    const transaction = {
      collection(name) {
        return {
          async add({ data }) {
            additions.push({ name, data });
          },
          doc(id) {
            return {
              async get() {
                return { data: name === 'users' ? user : null };
              },
              async update({ data }) {
                updates.push({ name, id, data });
                Object.assign(user, data);
              }
            };
          }
        };
      },
      async commit() { committed = true; },
      async rollback() { committed = false; }
    };
    const repository = new CloudDatabaseRepository({
      startTransaction: async () => transaction
    });
    const contract = { _id: 'contract_1', status: 'active', employerOpenid: 'employer' };
    const cycle = { _id: 'cycle_1', contractId: 'contract_1', status: 'open' };

    const result = await repository.createContractIfEmployerIdle({
      employerOpenid: 'employer',
      contract,
      cycle
    });
    expect(result.user.activeContractId).toBe('contract_1');
    expect(additions).toEqual([
      { name: 'contracts', data: contract },
      { name: 'cycles', data: cycle }
    ]);
    expect(updates).toEqual([{
      name: 'users',
      id: 'employer',
      data: { activeContractId: 'contract_1' }
    }]);
    expect(committed).toBe(true);

    additions.length = 0;
    updates.length = 0;
    committed = false;
    await expect(repository.createContractIfEmployerIdle({
      employerOpenid: 'employer',
      contract: { ...contract, _id: 'contract_2' },
      cycle: { ...cycle, _id: 'cycle_2' }
    })).rejects.toThrow('CONTRACT_EXISTS');
    expect(additions).toEqual([]);
    expect(updates).toEqual([]);
    expect(committed).toBe(false);
  });
});
