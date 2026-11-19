'use strict';

class CloudDatabaseRepository {
  constructor(db, { queryPageSize = 1000, contractPageSize = 100 } = {}) {
    this.db = db;
    this.storageType = 'cloud';
    this.queryPageSize = queryPageSize;
    this.contractPageSize = contractPageSize;
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

  async listContractsForParticipant(openid) {
    const [asEmployer, asEmployee] = await Promise.all([
      this.listDocuments('contracts', { employerOpenid: openid }, null, 'asc', this.contractPageSize),
      this.listDocuments('contracts', { employeeOpenid: openid }, null, 'asc', this.contractPageSize)
    ]);
    const unique = new Map();
    [...asEmployer, ...asEmployee].forEach((contract) => unique.set(contract._id, contract));
    return Array.from(unique.values()).sort((left, right) => {
      if (left.status === 'active') return -1;
      if (right.status === 'active') return 1;
      return new Date(right.endedAt || right.createdAt || 0) - new Date(left.endedAt || left.createdAt || 0);
    });
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

  async cancelUnmatchedCooperation({ contractId, cycleId, employerOpenid }) {
    return this.transitionUnboundContract({
      contractId,
      cycleId,
      releaseEmployerOpenid: employerOpenid,
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
    releaseEmployerOpenid = '',
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
      if (releaseEmployerOpenid) {
        const employerDoc = await transaction.collection('users').doc(releaseEmployerOpenid).get();
        if (
          !employerDoc.data ||
          employerDoc.data.role !== 'employer' ||
          employerDoc.data.activeContractId !== contractId
        ) {
          throw createRepositoryError('CONTRACT_NOT_FOUND');
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
      if (releaseEmployerOpenid) {
        await transaction
          .collection('users')
          .doc(releaseEmployerOpenid)
          .update({ data: { activeContractId: null } });
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
    return this.listDocuments('checkins', { cycleId }, 'localDate', 'asc', this.queryPageSize);
  }

  async listCheckinsByContract(contractId) {
    return this.listDocuments('checkins', { contractId }, 'localDate', 'asc', this.queryPageSize);
  }

  async getCheckin(cycleId, localDate) {
    return this.first('checkins', { cycleId, localDate });
  }

  async getContractCheckin(contractId, localDate) {
    return this.first('checkins', { contractId, localDate });
  }

  async getEmployeeCheckinByDate(employeeOpenid, localDate) {
    return this.first('checkins', { employeeOpenid, localDate });
  }

  async listEmployeeCheckinsBetween(employeeOpenid, startLocalDate, endLocalDate) {
    const command = this.db.command;
    const where = command
      ? {
        employeeOpenid,
        localDate: command.gte(startLocalDate).and(command.lte(endLocalDate))
      }
      : {
        employeeOpenid,
        localDate: { $gte: startLocalDate, $lte: endLocalDate }
      };
    return this.listDocuments('checkins', where, 'localDate', 'asc', this.queryPageSize);
  }

  async insertCheckin(checkin) {
    await this.collection('checkins').add({ data: checkin });
    return checkin;
  }

  async insertBackfillCheckins({ contractId, stageId, checkins }) {
    const transaction = await this.db.startTransaction();
    try {
      const contractDoc = await transaction.collection('contracts').doc(contractId).get();
      const contract = contractDoc.data;
      if (!contract || contract.status !== 'active' || !contract.employeeOpenid) {
        throw createRepositoryError('CONTRACT_NOT_BOUND');
      }
      if (contract.pendingSettlementRequestId) {
        throw createRepositoryError('SETTLEMENT_REQUEST_PENDING');
      }
      const stageDoc = await transaction.collection('cycles').doc(stageId).get();
      const stage = stageDoc.data;
      if (!stage || stage.contractId !== contractId || stage.status !== 'open') {
        throw createRepositoryError('NO_OPEN_STAGE');
      }
      for (const checkin of checkins) {
        const existing = await this.getOptionalTransactionDoc(transaction, 'checkins', checkin._id);
        if (existing) throw createRepositoryError('CHECKIN_ALREADY_EXISTS');
      }
      for (const checkin of checkins) {
        await transaction.collection('checkins').add({ data: checkin });
      }
      const earliestBackfill = checkins[0].localDate;
      const currentStart = stage.startLocalDate || null;
      const nextStart = !currentStart || earliestBackfill < currentStart
        ? earliestBackfill
        : currentStart;
      await transaction
        .collection('cycles')
        .doc(stageId)
        .update({
          data: {
            startLocalDate: nextStart,
            checkinCount: (Number(stage.checkinCount) || 0) + checkins.length
          }
        });
      await transaction.commit();
      return checkins;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async insertAttempt(attempt) {
    await this.collection('checkin_attempts').add({ data: attempt });
    return attempt;
  }

  async getOptionalTransactionDoc(transaction, collectionName, documentId) {
    try {
      const result = await transaction.collection(collectionName).doc(documentId).get();
      return result.data || null;
    } catch (error) {
      if (/document with _id .+ does not exist/i.test(error.message || '')) return null;
      throw error;
    }
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
    const transaction = await this.db.startTransaction();
    try {
      const contractDoc = await transaction.collection('contracts').doc(checkin.contractId).get();
      const contract = contractDoc.data;
      if (
        !contract ||
        contract.status !== 'active' ||
        contract.employeeOpenid !== checkin.employeeOpenid
      ) {
        throw createRepositoryError('CONTRACT_NOT_BOUND');
      }
      if (contract.pendingSettlementRequestId) {
        throw createRepositoryError('SETTLEMENT_REQUEST_PENDING');
      }
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
      const existingCheckin = await this.getOptionalTransactionDoc(
        transaction,
        'checkins',
        checkin._id
      );
      if (existingCheckin) {
        throw createRepositoryError('CHECKIN_ALREADY_EXISTS');
      }
      await transaction.collection('checkins').add({ data: checkin });
      await transaction
        .collection('challenges')
        .doc(challenge._id)
        .update({ data: { usedAt: checkin.serverTime } });
      await transaction
        .collection('cycles')
        .doc(checkin.cycleId)
        .update({ data: { checkinCount: (Number(cycleDoc.data.checkinCount) || 0) + 1 } });
      await transaction.commit();
      return checkin;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async listSettlements(contractId) {
    return this.listDocuments('settlements', { contractId }, 'settledAt', 'desc', this.contractPageSize);
  }

  async listDocuments(collectionName, where, orderField, orderDirection, pageSize) {
    const documents = [];
    let offset = 0;
    let page = [];
    do {
      let query = this.collection(collectionName).where(where);
      if (orderField) query = query.orderBy(orderField, orderDirection);
      const result = await query.limit(pageSize).skip(offset).get();
      page = Array.isArray(result.data) ? result.data : [];
      documents.push(...page);
      offset += page.length;
    } while (page.length === pageSize);
    return documents;
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
    const transaction = await this.db.startTransaction();
    try {
      const contractDoc = await transaction.collection('contracts').doc(request.contractId).get();
      const contract = contractDoc.data;
      if (!contract || contract.status !== 'active' || !contract.employeeOpenid) {
        throw createRepositoryError('CONTRACT_NOT_BOUND');
      }
      if (contract.pendingSettlementRequestId) {
        throw createRepositoryError('SETTLEMENT_REQUEST_PENDING');
      }
      const stageDoc = await transaction.collection('cycles').doc(request.stageId).get();
      const stage = stageDoc.data;
      if (!stage || stage.contractId !== request.contractId || stage.status !== 'open') {
        throw createRepositoryError('NO_OPEN_STAGE');
      }
      if (!Number.isFinite(Number(stage.checkinCount)) || Number(stage.checkinCount) !== Number(request.days)) {
        throw createRepositoryError('SETTLEMENT_STAGE_CHANGED');
      }
      await transaction.collection('settlement_requests').add({ data: request });
      await transaction
        .collection('contracts')
        .doc(request.contractId)
        .update({ data: { pendingSettlementRequestId: request._id } });
      await transaction.commit();
      return request;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async transitionSettlementRequest({
    requestId,
    expectedStatuses,
    patch,
    clearContractLock = false
  }) {
    const transaction = await this.db.startTransaction();
    try {
      const requestDoc = await transaction.collection('settlement_requests').doc(requestId).get();
      const request = requestDoc.data;
      if (!request || !expectedStatuses.includes(request.status)) {
        throw createRepositoryError('SETTLEMENT_REQUEST_NOT_PENDING');
      }
      const contractDoc = await transaction.collection('contracts').doc(request.contractId).get();
      const contract = contractDoc.data;
      if (
        !contract ||
        contract.status !== 'active' ||
        contract.pendingSettlementRequestId !== requestId
      ) {
        throw createRepositoryError('SETTLEMENT_REQUEST_NOT_PENDING');
      }
      await transaction.collection('settlement_requests').doc(requestId).update({ data: patch });
      if (clearContractLock) {
        await transaction
          .collection('contracts')
          .doc(request.contractId)
          .update({ data: { pendingSettlementRequestId: null } });
      }
      await transaction.commit();
      return { ...request, ...patch };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
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

      const contractDoc = await transaction.collection('contracts').doc(request.contractId).get();
      const contract = contractDoc.data;
      if (
        !contract ||
        contract.status !== 'active' ||
        contract.pendingSettlementRequestId !== request._id
      ) {
        throw createRepositoryError('SETTLEMENT_REQUEST_NOT_PENDING');
      }

      const stageDoc = await transaction.collection('cycles').doc(closedStage._id).get();
      if (!stageDoc.data || stageDoc.data.status !== 'open') {
        const error = new Error('NO_OPEN_STAGE');
        error.code = 'NO_OPEN_STAGE';
        throw error;
      }
      if (
        !Number.isFinite(Number(stageDoc.data.checkinCount)) ||
        Number(stageDoc.data.checkinCount) !== Number(request.days)
      ) {
        throw createRepositoryError('SETTLEMENT_STAGE_CHANGED');
      }

      await transaction
        .collection('contracts')
        .doc(request.contractId)
        .update({ data: { pendingSettlementRequestId: null } });

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

  async terminateContract({
    contractId,
    stageId,
    contractPatch,
    cyclePatch,
    employerOpenid,
    employeeOpenid
  }) {
    const transaction = await this.db.startTransaction();
    try {
      const contractDoc = await transaction.collection('contracts').doc(contractId).get();
      const contract = contractDoc.data;
      if (!contract || contract.status !== 'active' || contract.employerOpenid !== employerOpenid) {
        throw createRepositoryError('CONTRACT_NOT_FOUND');
      }
      if (!contract.employeeOpenid || contract.employeeOpenid !== employeeOpenid) {
        throw createRepositoryError('CONTRACT_NOT_BOUND');
      }
      const stageDoc = await transaction.collection('cycles').doc(stageId).get();
      const stage = stageDoc.data;
      if (!stage || stage.contractId !== contractId || stage.status !== 'open') {
        throw createRepositoryError('NO_OPEN_STAGE');
      }
      if (contract.pendingSettlementRequestId) {
        throw createRepositoryError('SETTLEMENT_REQUEST_PENDING');
      }
      if (Number(stage.checkinCount) !== 0) {
        throw createRepositoryError('SETTLE_BEFORE_TERMINATION');
      }
      await transaction.collection('contracts').doc(contractId).update({ data: contractPatch });
      await transaction.collection('cycles').doc(stageId).update({ data: cyclePatch });
      await transaction.collection('users').doc(employerOpenid).update({ data: { activeContractId: null } });
      await transaction.collection('users').doc(employeeOpenid).update({ data: { activeContractId: null } });
      await transaction.commit();
      return {
        contract: { ...contract, ...contractPatch },
        stage: { ...stage, ...cyclePatch }
      };
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
