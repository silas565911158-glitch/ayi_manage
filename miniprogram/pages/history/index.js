'use strict';

const { api } = require('../../services/api');
const { buildSettlementExplanation, formatMoney } = require('../../services/view-state');

Page({
  data: {
    loading: true,
    role: 'employee',
    summary: { settledStages: 0, totalPaidAmount: 0, totalSettledDays: 0 },
    totalPaidText: formatMoney(0),
    totalSettledDaysText: '0',
    settlements: []
  },

  onShow() {
    if (this.getTabBar) {
      this.getTabBar().setData({ selected: 1 });
    }
    this.setData({ loading: true });
    api.call('listHistory').then((result) => {
      if (!result.ok) {
        if (result.code === 'USER_NOT_FOUND') {
          wx.reLaunch({ url: '/pages/onboarding/index' });
          return;
        }
        throw new Error(result.message);
      }
      const settlements = (result.data.settlements || []).map((item) => ({
        ...item,
        dailySalaryText: formatMoney(item.dailySalary),
        paidText: formatMoney(item.paidAmount),
        calculation: buildSettlementExplanation({
          totalAmount: item.totalAmount,
          targetDays: item.targetDays,
          days: item.days,
          dailySalary: item.dailySalary,
          suggestedAmount: item.suggestedAmount,
          paidAmount: item.paidAmount
        })
      }));
      this.setData({
            loading: false,
        role: result.data.user ? result.data.user.role : this.data.role,
        summary: result.data.summary,
        totalPaidText: formatMoney(result.data.summary.totalPaidAmount),
        totalSettledDaysText: String(result.data.summary.totalSettledDays || 0),
        settlements
      });
    }).catch((error) => {
        this.setData({ loading: false });
      wx.showToast({ title: error.message || '读取历史失败', icon: 'none' });
    });
  },

  previewProof(event) {
    wx.previewImage({ current: event.currentTarget.dataset.url, urls: this.data.settlements
      .flatMap((item) => item.transferProofs.map((proof) => proof.temporaryUrl || proof.fileId)) });
  }
});
