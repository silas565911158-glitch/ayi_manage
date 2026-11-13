'use strict';

const emptyDatabase = () => ({
  users: [],
  contracts: [],
  cycles: [],
  checkins: [],
  checkin_attempts: [],
  challenges: [],
  settlements: [],
  settlement_requests: []
});

class MemoryRepository {
  constructor(initial) {
    this.storageType = 'local';
    this.users = initial.users || [];
    this.contracts = initial.contracts || [];
    this.cycles = initial.cycles || [];
    this.checkins = initial.checkins || [];
    this.checkin_attempts = initial.checkin_attempts || [];
    this.challenges = initial.challenges || [];
    this.settlements = initial.settlements || [];
    this.settlement_requests = initial.settlement_requests || [];
  }

  snapshot() {
    return {
      users: this.users,
      contracts: this.contracts,
      cycles: this.cycles,
      checkins: this.checkins,
      checkin_attempts: this.checkin_attempts,
      challenges: this.challenges,
      settlements: this.settlements,
      settlement_requests: this.settlement_requests
    };
  }

  findUser(openid) {
    return this.users.find((user) => user.openid === openid) || null;
  }

  insertUser(user) {
    if (this.findUser(user.openid)) throw new Error('USER_EXISTS');
    this.users.push(user);
    return user;
  }

  updateUser(openid, patch) {
    const user = this.findUser(openid);
    if (!user) throw new Error('USER_NOT_FOUND');
    Object.assign(user, patch);
    return user;
  }

  findActiveContractByParticipant(openid) {
    return (
      this.contracts.find(
        (contract) => contract.status === 'active' && (contract.employerOpenid === openid || contract.employeeOpenid === openid)
      ) || null
    );
  }

  listContractsForParticipant(openid) {
    return this.contracts
      .filter((contract) => contract.employerOpenid === openid || contract.employeeOpenid === openid)
      .sort((left, right) => {
        if (left.status === 'active') return -1;
        if (right.status === 'active') return 1;
        return new Date(right.endedAt || right.createdAt || 0) - new Date(left.endedAt || left.createdAt || 0);
      });
  }

  findContractByInviteCode(inviteCode) {
    return this.contracts.find((contract) => contract.inviteCode === inviteCode) || null;
  }

  insertContract(contract) {
    if (this.contracts.some((item) => item._id === contract._id)) throw new Error('CONTRACT_EXISTS');
    this.contracts.push(contract);
    return contract;
  }

  createContractIfEmployerIdle({ employerOpenid, contract, cycle }) {
    const user = this.findUser(employerOpenid);
    if (!user || user.role !== 'employer') {
      const error = new Error('FORBIDDEN');
      error.code = 'FORBIDDEN';
      throw error;
    }
    if (user.activeContractId || this.findActiveContractByParticipant(employerOpenid)) {
      const error = new Error('CONTRACT_EXISTS');
      error.code = 'CONTRACT_EXISTS';
      throw error;
    }
    this.insertContract(contract);
    this.insertCycle(cycle);
    this.updateUser(employerOpenid, { activeContractId: contract._id });
    return { contract, cycle, user: this.findUser(employerOpenid) };
  }

  updateContract(contractId, patch) {
    const contract = this.contracts.find((item) => item._id === contractId);
    if (!contract) throw new Error('CONTRACT_NOT_FOUND');
    Object.assign(contract, patch);
    return contract;
  }

  bindEmployeeToUnboundContract({ contractId, expectedInviteCode, employeeOpenid }) {
    const contract = this.contracts.find((item) => item._id === contractId);
    this.ensureContractCanBeChanged(contract, expectedInviteCode);
    const user = this.findUser(employeeOpenid);
    if (!user || user.role !== 'employee') {
      const error = new Error('FORBIDDEN');
      error.code = 'FORBIDDEN';
      throw error;
    }
    if (user.activeContractId || this.findActiveContractByParticipant(employeeOpenid)) {
      const error = new Error('EMPLOYEE_ALREADY_JOINED');
      error.code = 'EMPLOYEE_ALREADY_JOINED';
      throw error;
    }
    Object.assign(contract, {
      employeeOpenid,
      inviteCode: null
    });
    this.updateUser(employeeOpenid, { activeContractId: contract._id });
    return { contract };
  }

  updateUnboundContract({ contractId, cycleId, contractPatch, cyclePatch }) {
    const contract = this.contracts.find((item) => item._id === contractId);
    this.ensureContractCanBeChanged(contract);
    const cycle = this.cycles.find((item) => item._id === cycleId);
    if (!cycle || cycle.contractId !== contractId || cycle.status !== 'open') {
      const error = new Error('NO_OPEN_CYCLE');
      error.code = 'NO_OPEN_CYCLE';
      throw error;
    }
    Object.assign(contract, contractPatch);
    Object.assign(cycle, cyclePatch);
    return { contract, cycle };
  }

  regenerateInviteForUnboundContract({ contractId, inviteCode, inviteExpiresAt }) {
    const contract = this.contracts.find((item) => item._id === contractId);
    this.ensureContractCanBeChanged(contract);
    Object.assign(contract, { inviteCode, inviteExpiresAt });
    return { contract };
  }

  cancelUnmatchedCooperation({ contractId, cycleId }) {
    const contract = this.contracts.find((item) => item._id === contractId);
    this.ensureContractCanBeChanged(contract);
    let cycle = null;
    if (cycleId) {
      cycle = this.cycles.find((item) => item._id === cycleId);
      if (!cycle || cycle.contractId !== contractId || cycle.status !== 'open') {
        const error = new Error('NO_OPEN_CYCLE');
        error.code = 'NO_OPEN_CYCLE';
        throw error;
      }
      Object.assign(cycle, { status: 'cancelled' });
    }
    Object.assign(contract, {
      status: 'cancelled',
      inviteCode: null,
      inviteExpiresAt: null
    });
    return { contract, cycle };
  }

  ensureContractCanBeChanged(contract, expectedInviteCode) {
    if (!contract || contract.status !== 'active') {
      const error = new Error('CONTRACT_NOT_FOUND');
      error.code = 'CONTRACT_NOT_FOUND';
      throw error;
    }
    if (contract.employeeOpenid) {
      const error = new Error('CONTRACT_ALREADY_BOUND');
      error.code = 'CONTRACT_ALREADY_BOUND';
      throw error;
    }
    if (expectedInviteCode !== undefined && contract.inviteCode !== expectedInviteCode) {
      const error = new Error('INVITE_NOT_FOUND');
      error.code = 'INVITE_NOT_FOUND';
      throw error;
    }
  }

  findOpenCycle(contractId) {
    return this.cycles.find((cycle) => cycle.contractId === contractId && cycle.status === 'open') || null;
  }

  insertCycle(cycle) {
    if (this.cycles.some((item) => item._id === cycle._id)) throw new Error('CYCLE_EXISTS');
    this.cycles.push(cycle);
    return cycle;
  }

  updateCycle(cycleId, patch) {
    const cycle = this.cycles.find((item) => item._id === cycleId);
    if (!cycle) throw new Error('CYCLE_NOT_FOUND');
    Object.assign(cycle, patch);
    return cycle;
  }

  listCheckins(cycleId) {
    return this.checkins
      .filter((checkin) => checkin.cycleId === cycleId)
      .sort((left, right) => String(left.localDate).localeCompare(String(right.localDate)));
  }

  listCheckinsByContract(contractId) {
    return this.checkins
      .filter((checkin) => checkin.contractId === contractId)
      .sort((left, right) => String(left.localDate).localeCompare(String(right.localDate)));
  }

  getCheckin(cycleId, localDate) {
    return this.checkins.find((checkin) => checkin.cycleId === cycleId && checkin.localDate === localDate) || null;
  }

  getContractCheckin(contractId, localDate) {
    return this.checkins.find((checkin) => checkin.contractId === contractId && checkin.localDate === localDate) || null;
  }

  insertCheckin(checkin) {
    if (this.getCheckin(checkin.cycleId, checkin.localDate)) throw new Error('DUPLICATE_CHECKIN');
    this.checkins.push(checkin);
    return checkin;
  }

  insertBackfillCheckins({ contractId, stageId, checkins }) {
    const contract = this.contracts.find((item) => item._id === contractId);
    if (!contract || contract.status !== 'active' || !contract.employeeOpenid) {
      const error = new Error('CONTRACT_NOT_BOUND');
      error.code = 'CONTRACT_NOT_BOUND';
      throw error;
    }
    const stage = this.cycles.find((item) => item._id === stageId);
    if (!stage || stage.contractId !== contractId || stage.status !== 'open') {
      const error = new Error('NO_OPEN_STAGE');
      error.code = 'NO_OPEN_STAGE';
      throw error;
    }
    checkins.forEach((checkin) => {
      if (this.getContractCheckin(contractId, checkin.localDate)) {
        const error = new Error('CHECKIN_ALREADY_EXISTS');
        error.code = 'CHECKIN_ALREADY_EXISTS';
        throw error;
      }
    });
    checkins.forEach((checkin) => this.insertCheckin(checkin));
    return checkins;
  }

  insertAttempt(attempt) {
    const record = { ...attempt, _id: attempt._id };
    this.checkin_attempts.push(record);
    return record;
  }

  findChallengeByToken(token) {
    return this.challenges.find((challenge) => challenge.token === token) || null;
  }

  insertChallenge(challenge) {
    if (this.findChallengeByToken(challenge.token)) throw new Error('CHALLENGE_EXISTS');
    this.challenges.push(challenge);
    return challenge;
  }

  updateChallenge(challengeId, patch) {
    const challenge = this.challenges.find((item) => item._id === challengeId);
    if (!challenge) throw new Error('CHALLENGE_NOT_FOUND');
    Object.assign(challenge, patch);
    return challenge;
  }

  completeCheckin(challenge, checkin) {
    if (challenge.usedAt) {
      const error = new Error('CHALLENGE_USED');
      error.code = 'CHALLENGE_USED';
      throw error;
    }
    if (this.getContractCheckin(checkin.contractId, checkin.localDate)) {
      const error = new Error('DUPLICATE_CHECKIN');
      error.code = 'DUPLICATE_CHECKIN';
      throw error;
    }
    this.insertCheckin(checkin);
    this.updateChallenge(challenge._id, { usedAt: checkin.serverTime });
    return checkin;
  }

  listSettlements(contractId) {
    return this.settlements
      .filter((settlement) => settlement.contractId === contractId)
      .sort((left, right) => new Date(right.settledAt) - new Date(left.settledAt));
  }

  findPendingSettlementRequest(contractId) {
    return (
      this.settlement_requests.find(
        (request) =>
          request.contractId === contractId &&
          (request.status === 'pending_employee' || request.status === 'disputed')
      ) || null
    );
  }

  findSettlementRequestById(requestId) {
    return this.settlement_requests.find((request) => request._id === requestId) || null;
  }

  insertSettlementRequest(request) {
    if (this.findSettlementRequestById(request._id)) throw new Error('SETTLEMENT_REQUEST_EXISTS');
    this.settlement_requests.push(request);
    return request;
  }

  updateSettlementRequest(requestId, patch) {
    const request = this.findSettlementRequestById(requestId);
    if (!request) throw new Error('SETTLEMENT_REQUEST_NOT_FOUND');
    Object.assign(request, patch);
    return request;
  }

  confirmSettlementRequestAndCreateNextStage({ request, settlement, closedStage, nextStage }) {
    const currentRequest = this.findSettlementRequestById(request._id);
    if (!currentRequest || currentRequest.status !== 'pending_employee') {
      const error = new Error('SETTLEMENT_REQUEST_NOT_PENDING');
      error.code = 'SETTLEMENT_REQUEST_NOT_PENDING';
      throw error;
    }
    const stage = this.cycles.find((item) => item._id === closedStage._id);
    if (!stage || stage.status !== 'open') {
      const error = new Error('NO_OPEN_STAGE');
      error.code = 'NO_OPEN_STAGE';
      throw error;
    }

    Object.assign(currentRequest, {
      status: 'confirmed',
      employeeConfirmedAt: settlement.settledAt
    });
    Object.assign(stage, {
      status: closedStage.status,
      settledAt: closedStage.settledAt,
      settledDays: closedStage.settledDays,
      suggestedAmount: closedStage.suggestedAmount,
      paidAmount: closedStage.paidAmount,
      endLocalDate: closedStage.endLocalDate
    });
    this.settlements.push(settlement);
    this.insertCycle(nextStage);
    return { settlementRequest: currentRequest, settlement, nextStage };
  }

  terminateContract({ contractId, stageId, contractPatch, cyclePatch, employerOpenid, employeeOpenid }) {
    const contract = this.contracts.find((item) => item._id === contractId);
    if (!contract || contract.status !== 'active' || contract.employerOpenid !== employerOpenid) {
      const error = new Error('CONTRACT_NOT_FOUND');
      error.code = 'CONTRACT_NOT_FOUND';
      throw error;
    }
    if (!contract.employeeOpenid || contract.employeeOpenid !== employeeOpenid) {
      const error = new Error('CONTRACT_NOT_BOUND');
      error.code = 'CONTRACT_NOT_BOUND';
      throw error;
    }
    const stage = this.cycles.find((item) => item._id === stageId);
    if (!stage || stage.contractId !== contractId || stage.status !== 'open') {
      const error = new Error('NO_OPEN_STAGE');
      error.code = 'NO_OPEN_STAGE';
      throw error;
    }
    Object.assign(contract, contractPatch);
    Object.assign(stage, cyclePatch);
    this.updateUser(employerOpenid, { activeContractId: null });
    this.updateUser(employeeOpenid, { activeContractId: null });
    return { contract, stage };
  }

}

module.exports = { MemoryRepository, emptyDatabase };
