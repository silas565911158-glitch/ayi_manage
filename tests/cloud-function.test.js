const fs = require('fs');
const path = require('path');
const { MemoryRepository, emptyDatabase } = require('../shared/memory-repository');

describe('attendance cloud function', () => {
  test('packages the canonical shared business logic without divergence', () => {
    const files = ['domain.js', 'errors.js', 'backend-core.js'];
    for (const file of files) {
      const canonical = fs.readFileSync(path.join(__dirname, '..', 'shared', file), 'utf8');
      const deployed = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'attendance', file), 'utf8');
      expect(deployed).toBe(canonical);
    }
  });

  test('dispatches with WeChat OpenID and returns normalized API responses', async () => {
    const { createHandler } = require('../cloudfunctions/attendance/index');
    const repository = new MemoryRepository(emptyDatabase());
    const cloudSDK = {
      init: jest.fn(),
      getWXContext: () => ({ OPENID: 'openid-server' }),
      database: () => repository
    };
    const handler = createHandler({
      cloudSDK,
      repositoryFactory: () => repository,
      now: () => new Date('2026-11-11T01:00:00.000Z')
    });

    const boot = await handler({ action: 'bootstrapUser', payload: { role: 'employer' } });
    expect(boot).toMatchObject({ ok: true, data: { user: { openid: 'openid-server', role: 'employer' } } });

    const unknown = await handler({ action: 'settleCycle' });
    expect(unknown).toMatchObject({ ok: false, code: 'UNKNOWN_ACTION' });
  });

  test('does not depend on MemoryRepository internals when joining a contract', async () => {
    const { createHandler } = require('../cloudfunctions/attendance/index');
    const now = new Date('2026-11-11T01:00:00.000Z');
    const rows = {
      user: { openid: 'openid-server', role: 'employee', nickname: '', activeContractId: null },
      contract: {
        _id: 'contract_1',
        employerOpenid: 'employer',
        employeeOpenid: null,
        totalAmount: 8000,
        targetDays: 26,
        startDate: '2026-11-11',
        status: 'active',
        homeLocation: { latitude: 31.2, longitude: 121.4, address: 'home' },
        radiusMeters: 300,
        inviteCode: 'ABCDEFGH',
        inviteExpiresAt: '2026-11-12T01:00:00.000Z'
      },
      cycle: { _id: 'contract_1_1', contractId: 'contract_1', cycleIndex: 1, status: 'open' }
    };
    const repository = {
      findUser: async () => rows.user,
      insertUser: async () => {},
      updateUser: async () => rows.user,
      findActiveContractByParticipant: async () => null,
      findContractByInviteCode: async () => rows.contract,
      findOpenCycle: async () => rows.cycle,
      bindEmployeeToUnboundContract: async () => ({
        contract: { ...rows.contract, employeeOpenid: 'openid-server', inviteCode: null }
      })
    };
    const cloudSDK = {
      init: () => {},
      getWXContext: () => ({ OPENID: 'openid-server' }),
      database: () => repository
    };
    const handler = createHandler({ cloudSDK, repositoryFactory: () => repository, now: () => now });
    const result = await handler({ action: 'joinContract', payload: { inviteCode: 'ABCDEFGH' } });
    expect(result).toMatchObject({ ok: true, data: { contract: { employeeBound: true } } });
  });

  test('adds temporary URLs to private transfer proofs', async () => {
    const { addTemporaryTransferProofUrls } = require('../cloudfunctions/attendance/index');
    const cloudSDK = {
      getTempFileURL: async ({ fileList }) => ({
        fileList: fileList.map((fileId) => ({
          fileID: fileId,
          tempFileURL: `https://temp.example/${encodeURIComponent(fileId)}`
        }))
      })
    };
    const data = {
      pendingSettlement: {
        transferProofs: [{ fileId: 'cloud://env/proof-1.jpg' }]
      },
      settlements: [
        { transferProofs: [{ fileId: 'cloud://env/proof-2.jpg' }] },
        { transferProofs: [] }
      ]
    };

    await addTemporaryTransferProofUrls(data, cloudSDK);

    expect(data.pendingSettlement.transferProofs[0].temporaryUrl)
      .toBe('https://temp.example/cloud%3A%2F%2Fenv%2Fproof-1.jpg');
    expect(data.settlements[0].transferProofs[0].temporaryUrl)
      .toBe('https://temp.example/cloud%3A%2F%2Fenv%2Fproof-2.jpg');
  });

  test('keeps transfer proofs available when temporary URL generation is unavailable', async () => {
    const { addTemporaryTransferProofUrls } = require('../cloudfunctions/attendance/index');
    const data = {
      pendingSettlement: {
        transferProofs: [{ fileId: 'cloud://env/proof.jpg' }]
      }
    };

    await addTemporaryTransferProofUrls(data, undefined);

    expect(data.pendingSettlement.transferProofs[0]).toEqual({
      fileId: 'cloud://env/proof.jpg'
    });
  });
});
