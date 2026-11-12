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
