'use strict';

const { api } = require('../../../services/api');
const { formatMoney } = require('../../../services/view-state');

Page({
  data: {
    inviteCode: '',
    preview: null,
    previewDailySalaryText: '',
    checking: false,
    submitting: false,
    error: ''
  },

  onShow() {
    api.call('getCurrentState').then((result) => {
      if (result.ok && result.data.contract) {
        wx.switchTab({ url: '/pages/current/index' });
      }
    }).catch(() => {});
  },

  onCodeInput(event) {
    this.setData({
      inviteCode: event.detail.value.toUpperCase().replace(/[^A-Z2-9]/g, ''),
      preview: null,
      previewDailySalaryText: '',
      error: ''
    });
  },

  previewInvite() {
    if (this.data.checking) return;
    if (!/^[A-Z2-9]{8}$/.test(this.data.inviteCode)) {
      this.setData({ error: '请输入 8 位匹配码。' });
      return;
    }
    this.setData({ checking: true, error: '' });
    api.call('previewInvite', { inviteCode: this.data.inviteCode })
      .then((result) => {
        if (!result.ok) throw new Error(result.message);
        this.setData({
          preview: result.data.invite,
          previewDailySalaryText: formatMoney(result.data.invite.dailySalary),
          checking: false
        });
      })
      .catch((error) => {
        this.setData({
          checking: false,
          preview: null,
          previewDailySalaryText: '',
          error: error.message || '请核对匹配码'
        });
      });
  },

  confirmJoin() {
    if (this.data.submitting || !this.data.preview) return;
    this.setData({ submitting: true, error: '' });
    api.call('joinContract', { inviteCode: this.data.inviteCode })
      .then((result) => {
        if (!result.ok) throw new Error(result.message);
        wx.showToast({ title: '匹配成功', icon: 'success' });
        setTimeout(() => wx.switchTab({ url: '/pages/current/index' }), 400);
      })
      .catch((error) => {
        this.setData({
          submitting: false,
          preview: null,
          previewDailySalaryText: '',
          error: error.message || '匹配失败，请重试'
        });
      });
  },

  restartIdentity() {
    wx.reLaunch({ url: '/pages/onboarding/index?reselect=1' });
  }
});
