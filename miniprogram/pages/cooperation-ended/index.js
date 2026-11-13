'use strict';

const { api } = require('../../services/api');
const { formatMoney } = require('../../services/view-state');

Page({
  data: {
    loading: true,
    summary: { settledStages: 0, totalSettledDays: 0, totalPaidAmount: 0 },
    totalPaidText: formatMoney(0),
    endedReason: '',
    error: ''
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    this.setData({ loading: true });
    api.call('getCurrentState').then((result) => {
      if (!result.ok) throw new Error(result.message);
      if (!result.data.lastCooperation) {
        wx.reLaunch({ url: '/pages/onboarding/index?reselect=1' });
        return;
      }
      this.setData({
        loading: false,
        summary: result.data.lastCooperation.summary,
        totalPaidText: formatMoney(result.data.lastCooperation.summary.totalPaidAmount),
        endedReason: result.data.lastCooperation.endedReason || '双方协商结束',
        error: ''
      });
    }).catch((error) => {
      this.setData({ loading: false, error: error.message || '读取失败' });
    });
  },

  restart() {
    wx.reLaunch({ url: '/pages/onboarding/index?reselect=1' });
  }
});
