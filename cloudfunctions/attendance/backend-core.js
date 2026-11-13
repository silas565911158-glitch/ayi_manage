'use strict';

const {
  calculateSettlement,
  createChallengeToken,
  createId,
  createInviteCode,
  evaluateCheckin,
  roundMoney,
  shanghaiStartOfDay,
  toShanghaiLocalDate,
  validateContractInput
} = require('./domain');
const { BusinessError } = require('./errors');

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 2 * 60 * 1000;

async function handleAction({ action, payload = {}, openid, now = new Date(), repository }) {
  if (!openid) throw new BusinessError('UNAUTHENTICATED', '缺少用户身份');
  if (!repository) throw new BusinessError('BACKEND_UNAVAILABLE', '后端存储不可用');

  switch (action) {
    case 'bootstrapUser':
      return bootstrapUser({ payload, openid, now, repository });
    case 'createContract':
      return createContract({ payload, openid, now, repository });
    case 'updateContract':
      return updateContract({ payload, openid, now, repository });
    case 'joinContract':
      return joinContract({ payload, openid, now, repository });
    case 'previewInvite':
      return previewInvite({ payload, openid, now, repository });
    case 'regenerateInviteCode':
      return regenerateInviteCode({ openid, now, repository });
    case 'resetUnmatchedCooperation':
      return resetUnmatchedCooperation({ openid, repository });
    case 'getCurrentState':
      return getCurrentState({ openid, now, repository });
    case 'createCheckinChallenge':
      return createCheckinChallenge({ openid, now, repository });
    case 'submitCheckin':
      return submitCheckin({ payload, openid, now, repository });
    case 'createBackfillCheckins':
      return createBackfillCheckins({ payload, openid, now, repository });
    case 'createSettlementRequest':
      return createSettlementRequest({ payload, openid, now, repository });
    case 'confirmSettlementRequest':
      return confirmSettlementRequest({ openid, now, repository });
    case 'disputeSettlementRequest':
      return disputeSettlementRequest({ payload, openid, now, repository });
    case 'cancelSettlementRequest':
      return cancelSettlementRequest({ openid, now, repository });
    case 'listHistory':
      return listHistory({ openid, repository });
    case 'terminateContract':
      return terminateContract({ payload, openid, now, repository });
    default:
      throw new BusinessError('UNKNOWN_ACTION', `未知操作：${action}`);
  }
}

async function requireUser(repository, openid) {
  const user = await repository.findUser(openid);
  if (!user) throw new BusinessError('USER_NOT_FOUND', '请先选择角色');
  return user;
}

async function requireRole(repository, openid, role) {
  const user = await requireUser(repository, openid);
  if (user.role !== role) throw new BusinessError('FORBIDDEN', '当前角色无权执行此操作');
  return user;
}

async function bootstrapUser({ payload, openid, now, repository }) {
  const role = payload.role;
  if (role !== 'employer' && role !== 'employee') throw new BusinessError('INVALID_ROLE', '角色无效');
  const existing = await repository.findUser(openid);
  if (!existing) {
    const user = {
      openid,
      role,
      nickname: payload.nickname || '',
      activeContractId: null,
      createdAt: now.toISOString()
    };
    await repository.insertUser(user);
    return { user: publicUser(user) };
  }
  if (existing.role !== role) {
    const activeContract = await repository.findActiveContractByParticipant(openid);
    if (activeContract) {
      throw new BusinessError('ROLE_ALREADY_SET', '已有合作，不能更换身份');
    }
    await repository.updateUser(openid, { role });
  }
  const currentUser = await repository.findUser(openid);
  if (payload.nickname && payload.nickname !== currentUser.nickname) {
    await repository.updateUser(openid, { nickname: payload.nickname });
  }
  return { user: publicUser(await repository.findUser(openid)) };
}

function publicUser(user) {
  return { openid: user.openid, role: user.role, nickname: user.nickname, activeContractId: user.activeContractId };
}

function publicCheckin(checkin) {
  return {
    localDate: checkin.localDate,
    serverTime: checkin.serverTime,
    source: checkin.source || 'employee_checkin',
    workTime: checkin.workTime || checkin.serverTime,
    reason: checkin.reason || checkin.backfillReason || null
  };
}

function publicCalendarCheckin(checkin) {
  return {
    localDate: checkin.localDate,
    time: checkin.workTime || checkin.serverTime,
    source: checkin.source || 'employee_checkin'
  };
}

async function createContract({ payload, openid, now, repository }) {
  await requireRole(repository, openid, 'employer');
  if (await repository.findActiveContractByParticipant(openid)) {
    throw new BusinessError('CONTRACT_EXISTS', '已有进行中的合同');
  }
  const input = normalizeDomainError(() => validateContractInput(payload));
  const contractId = createId('contract', now);
  const inviteCode = await createNonconflictingInviteCode(repository);

  const contract = {
    _id: contractId,
    employerOpenid: openid,
    employeeOpenid: null,
    totalAmount: input.totalAmount,
    targetDays: input.targetDays,
    startDate: input.startDate,
    status: 'active',
    homeLocation: input.homeLocation,
    radiusMeters: input.radiusMeters,
    inviteCode,
    inviteExpiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
    createdAt: now.toISOString()
  };
  const cycle = {
    _id: `${contractId}_1`,
    contractId,
    cycleIndex: 1,
    status: 'open',
    startedAt: shanghaiStartOfDay(input.startDate).toISOString(),
    startLocalDate: input.startDate,
    settledAt: null,
    settledDays: null,
    settledAmount: null
  };
  const created = await normalizeRepositoryError(() =>
    repository.createContractIfEmployerIdle({
      employerOpenid: openid,
      contract,
      cycle
    })
  );

  return {
    contract: publicContract(created.contract),
    cycle: created.cycle,
    inviteCode,
    inviteExpiresAt: contract.inviteExpiresAt
  };
}

async function joinContract({ payload, openid, now, repository }) {
  await requireRole(repository, openid, 'employee');
  const active = await repository.findActiveContractByParticipant(openid);
  if (active) throw new BusinessError('EMPLOYEE_ALREADY_JOINED', '你已加入合同');
  const contract = await findAvailableInvite(payload.inviteCode, now, repository);
  const inviteCode = String(payload.inviteCode).trim().toUpperCase();

  const { contract: updated } = await normalizeRepositoryError(() =>
    repository.bindEmployeeToUnboundContract({
      contractId: contract._id,
      expectedInviteCode: inviteCode,
      employeeOpenid: openid
    })
  );
  return { contract: publicContract(updated), cycle: await repository.findOpenCycle(contract._id) };
}

async function previewInvite({ payload, openid, now, repository }) {
  await requireRole(repository, openid, 'employee');
  const active = await repository.findActiveContractByParticipant(openid);
  if (active) throw new BusinessError('EMPLOYEE_ALREADY_JOINED', '你已加入合同');
  const contract = await findAvailableInvite(payload.inviteCode, now, repository);
  return {
    invite: {
      totalAmount: Number(contract.totalAmount),
      targetDays: Number(contract.targetDays),
      dailySalary: calculateSettlement({
        totalAmount: contract.totalAmount,
        targetDays: contract.targetDays,
        days: 1
      }).dailySalary,
      startDate: contract.startDate,
      address: contract.homeLocation.address,
      radiusMeters: Number(contract.radiusMeters),
      inviteExpiresAt: contract.inviteExpiresAt
    }
  };
}

async function findAvailableInvite(rawInviteCode, now, repository) {
  const inviteCode = typeof rawInviteCode === 'string' ? rawInviteCode.trim().toUpperCase() : '';
  if (!/^[A-Z2-9]{8}$/.test(inviteCode)) throw new BusinessError('INVALID_INVITE_CODE', '匹配码格式不正确');
  const contract = await repository.findContractByInviteCode(inviteCode);
  if (!contract || contract.status !== 'active') throw new BusinessError('INVITE_NOT_FOUND', '匹配码不存在');
  if (new Date(contract.inviteExpiresAt).getTime() <= now.getTime()) {
    throw new BusinessError('INVITE_EXPIRED', '匹配码已过期');
  }
  if (contract.employeeOpenid) throw new BusinessError('CONTRACT_ALREADY_BOUND', '该合同已绑定阿姨');
  return contract;
}

async function updateContract({ payload, openid, now, repository }) {
  const user = await requireRole(repository, openid, 'employer');
  const contract = await repository.findActiveContractByParticipant(user.openid);
  if (!contract || contract.employerOpenid !== user.openid) {
    throw new BusinessError('CONTRACT_NOT_FOUND', '未找到合作');
  }
  if (contract.employeeOpenid) {
    throw new BusinessError('CONTRACT_ALREADY_BOUND', '阿姨已加入，不能修改合作');
  }

  const input = normalizeDomainError(() => validateContractInput(payload));
  const cycle = await repository.findOpenCycle(contract._id);
  if (!cycle) throw new BusinessError('NO_OPEN_STAGE', '当前合作没有进行中的一期');
  const nextInviteCode = await createNonconflictingInviteCode(repository);
  const inviteExpiresAt = new Date(now.getTime() + INVITE_TTL_MS).toISOString();
  const { contract: updatedContract, cycle: updatedCycle } = await normalizeRepositoryError(() =>
    repository.updateUnboundContract({
      contractId: contract._id,
      cycleId: cycle._id,
      contractPatch: {
        ...input,
        inviteCode: nextInviteCode,
        inviteExpiresAt
      },
      cyclePatch: {
        startedAt: shanghaiStartOfDay(input.startDate).toISOString(),
        startLocalDate: input.startDate
      }
    })
  );
  return {
    contract: publicContract(updatedContract),
    cycle: updatedCycle,
    inviteCode: nextInviteCode,
    inviteExpiresAt
  };
}

async function regenerateInviteCode({ openid, now, repository }) {
  const user = await requireRole(repository, openid, 'employer');
  const contract = await repository.findActiveContractByParticipant(user.openid);
  if (!contract || contract.employerOpenid !== user.openid) {
    throw new BusinessError('CONTRACT_NOT_FOUND', '未找到合同');
  }
  if (contract.employeeOpenid) {
    throw new BusinessError('CONTRACT_ALREADY_BOUND', '该合同已绑定阿姨');
  }

  const inviteCode = await createNonconflictingInviteCode(repository);
  const inviteExpiresAt = new Date(now.getTime() + INVITE_TTL_MS).toISOString();
  const { contract: updated } = await normalizeRepositoryError(() =>
    repository.regenerateInviteForUnboundContract({
      contractId: contract._id,
      inviteCode,
      inviteExpiresAt
    })
  );
  return {
    contract: publicContract(updated),
    inviteCode,
    inviteExpiresAt
  };
}

async function createNonconflictingInviteCode(repository) {
  let inviteCode = createInviteCode();
  let guard = 0;
  while ((await repository.findContractByInviteCode(inviteCode)) && guard < 20) {
    inviteCode = createInviteCode();
    guard += 1;
  }
  if (await repository.findContractByInviteCode(inviteCode)) {
    throw new BusinessError('INVITE_CODE_CONFLICT', '匹配码生成失败，请重试');
  }
  return inviteCode;
}

async function resetUnmatchedCooperation({ openid, repository }) {
  const user = await requireUser(repository, openid);
  const contract = await repository.findActiveContractByParticipant(openid);
  if (!contract) {
    return { reset: false };
  }
  if (contract.employeeOpenid) {
    throw new BusinessError('COOPERATION_ALREADY_MATCHED', '双方已匹配，不能重新选择身份');
  }
  if (user.role === 'employee' || contract.employerOpenid !== openid) {
    throw new BusinessError('FORBIDDEN', '当前角色无权重置这次合作');
  }

  const cycle = await repository.findOpenCycle(contract._id);
  if (cycle) {
    await normalizeRepositoryError(() =>
      repository.cancelUnmatchedCooperation({
        contractId: contract._id,
        cycleId: cycle._id
      })
    );
  } else {
    await normalizeRepositoryError(() =>
      repository.cancelUnmatchedCooperation({
        contractId: contract._id
      })
    );
  }
  await repository.updateUser(openid, { activeContractId: null });
  return { reset: true };
}

async function getCurrentState({ openid, now, repository }) {
  const user = await requireUser(repository, openid);
  const contract = await repository.findActiveContractByParticipant(openid);
  if (!contract) {
    const previousContracts = await repository.listContractsForParticipant(openid);
    const previous = previousContracts.find((item) => item.status === 'ended') || null;
    let lastCooperation = null;
    if (previous) {
      const settlements = await repository.listSettlements(previous._id);
      lastCooperation = {
        contractId: previous._id,
        status: previous.status,
        endedAt: previous.endedAt,
        endedReason: previous.endedReason,
        summary: summarizeSettlements(settlements)
      };
    }
    return {
      user: publicUser(user),
      contract: null,
      cycle: null,
      lastCooperation,
      progress: null,
      reminder: { required: false },
      nextAction: user.role === 'employer' ? 'createContract' : 'joinContract'
    };
  }

  const cycle = await repository.findOpenCycle(contract._id);
  if (!cycle) throw new BusinessError('NO_OPEN_STAGE', '当前合同没有进行中的一期');
  const contractCheckins = await repository.listCheckinsByContract(contract._id);
  const checkins = contractCheckins.filter((checkin) => checkin.cycleId === cycle._id);
  const localDate = toShanghaiLocalDate(now);
  const todayCheckin = await repository.getContractCheckin(contract._id, localDate);
  const pendingSettlement = await repository.findPendingSettlementRequest(contract._id);
  const calculation = calculateSettlement({
    totalAmount: contract.totalAmount,
    targetDays: contract.targetDays,
    days: checkins.length
  });
  const canCheckin =
    !pendingSettlement &&
    user.role === 'employee' &&
    Boolean(contract.employeeOpenid) &&
    localDate >= cycleStartLocalDate(cycle) &&
    !todayCheckin;

  const settlementRecords = await repository.listSettlements(contract._id);
  const settledCheckinDates = await listSettledCheckinDates(settlementRecords, repository);
  const settledCalendarCheckins = contractCheckins
    .filter((checkin) => checkin.cycleId !== cycle._id)
    .map(publicCalendarCheckin);
  const exposedContract = publicContract(contract);
  if (
    !contract.employeeOpenid &&
    contract.inviteCode &&
    new Date(contract.inviteExpiresAt).getTime() <= now.getTime()
  ) {
    exposedContract.inviteCode = null;
  }
  return {
    user: publicUser(user),
    contract: exposedContract,
    cycle,
    currentStage: {
      stageId: cycle._id,
      stageIndex: cycle.cycleIndex,
      startLocalDate: cycleStartLocalDate(cycle),
      days: checkins.length,
      backfillDays: checkins.filter((checkin) => isBackfill(checkin)).length,
      dailySalary: calculation.dailySalary,
      suggestedAmount: calculation.amount
    },
    cumulativeWorkDays: settlementRecords.reduce((sum, item) => sum + Number(item.days || 0), 0) + checkins.length,
    pendingSettlement: pendingSettlement ? publicSettlementRequest(pendingSettlement) : null,
    backfill: buildBackfillState({
      stage: cycle,
      checkins,
      today: localDate,
      pending: Boolean(pendingSettlement)
    }),
    settlementSummary: summarizeSettlements(settlementRecords),
    progress: {
      checkinDays: checkins.length,
      targetDays: contract.targetDays,
      dailySalary: calculation.dailySalary,
      payableAmount: calculation.amount,
      progressPercent: Math.min(100, Math.round((checkins.length / contract.targetDays) * 100))
    },
    today: {
      localDate,
      checkedIn: Boolean(todayCheckin),
      checkin: todayCheckin ? publicCheckin(todayCheckin) : null
    },
    reminder: buildReminder(checkins.length, contract.targetDays),
    canCheckin,
    settledCheckinDates,
    calendarCheckins: checkins.map(publicCalendarCheckin),
    settledCalendarCheckins,
    checkins: checkins.slice().reverse().map(publicCheckin),
    recentCheckins: checkins.slice(-30).reverse().map(publicCheckin),
    nextAction: 'viewStage'
  };
}

async function createCheckinChallenge({ openid, now, repository }) {
  const context = await requireCheckinContext({ openid, now, repository });
  if (context.todayCheckin) throw new BusinessError('DUPLICATE_CHECKIN', '今天已完成打卡');
  if (context.localDate < context.contract.startDate) {
    throw new BusinessError('BEFORE_START_DATE', '合同尚未开始');
  }

  let token = createChallengeToken();
  let guard = 0;
  while ((await repository.findChallengeByToken(token)) && guard < 20) {
    token = createChallengeToken();
    guard += 1;
  }
  const challenge = {
    _id: createId('challenge', now),
    token,
    contractId: context.contract._id,
    cycleId: context.cycle._id,
    employeeOpenid: openid,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString(),
    usedAt: null
  };
  await repository.insertChallenge(challenge);
  return { challenge: { token: challenge.token, expiresAt: challenge.expiresAt } };
}

async function submitCheckin({ payload, openid, now, repository }) {
  const context = await requireCheckinContext({ openid, now, repository });
  const token = typeof payload.challenge === 'string' ? payload.challenge : '';
  const challenge = await repository.findChallengeByToken(token);
  if (!challenge || challenge.employeeOpenid !== openid || challenge.cycleId !== context.cycle._id) {
    throw new BusinessError('INVALID_CHALLENGE', '打卡凭证无效');
  }
  if (challenge.usedAt) throw new BusinessError('CHALLENGE_USED', '打卡凭证已使用');
  if (new Date(challenge.expiresAt).getTime() <= now.getTime()) {
    throw new BusinessError('CHALLENGE_EXPIRED', '打卡凭证已过期');
  }
  if (context.localDate < context.contract.startDate) {
    await recordFailure({ repository, context, payload, now, challenge, reason: 'BEFORE_START_DATE', distanceMeters: null });
    await repository.updateChallenge(challenge._id, { usedAt: now.toISOString() });
    throw new BusinessError('BEFORE_START_DATE', '合同尚未开始');
  }
  if (context.todayCheckin) {
    await recordFailure({ repository, context, payload, now, challenge, reason: 'DUPLICATE_CHECKIN', distanceMeters: null });
    await repository.updateChallenge(challenge._id, { usedAt: now.toISOString() });
    throw new BusinessError('DUPLICATE_CHECKIN', '今天已完成打卡');
  }

  const evaluation = evaluateCheckin({
    home: context.contract.homeLocation,
    location: {
      latitude: payload.latitude,
      longitude: payload.longitude,
      accuracy: payload.accuracy
    },
    radiusMeters: context.contract.radiusMeters
  });
  if (!evaluation.allowed) {
    await recordFailure({
      repository,
      context,
      payload,
      now,
      challenge,
      reason: evaluation.reason,
      distanceMeters: evaluation.distanceMeters
    });
    await repository.updateChallenge(challenge._id, { usedAt: now.toISOString() });
    throw new BusinessError(evaluation.reason, checkinMessage(evaluation.reason));
  }

  const checkin = {
    _id: `${context.cycle._id}:${context.localDate}`,
    cycleId: context.cycle._id,
    contractId: context.contract._id,
    employeeOpenid: openid,
    localDate: context.localDate,
    latitude: Number(payload.latitude),
    longitude: Number(payload.longitude),
    accuracy: Number(payload.accuracy),
    distanceMeters: evaluation.distanceMeters,
    serverTime: now.toISOString(),
    source: 'employee_checkin',
    workTime: shanghaiClockTime(now),
    reason: null
  };
  await normalizeRepositoryError(() => repository.completeCheckin(challenge, checkin));
  await repository.insertAttempt({
    _id: createId('attempt', now),
    contractId: context.contract._id,
    cycleId: context.cycle._id,
    employeeOpenid: openid,
    localDate: context.localDate,
    latitude: Number(payload.latitude),
    longitude: Number(payload.longitude),
    accuracy: Number(payload.accuracy),
    distanceMeters: evaluation.distanceMeters,
    successful: true,
    reason: null,
    serverTime: now.toISOString()
  });
  return { checkin };
}

async function createBackfillCheckins({ payload, openid, now, repository }) {
  const user = await requireRole(repository, openid, 'employer');
  const contract = await repository.findActiveContractByParticipant(user.openid);
  if (!contract || contract.employerOpenid !== user.openid) {
    throw new BusinessError('CONTRACT_NOT_FOUND', '未找到合作');
  }
  if (!contract.employeeOpenid) throw new BusinessError('CONTRACT_NOT_BOUND', '阿姨还未加入合同');
  const pendingSettlement = await repository.findPendingSettlementRequest(contract._id);
  if (pendingSettlement) {
    throw new BusinessError('SETTLEMENT_PENDING', '请先处理待确认的结算');
  }
  const stage = await repository.findOpenCycle(contract._id);
  if (!stage) throw new BusinessError('NO_OPEN_STAGE', '当前合作没有进行中的一期');

  const localDates = normalizeBackfillDates(payload.localDates);
  const workTime = normalizeBackfillWorkTime(payload.workTime || '09:00');
  const reason = normalizeBackfillReason(payload.reason || '前期补录');
  const today = toShanghaiLocalDate(now);
  const earliest = String(addLocalDays(today, -30)).localeCompare(cycleStartLocalDate(stage)) > 0
    ? addLocalDays(today, -30)
    : cycleStartLocalDate(stage);

  localDates.forEach((localDate) => {
    if (localDate >= today) {
      throw new BusinessError('BACKFILL_DATE_NOT_BEFORE_TODAY', '补录日期必须早于今天');
    }
    if (localDate < earliest) {
      throw new BusinessError('BACKFILL_DATE_OUT_OF_RANGE', '只能补最近30天且本期开始后的日期');
    }
  });

  for (const localDate of localDates) {
    if (typeof repository.getContractCheckin === 'function') {
      const existing = await repository.getContractCheckin(contract._id, localDate);
      if (existing) throw new BusinessError('CHECKIN_ALREADY_EXISTS', '该日期已有打卡记录');
    }
  }

  const checkins = localDates.map((localDate) => ({
    _id: `${stage._id}:${localDate}`,
    cycleId: stage._id,
    contractId: contract._id,
    employeeOpenid: contract.employeeOpenid,
    localDate,
    latitude: null,
    longitude: null,
    accuracy: null,
    distanceMeters: null,
    serverTime: now.toISOString(),
    source: 'employer_backfill',
    workTime,
    backfillReason: reason,
    createdByOpenid: openid,
    createdByRole: 'employer',
    createdAt: now.toISOString()
  }));
  await normalizeRepositoryError(() => repository.insertBackfillCheckins({
    contractId: contract._id,
    stageId: stage._id,
    checkins
  }));
  return { checkins: checkins.map(publicCheckin) };
}

function normalizeBackfillDates(value) {
  if (!Array.isArray(value) || value.length < 1) {
    throw new BusinessError('BACKFILL_DATES_REQUIRED', '请选择需要补录的日期');
  }
  if (value.length > 30) throw new BusinessError('BACKFILL_DATE_LIMIT', '一次最多补录30天');
  const dates = [...new Set(value.map((item) => String(item)))].sort((left, right) => left.localeCompare(right));
  dates.forEach((localDate) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || Number.isNaN(Date.parse(`${localDate}T00:00:00+08:00`))) {
      throw new BusinessError('INVALID_BACKFILL_DATE', '补录日期无效');
    }
  });
  return dates;
}

function normalizeBackfillWorkTime(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new BusinessError('INVALID_BACKFILL_TIME', '补录时间无效');
  }
  return value;
}

function normalizeBackfillReason(value) {
  const reason = String(value || '').trim();
  if (!reason || reason.length > 120) {
    throw new BusinessError('INVALID_BACKFILL_REASON', '请填写补录原因');
  }
  return reason;
}

async function createSettlementRequest({ payload, openid, now, repository }) {
  const user = await requireRole(repository, openid, 'employer');
  const contract = await repository.findActiveContractByParticipant(user.openid);
  if (!contract || contract.employerOpenid !== user.openid) {
    throw new BusinessError('CONTRACT_NOT_FOUND', '未找到合同');
  }
  if (!contract.employeeOpenid) throw new BusinessError('CONTRACT_NOT_BOUND', '阿姨还未加入合同');

  const existingRequest = await repository.findPendingSettlementRequest(contract._id);
  if (existingRequest) {
    throw new BusinessError('SETTLEMENT_REQUEST_PENDING', '已有待阿姨确认的结算');
  }

  const stage = await repository.findOpenCycle(contract._id);
  if (!stage) throw new BusinessError('NO_OPEN_STAGE', '没有可结算的一期');

  const localDate = toShanghaiLocalDate(now);
  const checkins = await repository.listCheckins(stage._id);
  if (checkins.length < 1) {
    throw new BusinessError('NO_CHECKINS_TO_SETTLE', '这一期还没有打卡记录，暂不需要结算');
  }
  const workEndLocalDate = checkins[checkins.length - 1].localDate;
  const nextStageStartLocalDate = addLocalDays(workEndLocalDate, 1);
  const calculation = calculateSettlement({
    totalAmount: contract.totalAmount,
    targetDays: contract.targetDays,
    days: checkins.length
  });
  const paidAmount = roundMoney(payload.paidAmount);
  if (!(paidAmount >= 0 && paidAmount <= 1000000)) {
    throw new BusinessError('INVALID_PAID_AMOUNT', '实付金额需在 0 至 1000000 元之间');
  }

  const differenceAmount = roundMoney(paidAmount - calculation.amount);
  const differenceReason = typeof payload.differenceReason === 'string' ? payload.differenceReason.trim() : '';
  if (Math.abs(differenceAmount) >= 0.01 && !differenceReason) {
    throw new BusinessError('DIFFERENCE_REASON_REQUIRED', '实付金额与按合同计算不一致，请填写原因');
  }

  const transferProofs = normalizeTransferProofs(payload.transferProofs, {
    requireCloudFileId: repository.storageType === 'cloud'
  });
  if (transferProofs.length < 1) {
    throw new BusinessError('TRANSFER_PROOF_REQUIRED', '请至少上传 1 张转账截图');
  }

  const request = {
    _id: createId('settlement_request', now),
    contractId: contract._id,
    stageId: stage._id,
    stageIndex: stage.cycleIndex,
    employerOpenid: contract.employerOpenid,
    employeeOpenid: contract.employeeOpenid,
    stageStartLocalDate: cycleStartLocalDate(stage),
    workEndLocalDate,
    nextStageStartLocalDate,
    settledOnLocalDate: localDate,
    days: checkins.length,
    averageArrivalTime: averageArrivalTime(checkins),
    settledCheckinDates: checkins.map((checkin) => checkin.localDate),
    totalAmount: Number(contract.totalAmount),
    targetDays: Number(contract.targetDays),
    dailySalary: calculation.dailySalary,
    suggestedAmount: calculation.amount,
    paidAmount,
    differenceAmount,
    differenceReason: differenceAmount === 0 ? '' : differenceReason,
    transferProofs,
    status: 'pending_employee',
    employerCreatedAt: now.toISOString(),
    employeeConfirmedAt: null,
    disputedAt: null,
    disputedReason: '',
    cancelledAt: null
  };
  await repository.insertSettlementRequest(request);
  return { settlementRequest: publicSettlementRequest(request) };
}

async function confirmSettlementRequest({ openid, now, repository }) {
  const user = await requireRole(repository, openid, 'employee');
  const contract = await repository.findActiveContractByParticipant(user.openid);
  if (!contract || contract.employeeOpenid !== user.openid) {
    throw new BusinessError('CONTRACT_NOT_BOUND', '你还未加入合同');
  }
  const request = await repository.findPendingSettlementRequest(contract._id);
  if (!request) throw new BusinessError('SETTLEMENT_REQUEST_NOT_FOUND', '没有待确认的结算');
  if (request.status !== 'pending_employee') {
    throw new BusinessError('SETTLEMENT_DISPUTED', '金额有疑问，需雇主取消后重新发起');
  }

  const stage = await repository.findOpenCycle(contract._id);
  if (!stage || stage._id !== request.stageId) {
    throw new BusinessError('NO_OPEN_STAGE', '没有可结算的一期');
  }

  const confirmedAt = now.toISOString();
  const settlement = {
    _id: `settlement_${request.stageId}`,
    settlementRequestId: request._id,
    contractId: contract._id,
    stageId: request.stageId,
    stageIndex: request.stageIndex,
    stageStartLocalDate: request.stageStartLocalDate,
    workEndLocalDate: request.workEndLocalDate,
    settledOnLocalDate: request.settledOnLocalDate,
    nextStageStartLocalDate: request.nextStageStartLocalDate,
    days: request.days,
    settledCheckinDates: request.settledCheckinDates,
    totalAmount: request.totalAmount,
    targetDays: request.targetDays,
    dailySalary: request.dailySalary,
    suggestedAmount: request.suggestedAmount,
    paidAmount: request.paidAmount,
    differenceAmount: request.differenceAmount,
    differenceReason: request.differenceReason,
    averageArrivalTime: request.averageArrivalTime,
    transferProofs: request.transferProofs,
    status: 'confirmed',
    settledByEmployerOpenid: contract.employerOpenid,
    confirmedByEmployeeOpenid: user.openid,
    employerCreatedAt: request.employerCreatedAt,
    settledAt: confirmedAt
  };
  const closedStage = {
    ...stage,
    status: 'settled',
    settledAt: confirmedAt,
    settledDays: request.days,
    suggestedAmount: request.suggestedAmount,
    paidAmount: request.paidAmount,
    endLocalDate: request.workEndLocalDate
  };
  const nextStage = {
    _id: `${contract._id}_${stage.cycleIndex + 1}`,
    contractId: contract._id,
    stageIndex: stage.cycleIndex + 1,
    cycleIndex: stage.cycleIndex + 1,
    status: 'open',
    startedAt: now.toISOString(),
    startLocalDate: request.nextStageStartLocalDate,
    settledAt: null,
    settledDays: null,
    settledAmount: null
  };
  await normalizeRepositoryError(() =>
    repository.confirmSettlementRequestAndCreateNextStage({
      request,
      settlement,
      closedStage,
      nextStage
    })
  );
  return { settlement: publicSettlement(settlement), nextStage };
}

async function disputeSettlementRequest({ payload, openid, now, repository }) {
  const user = await requireRole(repository, openid, 'employee');
  const contract = await repository.findActiveContractByParticipant(user.openid);
  if (!contract || contract.employeeOpenid !== user.openid) {
    throw new BusinessError('CONTRACT_NOT_BOUND', '你还未加入合同');
  }
  const request = await repository.findPendingSettlementRequest(contract._id);
  if (!request || request.status !== 'pending_employee') {
    throw new BusinessError('SETTLEMENT_REQUEST_NOT_PENDING', '没有可标记疑问的结算');
  }
  const reason = typeof payload.reason === 'string' ? payload.reason.trim().slice(0, 120) : '';
  const updated = await repository.updateSettlementRequest(request._id, {
    status: 'disputed',
    disputedAt: now.toISOString(),
    disputedReason: reason || '阿姨对结算金额有疑问'
  });
  return { settlementRequest: publicSettlementRequest(updated) };
}

async function cancelSettlementRequest({ openid, now, repository }) {
  const user = await requireRole(repository, openid, 'employer');
  const contract = await repository.findActiveContractByParticipant(user.openid);
  if (!contract || contract.employerOpenid !== user.openid) {
    throw new BusinessError('CONTRACT_NOT_FOUND', '未找到合同');
  }
  const request = await repository.findPendingSettlementRequest(contract._id);
  if (!request) throw new BusinessError('SETTLEMENT_REQUEST_NOT_PENDING', '没有可取消的结算');
  const updated = await repository.updateSettlementRequest(request._id, {
    status: 'cancelled',
    cancelledAt: now.toISOString()
  });
  return { settlementRequest: publicSettlementRequest(updated) };
}

async function listHistory({ openid, repository }) {
  const user = await requireUser(repository, openid);
  const contracts = await repository.listContractsForParticipant(openid);
  if (contracts.length === 0) {
    return {
      user: publicUser(user),
      contract: null,
      contracts: [],
      summary: { settledStages: 0, totalPaidAmount: 0, totalSettledDays: 0 },
      settlements: []
    };
  }
  const contractSummaries = [];
  for (const item of contracts) {
    const settlements = await repository.listSettlements(item._id);
    contractSummaries.push({
      contract: publicContract(item),
      summary: summarizeSettlements(settlements),
      settlements: settlements.map(publicSettlement)
    });
  }
  const selected = contractSummaries[0];
  return {
    user: publicUser(user),
    contract: selected.contract,
    contracts: contractSummaries,
    selectedContractId: selected.contract._id,
    summary: selected.summary,
    settlements: selected.settlements
  };
}

async function terminateContract({ payload, openid, now, repository }) {
  const user = await requireRole(repository, openid, 'employer');
  const contract = await repository.findActiveContractByParticipant(user.openid);
  if (!contract || contract.employerOpenid !== user.openid) {
    throw new BusinessError('CONTRACT_NOT_FOUND', '未找到合作');
  }
  if (!contract.employeeOpenid) throw new BusinessError('CONTRACT_NOT_BOUND', '阿姨还未加入合同');
  const pendingSettlement = await repository.findPendingSettlementRequest(contract._id);
  if (pendingSettlement) {
    throw new BusinessError('SETTLEMENT_PENDING', '请先处理待确认的结算');
  }
  const stage = await repository.findOpenCycle(contract._id);
  if (!stage) throw new BusinessError('NO_OPEN_STAGE', '当前合作没有进行中的一期');
  const checkins = await repository.listCheckins(stage._id);
  if (checkins.length > 0) {
    throw new BusinessError('SETTLE_BEFORE_TERMINATION', '这一期还有未结算天数，请先结算');
  }
  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  if (!reason || reason.length > 120) {
    throw new BusinessError('INVALID_TERMINATION_REASON', '请填写终止原因');
  }
  const endedAt = now.toISOString();
  const result = await normalizeRepositoryError(() => repository.terminateContract({
    contractId: contract._id,
    stageId: stage._id,
    contractPatch: {
      status: 'ended',
      endedAt,
      endedReason: reason,
      endedByOpenid: openid,
      endedStageIndex: stage.cycleIndex
    },
    cyclePatch: {
      status: 'ended',
      endedAt
    },
    employerOpenid: contract.employerOpenid,
    employeeOpenid: contract.employeeOpenid
  }));
  return { contract: publicContract(result.contract), stage: result.stage };
}

async function requireCheckinContext({ openid, now, repository }) {
  const user = await requireRole(repository, openid, 'employee');
  const contract = await repository.findActiveContractByParticipant(user.openid);
  const pendingSettlement = await repository.findPendingSettlementRequest(contract ? contract._id : '');
  if (pendingSettlement) throw new BusinessError('SETTLEMENT_PENDING', '请先确认收款，确认后才能继续打卡');
  if (!contract || contract.employeeOpenid !== user.openid) {
    throw new BusinessError('CONTRACT_NOT_BOUND', '你还未加入合同');
  }
  const cycle = await repository.findOpenCycle(contract._id);
  if (!cycle) throw new BusinessError('NO_OPEN_CYCLE', '当前周期已结束');
  const localDate = toShanghaiLocalDate(now);
  const todayCheckin = await repository.getContractCheckin(contract._id, localDate);
  return { user, contract, cycle, localDate, todayCheckin };
}

async function recordFailure({ repository, context, payload, now, challenge, reason, distanceMeters }) {
  await repository.insertAttempt({
    _id: createId('attempt', now),
    contractId: context.contract._id,
    cycleId: context.cycle._id,
    employeeOpenid: context.user.openid,
    localDate: context.localDate,
    latitude: payload.latitude === undefined ? null : Number(payload.latitude),
    longitude: payload.longitude === undefined ? null : Number(payload.longitude),
    accuracy: payload.accuracy === undefined ? null : Number(payload.accuracy),
    distanceMeters,
    successful: false,
    reason,
    serverTime: now.toISOString()
  });
}

function publicContract(contract) {
  const {
    employerOpenid,
    employeeOpenid,
    ...safeContract
  } = contract;
  return {
    ...safeContract,
    employeeBound: Boolean(employeeOpenid),
    totalAmount: Number(contract.totalAmount),
    targetDays: Number(contract.targetDays),
    radiusMeters: Number(contract.radiusMeters)
  };
}

function cycleStartLocalDate(cycle) {
  if (cycle.startLocalDate) return cycle.startLocalDate;
  return toShanghaiLocalDate(new Date(cycle.startedAt));
}

function addLocalDays(localDate, days) {
  const date = new Date(`${localDate}T00:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return toShanghaiLocalDate(date);
}

function shanghaiClockTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const shanghaiDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${String(shanghaiDate.getUTCHours()).padStart(2, '0')}:${String(shanghaiDate.getUTCMinutes()).padStart(2, '0')}`;
}

function isBackfill(checkin) {
  return checkin.source === 'employer_backfill';
}

function averageArrivalTime(checkins) {
  const actualCheckins = (checkins || []).filter((checkin) => !isBackfill(checkin));
  if (actualCheckins.length === 0) return null;
  const minutes = actualCheckins.map((checkin) => {
    const value = checkin.workTime || shanghaiClockTime(checkin.serverTime);
    const [hour, minute] = String(value).split(':').map(Number);
    return hour * 60 + minute;
  });
  const average = Math.round(minutes.reduce((sum, item) => sum + item, 0) / minutes.length);
  return `${String(Math.floor(average / 60)).padStart(2, '0')}:${String(average % 60).padStart(2, '0')}`;
}

function buildBackfillState({ stage, checkins, today, pending }) {
  const stageStart = cycleStartLocalDate(stage);
  const rollingStart = addLocalDays(today, -30);
  const earliest = rollingStart > stageStart ? rollingStart : stageStart;
  const latest = addLocalDays(today, -1);
  const existing = new Set(checkins.map((checkin) => checkin.localDate));
  const eligibleLocalDates = [];
  if (!pending && latest >= earliest) {
    let cursor = earliest;
    while (cursor <= latest) {
      if (!existing.has(cursor)) eligibleLocalDates.push(cursor);
      cursor = addLocalDays(cursor, 1);
    }
  }
  return {
    earliestLocalDate: earliest,
    latestLocalDate: latest,
    eligibleLocalDates,
    defaultWorkTime: '09:00',
    defaultReason: '前期补录',
    canBackfill: !pending
  };
}

function normalizeTransferProofs(value, { requireCloudFileId } = {}) {
  if (!Array.isArray(value)) return [];
  if (value.length > 3) {
    throw new BusinessError('TRANSFER_PROOF_LIMIT', '转账截图最多上传 3 张');
  }
  return value
    .map((item) => {
      const fileId = typeof item === 'string' ? item : item && item.fileId;
      if (typeof fileId !== 'string' || !fileId.trim() || fileId.length > 500) return null;
      if (requireCloudFileId && !fileId.startsWith('cloud://')) return null;
      return { fileId: fileId.trim() };
    })
    .map((item) => {
      if (!item) throw new BusinessError('INVALID_TRANSFER_PROOF', '转账截图文件无效');
      return item;
    });
}

function publicSettlementRequest(request) {
  const {
    employerOpenid,
    employeeOpenid,
    ...safeRequest
  } = request;
  return safeRequest;
}

function publicSettlement(settlement) {
  const {
    settledByEmployerOpenid,
    confirmedByEmployeeOpenid,
    ...safeSettlement
  } = settlement;
  return safeSettlement;
}

function summarizeSettlements(settlements) {
  return {
    settledStages: settlements.length,
    totalPaidAmount: roundMoney(settlements.reduce((sum, item) => sum + Number(item.paidAmount || 0), 0)),
    totalSettledDays: settlements.reduce((sum, item) => sum + Number(item.days || 0), 0)
  };
}

async function listSettledCheckinDates(settlements, repository) {
  const dates = new Set();
  for (const settlement of settlements) {
    if (Array.isArray(settlement.settledCheckinDates)) {
      settlement.settledCheckinDates.forEach((date) => dates.add(date));
      continue;
    }
    if (!settlement.stageId) continue;
    const checkins = await repository.listCheckins(settlement.stageId);
    checkins.forEach((checkin) => dates.add(checkin.localDate));
  }
  return Array.from(dates).sort((left, right) => String(left).localeCompare(String(right)));
}

function buildReminder(days, targetDays) {
  return {
    required: days >= targetDays,
    daysOver: Math.max(0, days - targetDays),
    remainingDays: Math.max(0, targetDays - days)
  };
}

function normalizeDomainError(fn) {
  try {
    return fn();
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    throw new BusinessError(error.message, contractMessage(error.message));
  }
}

async function normalizeRepositoryError(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    if (
      error.code === 'CONTRACT_NOT_FOUND' ||
      error.code === 'CONTRACT_ALREADY_BOUND' ||
      error.code === 'CONTRACT_EXISTS' ||
      error.code === 'EMPLOYEE_ALREADY_JOINED' ||
      error.code === 'FORBIDDEN' ||
      error.code === 'INVITE_NOT_FOUND' ||
      error.code === 'NO_OPEN_CYCLE' ||
      error.code === 'CONTRACT_NOT_BOUND' ||
      error.code === 'CHECKIN_ALREADY_EXISTS' ||
      error.code === 'NO_OPEN_STAGE'
    ) {
      throw new BusinessError(error.code, repositoryMessage(error.code));
    }
    if (error.code === 'CHALLENGE_USED' || error.code === 'DUPLICATE_CHECKIN') {
      throw new BusinessError(error.code, checkinMessage(error.code));
    }
    throw new BusinessError('BACKEND_WRITE_FAILED', '数据写入失败，请重试');
  }
}

function repositoryMessage(code) {
  const messages = {
    CONTRACT_NOT_FOUND: '未找到合作',
    CONTRACT_ALREADY_BOUND: '该合作已绑定阿姨',
    CONTRACT_EXISTS: '已有进行中的合作',
    EMPLOYEE_ALREADY_JOINED: '你已加入合作',
    FORBIDDEN: '当前角色无权执行此操作',
    INVITE_NOT_FOUND: '匹配码不存在',
    NO_OPEN_CYCLE: '当前合作没有进行中的一期',
    CONTRACT_NOT_BOUND: '阿姨还未加入合作',
    CHECKIN_ALREADY_EXISTS: '该日期已有打卡记录',
    NO_OPEN_STAGE: '当前合作没有进行中的一期'
  };
  return messages[code] || '数据写入失败，请重试';
}

function contractMessage(code) {
  const messages = {
    INVALID_TOTAL_AMOUNT: '合同金额需在 1 至 1000000 元之间',
    INVALID_TARGET_DAYS: '目标天数需在 1 至 365 天之间',
    INVALID_START_DATE: '开始日期无效',
    INVALID_ADDRESS: '请填写家庭地址',
    INVALID_LATITUDE: '家庭纬度无效',
    INVALID_LONGITUDE: '家庭经度无效',
    INVALID_RADIUS: '围栏半径需在 100 至 1000 米之间'
  };
  return messages[code] || '合同信息无效';
}

function checkinMessage(code) {
  const messages = {
    OUT_OF_FENCE: '当前位置不在家庭围栏内',
    POOR_ACCURACY: '定位精度不足，请到开阔处后重试',
    INVALID_LOCATION: '定位信息无效，请重新获取定位',
    CHALLENGE_USED: '打卡凭证已使用',
    CHALLENGE_EXPIRED: '打卡凭证已过期',
    DUPLICATE_CHECKIN: '今天已完成打卡',
    NO_OPEN_CYCLE: '当前周期已结束'
  };
  return messages[code] || '打卡失败';
}

module.exports = {
  CHALLENGE_TTL_MS,
  INVITE_TTL_MS,
  handleAction
};
