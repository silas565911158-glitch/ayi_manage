'use strict';

const { api } = require('../../services/api');
const { buildBackfillBoard, selectBackfillDate } = require('../../services/backfill-state');
const { formatCompactDateWithYear } = require('../../services/view-state');

const REASONS = ['前期补录', '手机没电', '忘记打卡', '手机故障', '其他'];

Page({
  data: {
    loading: true,
    state: null,
    board: { boards: [], selectedLocalDates: [] },
    selectedCount: 0,
    selectionText: '请选择需要补录的日期',
    earliestText: '',
    latestText: '',
    mode: 'range',
    workTime: '09:00',
    reasons: REASONS,
    reason: '前期补录',
    otherReason: '',
    submitting: false,
    error: ''
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    this.setData({ loading: true });
    api.call('getCurrentState').then((result) => {
      if (!result.ok) throw new Error(result.message);
      const state = result.data;
      if (state.user.role !== 'employer') {
        wx.showToast({ title: '只有雇主可以补录', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 500);
        return;
      }
      this.updateBoard(state, []);
    }).catch((error) => {
      this.setData({ loading: false, error: error.message || '读取失败' });
    });
  },

  updateBoard(state, selectedLocalDates) {
    const backfill = state.backfill || {};
    const board = buildBackfillBoard({
      earliestLocalDate: backfill.earliestLocalDate,
      latestLocalDate: backfill.latestLocalDate,
      eligibleLocalDates: backfill.eligibleLocalDates || [],
      checkedLocalDates: backfill.checkedLocalDates || [],
      selectedLocalDates,
      mode: this.data.mode
    });
    const count = selectedLocalDates.length;
    this.setData({
      loading: false,
      state,
      board,
      selectedCount: count,
      earliestText: formatCompactDateWithYear(backfill.earliestLocalDate),
      latestText: formatCompactDateWithYear(backfill.latestLocalDate),
      selectionText: count === 0
        ? '请选择需要补录的日期'
        : count === 1 && this.data.mode === 'range'
          ? `已选开始 ${formatCompactDateWithYear(selectedLocalDates[0])}，请点击结束日期`
          : `已选 ${formatCompactDateWithYear(selectedLocalDates[0])} 至 ${formatCompactDateWithYear(selectedLocalDates[count - 1])} · 共 ${count} 天`,
      error: ''
    });
  },

  setMode(event) {
    const mode = event.currentTarget.dataset.mode;
    this.setData({ mode }, () => this.updateBoard(this.data.state, []));
  },

  selectDay(event) {
    const date = event.currentTarget.dataset.date;
    const eligible = this.data.state.backfill.eligibleLocalDates || [];
    if (!eligible.includes(date)) return;
    const selected = selectBackfillDate({
      mode: this.data.mode,
      date,
      selectedLocalDates: this.data.board.selectedLocalDates,
      eligibleLocalDates: eligible
    });
    this.updateBoard(this.data.state, selected);
  },

  changeTime(event) {
    this.setData({ workTime: event.detail.value });
  },

  selectReason(event) {
    this.setData({ reason: event.currentTarget.dataset.reason });
  },

  inputOtherReason(event) {
    this.setData({ otherReason: event.detail.value });
  },

  clearSelection() {
    this.updateBoard(this.data.state, []);
  },

  submit() {
    if (this.data.submitting) return;
    if (this.data.selectedCount < 1) {
      this.setData({ error: '请选择需要补录的日期' });
      return;
    }
    const reason = this.data.reason === '其他'
      ? this.data.otherReason.trim() || '其他'
      : this.data.reason;
    wx.showModal({
      title: '确认补录',
      content: `将补录 ${this.data.selectedCount} 天，统一时间 ${this.data.workTime}。`,
      confirmText: '补录',
      cancelText: '再看看',
      success: ({ confirm }) => {
        if (!confirm) return;
        this.setData({ submitting: true, error: '' });
        api.call('createBackfillCheckins', {
          localDates: this.data.board.selectedLocalDates,
          workTime: this.data.workTime,
          reason
        }).then((result) => {
          if (!result.ok) throw new Error(result.message);
          wx.showToast({ title: '补录成功', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 400);
        }).catch((error) => {
          this.setData({ submitting: false, error: error.message || '补录失败' });
        });
      }
    });
  }
});
