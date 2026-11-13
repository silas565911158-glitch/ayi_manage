'use strict';

const { api } = require('../../services/api');
const {
  buildSettlementExplanation,
  formatCompactDateWithYear
} = require('../../services/view-state');

Page({
  data: {
    state: null,
    workRangeText: '',
    workEndText: '',
    today: '',
    dailySalaryText: '',
    suggestedText: '',
    calculation: null,
    paidAmount: '',
    differenceReason: '',
    images: [],
    submitting: false,
    error: ''
  },

  onLoad() {
    this.refresh();
  },

  refresh() {
    api.call('getCurrentState').then((result) => {
      if (!result.ok) throw new Error(result.message);
      const state = result.data;
      const checkins = state.calendarCheckins || [];
      const workEnd = checkins.length > 0
        ? checkins[checkins.length - 1].localDate
        : state.today.localDate;
      const nextStageStart = shiftLocalDate(workEnd, 1);
      const calculation = buildSettlementExplanation({
        totalAmount: state.contract.totalAmount,
        targetDays: state.contract.targetDays,
        days: state.currentStage.days,
        dailySalary: state.currentStage.dailySalary,
        suggestedAmount: state.currentStage.suggestedAmount,
        paidAmount: state.currentStage.suggestedAmount
      });
      const viewModel = {
        state,
        today: state.today.localDate,
        workRangeText: `${formatCompactDateWithYear(state.currentStage.startLocalDate)} 至 ${formatCompactDateWithYear(workEnd)}`,
        workEndText: formatCompactDateWithYear(workEnd),
        nextStageStart: formatCompactDateWithYear(nextStageStart),
        dailySalaryText: calculation.dailySalaryText,
        suggestedText: calculation.suggestedText,
        calculation,
        paidAmount: String(state.currentStage.suggestedAmount || 0),
        error: ''
      };
      this.setData(viewModel);
    }).catch((error) => {
      this.setData({ error: error.message || '读取失败' });
    });
  },

  onPaidInput(event) {
    this.setData({ paidAmount: event.detail.value, error: '' });
  },

  onReasonInput(event) {
    this.setData({ differenceReason: event.detail.value, error: '' });
  },

  chooseImage() {
    wx.chooseMedia({
      count: 3 - this.data.images.length,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: ({ tempFiles }) => {
        const paths = tempFiles.map((file) => file.tempFilePath);
        this.saveProofs(paths.slice(0, 3 - this.data.images.length));
      }
    });
  },

  removeImage(event) {
    const images = [...this.data.images];
    images.splice(Number(event.currentTarget.dataset.index), 1);
    this.setData({ images });
  },

  previewImage(event) {
    const index = Number(event.currentTarget.dataset.index);
    wx.previewImage({
      current: this.data.images[index].path,
      urls: this.data.images.map((item) => item.path)
    });
  },

  submit() {
    if (this.data.submitting) return;
    const paid = Number(this.data.paidAmount);
    if (!Number.isFinite(paid) || paid < 0 || paid > 1000000) {
      this.setData({ error: '请输入正确的实付金额。' });
      return;
    }
    if (this.data.images.length < 1) {
      this.setData({ error: '请至少上传 1 张转账截图。' });
      return;
    }
    const difference = Math.round((paid - this.data.state.currentStage.suggestedAmount) * 100) / 100;
    if (Math.abs(difference) >= 0.01 && !this.data.differenceReason.trim()) {
      this.setData({ error: '实付金额与计算不一致，请填写原因。' });
      return;
    }

    this.confirmSettlement(paid);
  },

  confirmSettlement(paid) {
    wx.showModal({
      title: '确认发起结算',
      content: `实付 ¥${paid.toFixed(2)}，已上传 ${this.data.images.length} 张转账截图。确认后需阿姨确认收款。`,
      confirmText: '确认发送',
      cancelText: '再检查',
      success: ({ confirm }) => {
        if (!confirm) return;
        this.sendSettlement(paid);
      }
    });
  },

  sendSettlement(paid) {
    this.setData({ submitting: true, error: '' });
    this.persistProofs().then((proofs) => api.call('createSettlementRequest', {
      paidAmount: paid,
      differenceReason: this.data.differenceReason.trim(),
      transferProofs: proofs
    })).then((result) => {
      if (!result.ok) throw new Error(result.message);
      wx.showToast({ title: '已发给阿姨', icon: 'success' });
      setTimeout(() => wx.switchTab({ url: '/pages/current/index' }), 400);
    }).catch((error) => {
      this.setData({ submitting: false, error: error.message || '发起失败' });
    });
  },

  saveProofs(tempPaths) {
    const images = [...this.data.images];
    Promise.all(tempPaths.map((path, index) => saveLocalProof(path, images.length + index)))
      .then((savedPaths) => {
        savedPaths.forEach((savedPath) => images.push({ path: savedPath }));
        this.setData({ images, error: '' });
      })
      .catch(() => {
        this.setData({ error: '保存转账截图失败，请重新选择。' });
      });
  },

  persistProofs() {
    if (api.mode !== 'cloud') {
      return Promise.resolve(this.data.images.map((item) => ({ fileId: item.path })));
    }
    const contractId = this.data.state.contract._id;
    return Promise.all(this.data.images.map((item, index) => uploadCloudProof(
      item.path,
      contractId,
      index
    ))).then((fileIds) => fileIds.map((fileId) => ({ fileId })));
  }
});

function saveLocalProof(tempPath, index) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().saveFile({
      tempFilePath: tempPath,
      filePath: `${wx.env.USER_DATA_PATH}/transfer-proof-${Date.now()}-${index}.jpg`,
      success: (result) => resolve(result.savedFilePath),
      fail: reject
    });
  });
}

function uploadCloudProof(tempPath, contractId, index) {
  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath: `transfer-proofs/${contractId}/${Date.now()}-${index}.jpg`,
      filePath: tempPath,
      success: (result) => resolve(result.fileID),
      fail: reject
    });
  });
}

function shiftLocalDate(localDate, days) {
  const date = new Date(`${localDate}T00:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
