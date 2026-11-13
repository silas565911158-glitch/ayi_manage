'use strict';

const { api } = require('../../services/api');
const { formatMoney } = require('../../services/view-state');

const REASONS = ['阿姨下户', '双方协商结束', '雇主不再用工', '其他'];

Page({
  data: {
    loading: true,
    state: null,
    reasons: REASONS,
    reason: '阿姨下户',
    otherReason: '',
    totalPaidText: formatMoney(0),
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
        wx.showToast({ title: '只有雇主可以终止', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 500);
        return;
      }
      this.setData({
        loading: false,
        state,
        totalPaidText: formatMoney(state.settlementSummary.totalPaidAmount),
        error: ''
      });
    }).catch((error) => {
      this.setData({ loading: false, error: error.message || '读取失败' });
    });
  },

  selectReason(event) {
    this.setData({ reason: event.currentTarget.dataset.reason });
  },

  inputOtherReason(event) {
    this.setData({ otherReason: event.detail.value });
  },

  submit() {
    if (this.data.submitting) return;
    const state = this.data.state;
    if (state.pendingSettlement) {
      this.setData({ error: '阿姨确认结算后才能终止' });
      return;
    }
    if (state.currentStage.days > 0) {
      this.setData({ error: '这一期还有未结算天数，请先结算' });
      return;
    }
    const reason = this.data.reason === '其他'
      ? this.data.otherReason.trim() || '其他'
      : this.data.reason;
    wx.showModal({
      title: '确认终止合同',
      content: '终止后当前合作不能再打卡，已确认的历史会保留。',
      confirmText: '终止合同',
      cancelText: '再想想',
      danger: true,
      success: ({ confirm }) => {
        if (!confirm) return;
        this.setData({ submitting: true, error: '' });
        api.call('terminateContract', { reason }).then((result) => {
          if (!result.ok) throw new Error(result.message);
          wx.showToast({ title: '已终止', icon: 'success' });
          setTimeout(() => wx.reLaunch({ url: '/pages/cooperation-ended/index' }), 500);
        }).catch((error) => {
          this.setData({ submitting: false, error: error.message || '终止失败' });
        });
      }
    });
  }
});
