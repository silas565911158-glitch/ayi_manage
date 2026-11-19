'use strict';

const { api } = require('../../services/api');
const {
  buildSettlementExplanation,
  formatCompactDateWithYear,
  formatMoney,
  getTransferProofUrl
} = require('../../services/view-state');

Page({
  data: {
    loading: true,
    role: '',
    state: null,
    explanation: null,
    nextStageStartText: '',
    paidText: formatMoney(0),
    title: '',
    working: false,
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
      if (!state.pendingSettlement) {
        wx.switchTab({ url: '/pages/current/index' });
        return;
      }

      const pending = state.pendingSettlement;
      const nextStageStartText = formatCompactDateWithYear(pending.nextStageStartLocalDate);
      const explanation = buildSettlementExplanation({
        totalAmount: pending.totalAmount,
        targetDays: pending.targetDays,
        days: pending.days,
        dailySalary: pending.dailySalary,
        suggestedAmount: pending.suggestedAmount,
        paidAmount: pending.paidAmount
      });
      this.setData({
        loading: false,
        role: state.user.role,
        state,
        explanation,
        nextStageStartText,
        paidText: formatMoney(pending.paidAmount),
        title: pending.status === 'disputed'
          ? '阿姨对金额有疑问'
          : state.user.role === 'employer'
            ? '等待阿姨确认收款'
            : '雇主已结算，请确认',
        working: false,
        error: ''
      });
    }).catch((error) => {
      this.setData({ loading: false, error: error.message || '读取失败' });
    });
  },

  previewProof(event) {
    const proofs = this.data.state.pendingSettlement.transferProofs;
    wx.previewImage({
      current: getTransferProofUrl(proofs[Number(event.currentTarget.dataset.index)]),
      urls: proofs.map(getTransferProofUrl)
    });
  },

  confirmSettlement() {
    if (this.data.working) return;
    wx.showModal({
      title: '确认收款',
      content: `确认收到 ${this.data.paidText}？确认后新一期从 ${this.data.nextStageStartText} 开始。`,
      confirmText: '确认收款',
      cancelText: '再看看',
      success: ({ confirm }) => {
        if (!confirm) return;
        this.setData({ working: true, error: '' });
        api.call('confirmSettlementRequest').then((result) => {
          if (!result.ok) throw new Error(result.message);
          wx.showToast({ title: '已确认', icon: 'success' });
          setTimeout(() => wx.switchTab({ url: '/pages/current/index' }), 400);
        }).catch((error) => {
          this.setData({ working: false, error: error.message || '确认失败' });
        });
      }
    });
  },

  disputeSettlement() {
    if (this.data.working) return;
    this.setData({ working: true, error: '' });
    api.call('disputeSettlementRequest', { reason: '金额不对' }).then((result) => {
      if (!result.ok) throw new Error(result.message);
      wx.showToast({ title: '已通知雇主', icon: 'none' });
      this.refresh();
    }).catch((error) => {
      this.setData({ working: false, error: error.message || '操作失败' });
    });
  },

  cancelSettlement() {
    if (this.data.working) return;
    wx.showModal({
      title: '取消结算',
      content: '取消后这一期继续记工，不会生成历史记录。',
      confirmText: '取消结算',
      cancelText: '保留',
      success: ({ confirm }) => {
        if (!confirm) return;
        this.setData({ working: true, error: '' });
        api.call('cancelSettlementRequest').then((result) => {
          if (!result.ok) throw new Error(result.message);
          wx.showToast({ title: '已取消', icon: 'success' });
          setTimeout(() => wx.switchTab({ url: '/pages/current/index' }), 400);
        }).catch((error) => {
          this.setData({ working: false, error: error.message || '取消失败' });
        });
      }
    });
  }
});
