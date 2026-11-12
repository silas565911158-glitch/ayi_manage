'use strict';

const { api } = require('../../services/api');

Page({
  data: {
    submitting: '',
    routing: false
  },

  onLoad(options = {}) {
    this.allowReselect = options.reselect === '1';
  },

  onShow() {
    this.restoreExistingFlow();
  },

  restoreExistingFlow() {
    if (this.data.routing) return;
    if (this.allowReselect) return;
    api.call('getCurrentState')
      .then((result) => {
        if (!result.ok || !result.data || !result.data.user) return;
        this.routeToNextStep(result.data);
      })
      .catch(() => {});
  },

  chooseRole(event) {
    const role = event.currentTarget.dataset.role;
    if (this.data.submitting || this.data.routing) return;
    this.setData({ submitting: role });
    if (api.mode === 'mock') api.setMockRole(role);

    api.call('bootstrapUser', { role })
      .then((result) => {
        if (!result.ok) throw new Error(result.message);
        return api.call('getCurrentState');
      })
      .then((state) => {
        if (!state.ok) throw new Error(state.message);
        this.routeToNextStep(state.data);
      })
      .catch((error) => {
        wx.showToast({ title: error.message || '选择身份失败', icon: 'none' });
        this.setData({ submitting: '' });
      });
  },

  routeToNextStep(state) {
    const role = state.user.role;
    this.setData({ routing: true });
    if (state.contract) {
      if (role === 'employer' && !state.contract.employeeOpenid) {
        wx.redirectTo({ url: '/pages/employer/waiting/index' });
        return;
      }
      wx.switchTab({ url: '/pages/current/index' });
      return;
    }
    if (role === 'employer') {
      wx.redirectTo({ url: '/pages/employer/create/index' });
      return;
    }
    wx.redirectTo({ url: '/pages/employee/join/index' });
  }
});
