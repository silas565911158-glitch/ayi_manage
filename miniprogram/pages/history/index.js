'use strict';

const { api } = require('../../services/api');
const {
  formatCompactDateWithYear,
  formatMoney
} = require('../../services/view-state');

Page({
  data: {
    loading: true,
    role: 'employee',
    contractTabs: [],
    selectedContractId: '',
    contract: null,
    dailySalaryText: formatMoney(0),
    showContract: false,
    summary: { settledStages: 0, totalPaidAmount: 0, totalSettledDays: 0 },
    totalPaidText: formatMoney(0),
    totalSettledDaysText: '0',
    settlements: []
  },

  onShow() {
    if (this.getTabBar) {
      this.getTabBar().setData({ selected: 1 });
    }
    this.setData({ loading: true, showContract: false });
    api.call('listHistory').then((result) => {
      if (!result.ok) {
        if (result.code === 'USER_NOT_FOUND') {
          wx.reLaunch({ url: '/pages/onboarding/index' });
          return;
        }
        throw new Error(result.message);
      }

      const contracts = (result.data.contracts || []).map((item, index) => ({
        ...item,
        id: item.contract._id,
        label: item.contract.status === 'active' && index === 0
          ? '当前合作'
          : `${String(item.contract.startDate).slice(0, 4)}合作`
      }));
      this.setData({
        loading: false,
        role: result.data.user ? result.data.user.role : this.data.role,
        contractTabs: contracts,
        selectedContractId: result.data.selectedContractId || ''
      });
      this.presentContract(
        contracts.find((item) => item.id === this.data.selectedContractId) || contracts[0]
      );
    }).catch((error) => {
      this.setData({ loading: false });
      wx.showToast({ title: error.message || '读取历史失败', icon: 'none' });
    });
  },

  presentContract(contractGroup) {
    if (!contractGroup) {
      this.setData({
        contract: null,
        summary: { settledStages: 0, totalPaidAmount: 0, totalSettledDays: 0 },
        totalPaidText: formatMoney(0),
        totalSettledDaysText: '0',
        settlements: []
      });
      return;
    }
    const settlements = contractGroup.settlements.map((item) => ({
      ...item,
      stageStartText: formatCompactDateWithYear(item.stageStartLocalDate),
      workEndText: formatCompactDateWithYear(item.workEndLocalDate),
      paidText: formatMoney(item.paidAmount),
      averageArrivalText: item.averageArrivalTime || '--:--'
    }));
    this.setData({
      selectedContractId: contractGroup.id,
      contract: {
        ...contractGroup.contract,
        startText: formatCompactDateWithYear(contractGroup.contract.startDate)
      },
      dailySalaryText: formatMoney(
        Number(contractGroup.contract.totalAmount) / Number(contractGroup.contract.targetDays)
      ),
      summary: contractGroup.summary,
      totalPaidText: formatMoney(contractGroup.summary.totalPaidAmount),
      totalSettledDaysText: String(contractGroup.summary.totalSettledDays || 0),
      settlements
    });
  },

  selectContract(event) {
    const id = event.currentTarget.dataset.id;
    const contractGroup = this.data.contractTabs.find((item) => item.id === id);
    if (!contractGroup || id === this.data.selectedContractId) return;
    this.setData({ showContract: false });
    this.presentContract(contractGroup);
  },

  toggleContract() {
    this.setData({ showContract: !this.data.showContract });
  },

  previewProof(event) {
    const urls = this.data.settlements
      .flatMap((item) => item.transferProofs.map((proof) => proof.temporaryUrl || proof.fileId));
    wx.previewImage({ current: event.currentTarget.dataset.url, urls });
  }
});
