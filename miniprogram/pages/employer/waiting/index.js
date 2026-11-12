'use strict';

const { api } = require('../../../services/api');
const {
  buildContractPricingViewModel,
  formatDisplayDate
} = require('../../../services/view-state');

Page({
  data: {
    isMock: api.mode === 'mock',
    loading: true,
    state: null,
    pricing: null,
    expiresText: '',
    working: false,
    error: ''
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    api.call('getCurrentState').then((result) => {
      if (!result.ok) throw new Error(result.message);
      const state = result.data;
      if (!state.user) {
        wx.reLaunch({ url: '/pages/onboarding/index' });
        return;
      }
      if (!state.contract) {
        wx.redirectTo({ url: '/pages/employer/create/index' });
        return;
      }
      this.setData({
        loading: false,
        state,
        pricing: buildContractPricingViewModel(state.contract),
        expiresText: state.contract.inviteExpiresAt
          ? formatDisplayDate(state.contract.inviteExpiresAt)
          : '--',
        error: ''
      });
    }).catch((error) => {
      this.setData({ loading: false, error: error.message || '读取失败' });
    });
  },

  copyInvite() {
    wx.setClipboardData({ data: this.data.state.contract.inviteCode || '' });
  },

  switchMockEmployee() {
    if (this.data.working) return;
    this.setData({ working: true, error: '' });
    api.setMockRole('employee');
    api.call('bootstrapUser', { role: 'employee' }).then((result) => {
      if (!result.ok) throw new Error(result.message);
      wx.redirectTo({ url: '/pages/employee/join/index' });
    }).catch((error) => {
      this.setData({ working: false, error: error.message || '切换阿姨端失败' });
    });
  },

  regenerate() {
    if (this.data.working) return;
    this.setData({ working: true, error: '' });
    api.call('regenerateInviteCode').then((result) => {
      if (!result.ok) throw new Error(result.message);
      wx.showToast({ title: '已重新生成', icon: 'success' });
      this.setData({ working: false });
      this.refresh();
    }).catch((error) => {
      this.setData({ working: false, error: error.message || '生成失败' });
    });
  },

  editContract() {
    wx.navigateTo({ url: '/pages/employer/create/index?mode=edit' });
  },

  resetIdentity() {
    if (this.data.working) return;
    wx.showModal({
      title: '重新选择身份',
      content: '将取消当前未匹配的合作和匹配码，重新从身份选择开始。',
      confirmText: '重新选择',
      cancelText: '取消',
      success: ({ confirm }) => {
        if (!confirm) return;
        this.setData({ working: true, error: '' });
        api.call('resetUnmatchedCooperation').then((result) => {
          if (!result.ok) throw new Error(result.message);
          wx.reLaunch({ url: '/pages/onboarding/index?reselect=1' });
        }).catch((error) => {
          this.setData({ working: false, error: error.message || '重置失败' });
        });
      }
    });
  },

  goCurrent() {
    wx.switchTab({ url: '/pages/current/index' });
  }
});
