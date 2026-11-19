'use strict';

const { api } = require('../../services/api');
const {
  buildCalendarMonth,
  getCalendarNavigation,
  getInitialCalendarMonth
} = require('../../services/calendar-state');
const {
  formatCompactDateWithYear,
  formatCompactMoney,
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
    locationPermissionDenied: false,
    role: '',
    state: null,
    showAuxiliary: false,
    stageStartText: '',
    cumulativeWorkText: '',
    totalPaidCompactText: '',
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
        const initialCalendar = getInitialCalendarMonth({
          startLocalDate: state.currentStage.startLocalDate,
          todayLocalDate: state.today.localDate,
          checkinRecords: state.calendarCheckins || []
        });
        const checkinTime = state.today.checkin && (state.today.checkin.workTime || state.today.checkin.serverTime)
          ? formatShanghaiClockTime(state.today.checkin.workTime || state.today.checkin.serverTime)
          : '';
        const bottomCheckinText = state.today.checkedIn
          ? '已打卡'
          : state.today.localDate < state.currentStage.startLocalDate
              ? '未开始'
              : '去打卡';
        this.setData({
          loading: false,
          role: state.user.role,
          state,
          year: initialCalendar.year,
          month: initialCalendar.month,
          stageStartText: formatCompactDateWithYear(state.currentStage.startLocalDate),
          cumulativeWorkText: state.user.role === 'employee'
            ? `累计工作 ${state.cumulativeWorkDays || 0} 天${state.currentStage.backfillDays ? ` · 含补录 ${state.currentStage.backfillDays} 天` : ''}`
            : `当前合作已结 ${state.settlementSummary.settledStages} 期`,
          totalPaidCompactText: formatCompactMoney(
            state.lifetimeSummary ? state.lifetimeSummary.totalPaidAmount : state.settlementSummary.totalPaidAmount
          ),
          todayClockText: checkinTime || '--:--',
          checkinUnavailableText: state.today.localDate < state.currentStage.startLocalDate
              ? '未开始'
              : '今日暂不能打卡',
          bottomCheckinText,
          bottomCheckinDisabled: state.today.checkedIn || !state.canCheckin,
          reminderText: buildReminderText(state.reminder),
          error: '',
          checkingIn: false,
          locationPermissionDenied: false
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
      if (state.lastCooperation) {
        url = '/pages/onboarding/index?reselect=1';
      } else {
      url = state.user.role === 'employer'
        ? '/pages/employer/create/index'
        : '/pages/employee/join/index';
      }
    }
    if (!url && state.pendingSettlement) {
      url = '/pages/settlement-status/index';
    } else if (!url && state.user.role === 'employer' && !state.contract.employeeBound) {
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
      settledRecords: [
        ...(state.settledCalendarCheckins || []),
        ...(state.historicalCalendarCheckins || [])
      ]
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
        const permissionDenied = isLocationPermissionError(error);
        const message = permissionDenied
          ? '需要位置权限才能打卡，请在设置中开启。'
          : error.message || '打卡失败，请稍后重试';
        this.setData({
          checkingIn: false,
          locationPermissionDenied: permissionDenied,
          error: message
        });
      });
  },

  openLocationSetting() {
    wx.openSetting({
      success: (result) => {
        if (result.authSetting && result.authSetting['scope.userLocation']) {
          this.setData({ error: '', locationPermissionDenied: false });
        }
      },
      fail: () => {
        wx.showToast({ title: '打开设置失败', icon: 'none' });
      }
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
    if (this.data.state.currentStage.days > 0) {
      wx.showToast({ title: '请先结算这一期', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/termination/index' });
  },

  goOnboarding() {
    wx.reLaunch({ url: '/pages/onboarding/index?reselect=1' });
  }

});

function buildReminderText(reminder) {
  if (!reminder || !reminder.required) return '';
  return reminder.daysOver > 0
    ? `已超过约定提醒线 ${reminder.daysOver} 天`
    : '已达到约定提醒线，可结算也可继续累计';
}

function isLocationPermissionError(error) {
  const message = `${error && error.errMsg ? error.errMsg : ''} ${error && error.message ? error.message : ''}`;
  return /auth deny|denied|authorize|permission/i.test(message);
}
