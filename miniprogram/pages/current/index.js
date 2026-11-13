'use strict';

const { api } = require('../../services/api');
const { buildCalendarMonth, getCalendarNavigation } = require('../../services/calendar-state');
const {
  buildSettlementExplanation,
  formatCompactDateWithYear,
  formatCompactMoney,
  formatMoney,
  getTransferProofUrl,
  formatShanghaiClockTime
} = require('../../services/view-state');

function getLocation() {
  return new Promise((resolve, reject) => {
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      highAccuracyExpireTime: 5000,
      success: resolve,
      fail: reject
    });
  });
}

Page({
  data: {
    isMock: api.mode === 'mock',
    loading: true,
    routing: false,
    checkingIn: false,
    role: '',
    state: null,
    showAuxiliary: false,
    stageStartText: '',
    cumulativeWorkText: '',
    lastCooperationSummaryText: '',
    dailySalaryText: '',
    totalPaidCompactText: '',
    paidText: '',
    pendingExplanation: null,
    pendingTitle: '',
    todayClockText: '',
    checkinUnavailableText: '',
    bottomCheckinText: '',
    bottomCheckinDisabled: false,
    reminderText: '',
    calendar: null,
    year: 0,
    month: 0,
    canPrevMonth: false,
    canNextMonth: false,
    error: ''
  },

  onShow() {
    if (this.getTabBar) {
      this.getTabBar().setData({ selected: 0 });
    }
    this.setData({ routing: false });
    this.refresh();
  },

  refresh(done) {
    api.call('getCurrentState')
      .then((result) => {
        if (!result.ok) {
          if (result.code === 'USER_NOT_FOUND') {
            this.setData({ routing: true });
            wx.reLaunch({ url: '/pages/onboarding/index' });
            return;
          }
          throw new Error(result.message);
        }
        const state = result.data;
        if (this.routeFromState(state)) return;
        const pending = state.pendingSettlement;
        const [todayYear, todayMonth] = state.today.localDate.split('-').map(Number);
        const checkinTime = state.today.checkin && (state.today.checkin.workTime || state.today.checkin.serverTime)
          ? formatShanghaiClockTime(state.today.checkin.workTime || state.today.checkin.serverTime)
          : '';
        const pendingExplanation = pending
          ? buildSettlementExplanation({
            totalAmount: pending.totalAmount,
            targetDays: pending.targetDays,
            days: pending.days,
            dailySalary: pending.dailySalary,
            suggestedAmount: pending.suggestedAmount,
            paidAmount: pending.paidAmount
          })
          : null;
        const bottomCheckinText = state.today.checkedIn
          ? '已打卡'
          : pending
            ? pending.status === 'disputed'
              ? '待雇主处理'
              : '待确认结算'
            : state.today.localDate < state.currentStage.startLocalDate
              ? '未开始'
              : '去打卡';
        this.setData({
          loading: false,
          role: state.user.role,
          state,
          year: todayYear,
          month: todayMonth,
          stageStartText: formatCompactDateWithYear(state.currentStage.startLocalDate),
          lastCooperationSummaryText: state.lastCooperation
            ? `已结算 ${state.lastCooperation.summary.settledStages} 期 · 累计干了 ${state.lastCooperation.summary.totalSettledDays} 天`
            : '',
          cumulativeWorkText: state.user.role === 'employee'
            ? `累计工作 ${state.cumulativeWorkDays || 0} 天${state.currentStage.backfillDays ? ` · 含补录 ${state.currentStage.backfillDays} 天` : ''}`
            : `历史已结算 ${state.settlementSummary.settledStages} 期`,
          dailySalaryText: formatMoney(state.currentStage ? state.currentStage.dailySalary : 0),
          totalPaidCompactText: formatCompactMoney(
            state.settlementSummary ? state.settlementSummary.totalPaidAmount : 0
          ),
          paidText: pendingExplanation ? pendingExplanation.paidText : '',
          pendingExplanation,
          pendingTitle: pending
            ? pending.status === 'disputed'
              ? '阿姨对金额有疑问'
              : state.user.role === 'employer'
                ? '等待阿姨确认收款'
                : '雇主已结算，请确认'
            : '',
          todayClockText: checkinTime || '--:--',
          checkinUnavailableText: pending
            ? '待确认收款'
            : state.today.localDate < state.currentStage.startLocalDate
              ? '未开始'
              : '今日暂不能打卡',
          bottomCheckinText,
          bottomCheckinDisabled: state.today.checkedIn || !state.canCheckin,
          reminderText: buildReminderText(state.reminder),
          error: '',
          checkingIn: false
        });
        this.renderCalendar();
      })
      .catch((error) => {
        this.setData({ loading: false, state: null });
        wx.showToast({ title: error.message || '读取失败', icon: 'none' });
      })
      .then(() => {
        if (done) done();
      });
  },

  routeFromState(state) {
    if (this.data.routing) return true;
    let url = '';
    if (!state.contract) {
      if (state.lastCooperation) return false;
      url = state.user.role === 'employer'
        ? '/pages/employer/create/index'
        : '/pages/employee/join/index';
    } else if (state.user.role === 'employer' && !state.contract.employeeBound) {
      url = '/pages/employer/waiting/index';
    }
    if (!url) return false;
    this.setData({ routing: true, loading: false });
    wx.reLaunch({
      url,
      fail: () => this.setData({ routing: false })
    });
    return true;
  },

  renderCalendar() {
    const state = this.data.state;
    if (!state || !state.currentStage) return;
    const calendar = buildCalendarMonth({
      year: this.data.year,
      month: this.data.month,
      startLocalDate: state.currentStage.startLocalDate,
      today: state.today.localDate,
      checkinDates: (state.checkins || []).map((item) => item.localDate),
      checkinRecords: state.calendarCheckins || [],
      settledDates: state.settledCheckinDates || [],
      settledRecords: state.settledCalendarCheckins || []
    });
    const navigation = getCalendarNavigation({
      startLocalDate: state.currentStage.startLocalDate,
      todayLocalDate: state.today.localDate,
      year: this.data.year,
      month: this.data.month
    });
    this.setData({
      calendar,
      ...navigation
    });
  },

  prevMonth() {
    if (!this.data.canPrevMonth) return;
    const month = this.data.month - 1;
    this.setData(month === 0 ? { year: this.data.year - 1, month: 12 } : { month });
    this.renderCalendar();
  },

  nextMonth() {
    if (!this.data.canNextMonth) return;
    const month = this.data.month + 1;
    this.setData(month === 13 ? { year: this.data.year + 1, month: 1 } : { month });
    this.renderCalendar();
  },

  checkin() {
    if (!this.data.state || this.data.state.today.checkedIn || !this.data.state.canCheckin) return;
    if (this.data.checkingIn) return;
    this.setData({ checkingIn: true, error: '' });
    getLocation()
      .then((location) => api.call('createCheckinChallenge').then((challenge) => {
        if (!challenge.ok) throw new Error(challenge.message);
        return api.call('submitCheckin', {
          challenge: challenge.data.challenge.token,
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy
        });
      }))
      .then((result) => {
        if (!result.ok) throw new Error(result.message);
        wx.showToast({ title: '打卡成功', icon: 'success' });
        this.setData({ checkingIn: false });
        this.refresh();
      })
      .catch((error) => {
        const message = error.errMsg && /auth deny|denied|authorize/.test(error.errMsg)
          ? '需要位置权限才能打卡，请在设置中开启。'
          : error.message || '打卡失败，请稍后重试';
        this.setData({ checkingIn: false, error: message });
      });
  },

  confirmSettlement() {
    wx.showModal({
      title: '确认收款',
      content: `确认收到 ${this.data.paidText}？确认后可以继续打卡。`,
      confirmText: '确认收款',
      cancelText: '再看看',
      success: ({ confirm }) => {
        if (!confirm) return;
        api.call('confirmSettlementRequest').then((result) => {
          if (!result.ok) throw new Error(result.message);
          wx.showToast({ title: '已确认', icon: 'success' });
          this.refresh();
        }).catch((error) => wx.showToast({ title: error.message, icon: 'none' }));
      }
    });
  },

  disputeSettlement() {
    api.call('disputeSettlementRequest', { reason: '金额不对' }).then((result) => {
      if (!result.ok) throw new Error(result.message);
      wx.showToast({ title: '已通知雇主', icon: 'none' });
      this.refresh();
    }).catch((error) => wx.showToast({ title: error.message, icon: 'none' }));
  },

  cancelSettlement() {
    wx.showModal({
      title: '取消结算',
      content: '取消后这一期继续记工，不会生成历史记录。',
      confirmText: '取消结算',
      cancelText: '保留',
      success: ({ confirm }) => {
        if (!confirm) return;
        api.call('cancelSettlementRequest').then((result) => {
          if (!result.ok) throw new Error(result.message);
          this.refresh();
        }).catch((error) => wx.showToast({ title: error.message, icon: 'none' }));
      }
    });
  },

  previewProof(event) {
    const proofs = this.data.state.pendingSettlement.transferProofs;
    wx.previewImage({
      current: getTransferProofUrl(proofs[Number(event.currentTarget.dataset.index)]),
      urls: proofs.map(getTransferProofUrl)
    });
  },

  toggleAuxiliary() {
    this.setData({ showAuxiliary: !this.data.showAuxiliary });
  },

  resetMockData() {
    api.resetMockData();
    wx.reLaunch({ url: '/pages/onboarding/index' });
  },

  switchMockRole(event) {
    const role = event.currentTarget.dataset.role;
    api.setMockRole(role);
    api.call('bootstrapUser', { role }).then((result) => {
      if (!result.ok) throw new Error(result.message);
      this.refresh();
    }).catch((error) => {
      wx.showToast({ title: error.message || '切换身份失败', icon: 'none' });
    });
  },

  goCreate() {
    wx.reLaunch({ url: '/pages/employer/create/index' });
  },

  goJoin() {
    wx.reLaunch({ url: '/pages/employee/join/index' });
  },

  goSettlement() {
    if (!this.data.state) return;
    if (this.data.state.pendingSettlement) {
      wx.showToast({ title: '阿姨确认后才能继续结算', icon: 'none' });
      return;
    }
    if (this.data.state.currentStage.days < 1) {
      wx.showToast({ title: '这一期还没有上工记录', icon: 'none' });
      return;
    }
    const url = '/pages/settlement/index';
    wx.navigateTo({
      url,
      fail: () => {
        wx.redirectTo({
          url,
          fail: () => wx.showToast({ title: '打开结算失败，请重试', icon: 'none' })
        });
      }
    });
  },

  goBackfill() {
    if (!this.data.state || !this.data.state.backfill || !this.data.state.backfill.canBackfill) {
      wx.showToast({ title: '请先处理待确认结算', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/backfill/index' });
  },

  goTermination() {
    if (!this.data.state) return;
    if (this.data.state.pendingSettlement) {
      wx.showToast({ title: '阿姨确认结算后才能终止', icon: 'none' });
      return;
    }
    if (this.data.state.currentStage.days > 0) {
      wx.showToast({ title: '请先结算这一期', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/termination/index' });
  },

  goOnboarding() {
    wx.reLaunch({ url: '/pages/onboarding/index' });
  }

});

function buildReminderText(reminder) {
  if (!reminder || !reminder.required) return '';
  return reminder.daysOver > 0
    ? `已超过约定提醒线 ${reminder.daysOver} 天`
    : '已达到约定提醒线，可结算也可继续累计';
}
