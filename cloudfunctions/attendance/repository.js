'use strict';

class CloudDatabaseRepository {
  constructor(db) {
    this.db = db;
    this.storageType = 'cloud';
  }

  collection(name) {
    return this.db.collection(name);
  }

  async first(collection, where) {
    const result = await this.collection(collection).where(where).limit(1).get();
    return result.data[0] || null;
  }

  async findUser(openid) {
    return this.first('users', { openid });
  }

  async insertUser(user) {
    await this.collection('users').add({ data: { ...user, _id: user.openid } });
    return user;
  }

  async updateUser(openid, patch) {
    await this.collection('users').where({ openid }).update({ data: patch });
    return { ...(await this.findUser(openid)), ...patch };
  }

  async findActiveContractByParticipant(openid) {
    return (
      (await this.first('contracts', { status: 'active', employerOpenid: openid })) ||
      (await this.first('contracts', { status: 'active', employeeOpenid: openid }))
    );
  }

  async findContractByInviteCode(inviteCode) {
    return this.first('contracts', { inviteCode, status: 'active' });
  }

  async insertContract(contract) {
    await this.collection('contracts').add({ data: contract });
    return contract;
  }

  async updateContract(contractId, patch) {
    await this.collection('contracts').doc(contractId).update({ data: patch });
    const result = await this.collection('contracts').doc(contractId).get();
    return result.data;
  }

  async createContractIfEmployerIdle({ employerOpenid, contract, cycle }) {
    const transaction = await this.db.startTransaction();
    try {
      const userDoc = await transaction.collection('users').doc(employerOpenid).get();
      const user = userDoc.data;
      if (!user || user.role !== 'employer') {
        throw createRepositoryError('FORBIDDEN');
      }
      if (user.activeContractId) {
        throw createRepositoryError('CONTRACT_EXISTS');
      }
      await transaction.collection('contracts').add({ data: contract });
      await transaction.collection('cycles').add({ data: cycle });
      await transaction
        .collection('users')
        .doc(employerOpenid)
        .update({ data: { activeContractId: contract._id } });
      await transaction.commit();
      return {
        contract,
        cycle,
        user: { ...user, activeContractId: contract._id }
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async bindEmployeeToUnboundContract({ contractId, expectedInviteCode, employeeOpenid }) {
    return this.transitionUnboundContract({
      contractId,
      expectedInviteCode,
      employeeOpenid,
      contractPatch: {
        employeeOpenid,
        inviteCode: null
      }
    });
  }

  async updateUnboundContract({ contractId, cycleId, contractPatch, cyclePatch }) {
    return this.transitionUnboundContract({
      contractId,
      cycleId,
      contractPatch,
      cyclePatch
    });
  }

  async regenerateInviteForUnboundContract({ contractId, inviteCode, inviteExpiresAt }) {
    return this.transitionUnboundContract({
      contractId,
      contractPatch: {
        inviteCode,
        inviteExpiresAt
      }
    });
  }

  async cancelUnmatchedCooperation({ contractId, cycleId }) {
    return this.transitionUnboundContract({
      contractId,
      cycleId,
      contractPatch: {
        status: 'cancelled',
        inviteCode: null,
        inviteExpiresAt: null
      },
      cyclePatch: {
        status: 'cancelled'
      }
    });
  }

  async transitionUnboundContract({
    contractId,
    cycleId = '',
    expectedInviteCode = undefined,
    employeeOpenid = '',
    contractPatch = {},
    cyclePatch = {}
  }) {
    const transaction = await this.db.startTransaction();
    try {
      const activeContractId = contractId;
      const contractDoc = await transaction.collection('contracts').doc(contractId).get();
      const contract = contractDoc.data;
      if (!contract || contract.status !== 'active') {
        throw createRepositoryError('CONTRACT_NOT_FOUND');
      }
      if (contract.employeeOpenid) {
        throw createRepositoryError('CONTRACT_ALREADY_BOUND');
      }
      if (expectedInviteCode !== undefined && contract.inviteCode !== expectedInviteCode) {
        throw createRepositoryError('INVITE_NOT_FOUND');
      }
      let employeeUser = null;
      if (employeeOpenid) {
        const employeeDoc = await transaction.collection('users').doc(employeeOpenid).get();
        employeeUser = employeeDoc.data;
        if (!employeeUser || employeeUser.role !== 'employee') {
          throw createRepositoryError('FORBIDDEN');
        }
        if (employeeUser.activeContractId) {
          throw createRepositoryError('EMPLOYEE_ALREADY_JOINED');
        }
      }

      let cycle = null;
      if (cycleId) {
        const cycleDoc = await transaction.collection('cycles').doc(cycleId).get();
        cycle = cycleDoc.data;
        if (!cycle || cycle.contractId !== contractId || cycle.status !== 'open') {
          throw createRepositoryError('NO_OPEN_CYCLE');
        }
      }

      await transaction.collection('contracts').doc(contractId).update({ data: contractPatch });
      if (cycleId) {
        await transaction.collection('cycles').doc(cycleId).update({ data: cyclePatch });
      }
      if (employeeOpenid) {
        await transaction
          .collection('users')
          .doc(employeeOpenid)
          .update({ data: { activeContractId } });
      }
      await transaction.commit();
      return {
        contract: { ...contract, ...contractPatch },
        cycle: cycle ? { ...cycle, ...cyclePatch } : null,
        user: employeeUser
          ? { ...employeeUser, activeContractId }
          : null
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async findOpenCycle(contractId) {
    return this.first('cycles', { contractId, status: 'open' });
  }

  async insertCycle(cycle) {
    await this.collection('cycles').add({ data: cycle });
    return cycle;
  }

  async updateCycle(cycleId, patch) {
    await this.collection('cycles').doc(cycleId).update({ data: patch });
    return { _id: cycleId, ...patch };
  }

  async listCheckins(cycleId) {
    const result = await this.collection('checkins')
      .where({ cycleId })
      .orderBy('localDate', 'asc')
      .limit(1000)
      .get();
    return result.data;
  }

  async getCheckin(cycleId, localDate) {
    return this.first('checkins', { cycleId, localDate });
  }

  async getContractCheckin(contractId, localDate) {
    return this.first('checkins', { contractId, localDate });
  }

  async insertCheckin(checkin) {
    await this.collection('checkins').add({ data: checkin });
    return checkin;
  }

  async insertAttempt(attempt) {
    await this.collection('checkin_attempts').add({ data: attempt });
    return attempt;
  }

  async findChallengeByToken(token) {
    return this.first('challenges', { token });
  }

  async insertChallenge(challenge) {
    await this.collection('challenges').add({ data: challenge });
    return challenge;
  }

  async updateChallenge(challengeId, patch) {
    await this.collection('challenges').doc(challengeId).update({ data: patch });
    return { _id: challengeId, ...patch };
  }

  async completeCheckin(challenge, checkin) {
    const existing = await this.getContractCheckin(checkin.contractId, checkin.localDate);
    if (existing) {
      const error = new Error('DUPLICATE_CHECKIN');
      error.code = 'DUPLICATE_CHECKIN';
      throw error;
    }

    const transaction = await this.db.startTransaction();
    try {
      const cycleDoc = await transaction.collection('cycles').doc(checkin.cycleId).get();
      if (!cycleDoc.data || cycleDoc.data.status !== 'open') {
        const error = new Error('NO_OPEN_CYCLE');
        error.code = 'NO_OPEN_CYCLE';
        throw error;
      }
      const challengeDoc = await transaction.collection('challenges').doc(challenge._id).get();
      if (!challengeDoc.data || challengeDoc.data.usedAt) {
        const error = new Error('CHALLENGE_USED');
        error.code = 'CHALLENGE_USED';
        throw error;
      }
      await transaction.collection('checkins').add({ data: checkin });
      await transaction
        .collection('challenges')
        .doc(challenge._id)
        .update({ data: { usedAt: checkin.serverTime } });
      await transaction.commit();
      return checkin;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async listSettlements(contractId) {
    const result = await this.collection('settlements')
      .where({ contractId })
      .orderBy('settledAt', 'desc')
      .limit(100)
      .get();
    return result.data;
  }

  async findPendingSettlementRequest(contractId) {
    return (
      (await this.first('settlement_requests', {
        contractId,
        status: 'pending_employee'
      })) ||
      (await this.first('settlement_requests', {
        contractId,
        status: 'disputed'
      }))
    );
  }

  async findSettlementRequestById(requestId) {
    const result = await this.collection('settlement_requests').doc(requestId).get();
    return result.data || null;
  }

  async insertSettlementRequest(request) {
    await this.collection('settlement_requests').add({ data: request });
    return request;
  }

  async updateSettlementRequest(requestId, patch) {
    await this.collection('settlement_requests').doc(requestId).update({ data: patch });
    const result = await this.collection('settlement_requests').doc(requestId).get();
    return result.data;
  }


  async confirmSettlementRequestAndCreateNextStage({ request, settlement, closedStage, nextStage }) {
    const transaction = await this.db.startTransaction();
    try {
      const requestDoc = await transaction.collection('settlement_requests').doc(request._id).get();
      if (!requestDoc.data || requestDoc.data.status !== 'pending_employee') {
        const error = new Error('SETTLEMENT_REQUEST_NOT_PENDING');
        error.code = 'SETTLEMENT_REQUEST_NOT_PENDING';
        throw error;
      }

      const stageDoc = await transaction.collection('cycles').doc(closedStage._id).get();
      if (!stageDoc.data || stageDoc.data.status !== 'open') {
        const error = new Error('NO_OPEN_STAGE');
        error.code = 'NO_OPEN_STAGE';
        throw error;
      }

      await transaction
        .collection('settlement_requests')
        .doc(request._id)
        .update({
          data: {
            status: 'confirmed',
            employeeConfirmedAt: settlement.settledAt
          }
        });
      await transaction
        .collection('cycles')
        .doc(closedStage._id)
        .update({
          data: {
            status: 'settled',
            settledAt: closedStage.settledAt,
            settledDays: closedStage.settledDays,
            suggestedAmount: closedStage.suggestedAmount,
            paidAmount: closedStage.paidAmount,
            endLocalDate: closedStage.endLocalDate
          }
        });
      await transaction.collection('settlements').add({ data: settlement });
      await transaction.collection('cycles').add({ data: nextStage });
      await transaction.commit();
      return { settlement, nextStage };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}

function createRepositoryError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

module.exports = { CloudDatabaseRepository };
