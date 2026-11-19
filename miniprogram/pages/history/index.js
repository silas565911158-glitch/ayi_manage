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
    historyTabs: [],
    selectedTabId: '',
    currentGroup: null,
    yearGroups: [],
    selectedSummary: { settledStages: 0, totalPaidAmount: 0, totalSettledDays: 0 },
    hasSettlements: false,
    expandedContractId: '',
    error: ''
  },

  onShow() {
    if (this.getTabBar) {
      this.getTabBar().setData({ selected: 1 });
    }
    this.setData({ loading: true, expandedContractId: '' });
    api.call('listHistory').then((result) => {
      if (!result.ok) {
        if (result.code === 'USER_NOT_FOUND') {
          wx.reLaunch({ url: '/pages/onboarding/index' });
          return;
        }
        throw new Error(result.message);
      }
      this.presentHistory(result.data);
    }).catch((error) => {
      this.setData({
        loading: false,
        error: error.message || '读取历史失败'
      });
    });
  },

  presentHistory(history) {
    const contracts = history.contracts || [];
    const activeGroup = contracts.find((item) => item.contract.status === 'active') || null;
    const years = (history.years || []).map((year) => ({
      id: `year-${year.year}`,
      label: String(year.year),
      summary: year.summary,
      groups: year.contracts.map((group) => this.buildContractGroup(group))
    }));

    const historyTabs = [];
    if (activeGroup) historyTabs.push({ id: 'current', label: '当前' });
    years.forEach((year) => historyTabs.push({ id: year.id, label: year.label }));

    const selectedTabId = activeGroup ? 'current' : historyTabs[0] ? historyTabs[0].id : '';
    this.setData({
      loading: false,
      role: history.user ? history.user.role : this.data.role,
      historyTabs,
      selectedTabId,
      currentGroup: activeGroup ? this.buildContractGroup(activeGroup) : null,
      yearGroups: years,
      error: ''
    });
    this.renderSelectedTab();
  },

  buildContractGroup(group) {
    const contract = group.contract;
    return {
      id: contract._id,
      contract: {
        ...contract,
        startText: formatCompactDateWithYear(contract.startDate),
        endText: contract.endedAt ? formatCompactDateWithYear(contract.endedAt) : '',
        dailySalaryText: formatMoney(
          Number(contract.totalAmount) / Number(contract.targetDays)
        )
      },
      summary: decorateSummary(group.summary),
      settlements: (group.settlements || []).map((item) => ({
        ...item,
        stageStartText: formatCompactDateWithYear(item.stageStartLocalDate),
        workEndText: formatCompactDateWithYear(item.workEndLocalDate),
        paidText: formatMoney(item.paidAmount),
        averageArrivalText: item.averageArrivalTime || '--:--'
      }))
    };
  },

  renderSelectedTab() {
    const id = this.data.selectedTabId;
    let summary;
    let hasSettlements = false;
    if (id === 'current') {
      summary = this.data.currentGroup
        ? this.data.currentGroup.summary
        : { settledStages: 0, totalPaidAmount: 0, totalSettledDays: 0 };
      hasSettlements = Boolean(
        this.data.currentGroup && this.data.currentGroup.settlements.length
      );
      this.setData({
        selectedSummary: decorateSummary(summary),
        hasSettlements
      });
      return;
    }
    const year = this.data.yearGroups.find((item) => item.id === id);
    if (year) {
      hasSettlements = year.groups.some((group) => group.settlements.length > 0);
    }
    this.setData({
      selectedSummary: decorateSummary(year ? year.summary : emptySummary()),
      hasSettlements
    });
  },

  selectHistoryTab(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || id === this.data.selectedTabId) return;
    this.setData({ selectedTabId: id, expandedContractId: '' });
    this.renderSelectedTab();
  },

  toggleContractInfo(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({
      expandedContractId: this.data.expandedContractId === id ? '' : id
    });
  },

  previewProof(event) {
    const current = event.currentTarget.dataset.url;
    const urls = this.findSettlementProofs(event.currentTarget.dataset.settlementId);
    wx.previewImage({ current, urls });
  },

  findSettlementProofs(settlementId) {
    const groups = this.data.yearGroups
      .flatMap((year) => year.groups)
      .concat(this.data.currentGroup ? [this.data.currentGroup] : []);
    const settlement = groups
      .flatMap((group) => group.settlements)
      .find((item) => item._id === settlementId);
    return settlement
      ? settlement.transferProofs.map((proof) => proof.temporaryUrl || proof.fileId)
      : [];
  }
});

function emptySummary() {
  return { settledStages: 0, totalPaidAmount: 0, totalSettledDays: 0 };
}

function decorateSummary(summary) {
  return {
    ...summary,
    totalPaidText: formatMoney(summary.totalPaidAmount)
  };
}
