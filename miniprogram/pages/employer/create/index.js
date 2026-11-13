'use strict';

const { api } = require('../../../services/api');
const {
  buildContractPricingViewModel,
  formatCompactDateWithYear,
  formatShanghaiDateInput
} = require('../../../services/view-state');

function defaultForm() {
  return {
    totalAmount: '8000',
    targetDays: '26',
    startDate: formatShanghaiDateInput(),
    address: '',
    latitude: '',
    longitude: '',
    radiusMeters: 300
  };
}

Page({
  data: {
    editing: false,
    form: defaultForm(),
    startDisplayText: formatCompactDateWithYear(defaultForm().startDate),
    submitting: false,
    error: '',
    pricing: buildContractPricingViewModel(defaultForm())
  },

  onLoad(options = {}) {
    const editing = options.mode === 'edit';
    this.setData({ editing });
    wx.setNavigationBarTitle({ title: editing ? '修改合作' : '创建合作' });
    if (editing) this.loadContract();
  },

  loadContract() {
    api.call('getCurrentState').then((result) => {
      if (!result.ok) throw new Error(result.message);
      const contract = result.data.contract;
      if (!contract) {
        wx.redirectTo({ url: '/pages/employer/create/index' });
        return;
      }
      if (contract.employeeBound) {
        wx.switchTab({ url: '/pages/current/index' });
        return;
      }
      const form = {
        totalAmount: String(contract.totalAmount),
        targetDays: String(contract.targetDays),
        startDate: contract.startDate,
        address: contract.homeLocation.address,
        latitude: String(contract.homeLocation.latitude),
        longitude: String(contract.homeLocation.longitude),
        radiusMeters: contract.radiusMeters
      };
      this.setData({
        form,
        startDisplayText: formatCompactDateWithYear(form.startDate),
        pricing: buildContractPricingViewModel(form)
      });
    }).catch((error) => {
      this.setData({ error: error.message || '读取合作失败' });
    });
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    const form = { ...this.data.form, [field]: event.detail.value };
    this.setData({
      form,
      error: '',
      pricing: buildContractPricingViewModel(form)
    });
  },

  onDateChange(event) {
    this.setData({
      'form.startDate': event.detail.value,
      startDisplayText: formatCompactDateWithYear(event.detail.value),
      error: ''
    });
  },

  onRadiusChange(event) {
    this.setData({
      'form.radiusMeters': Number(event.detail.value),
      pricing: buildContractPricingViewModel(this.data.form)
    });
  },

  chooseHome() {
    wx.chooseLocation({
      success: (location) => {
        this.setData({
          'form.address': location.address || location.name || '已选择家庭位置',
          'form.latitude': location.latitude,
          'form.longitude': location.longitude,
          error: ''
        });
      },
      fail: (error) => {
        const message = error.errMsg && /auth deny|denied|authorize/.test(error.errMsg)
          ? '需要位置权限才能选择家庭位置。请返回设置开启。'
          : '未选择家庭位置，请重新选择。';
        this.setData({ error: message });
      }
    });
  },

  submit() {
    if (this.data.submitting) return;
    const form = this.data.form;
    if (
      !String(form.latitude).trim() ||
      !String(form.longitude).trim() ||
      !String(form.address).trim()
    ) {
      this.setData({ error: '请点击「地图选择位置」确定家庭位置。' });
      return;
    }

    this.setData({ submitting: true, error: '' });
    wx.showLoading({ title: this.data.editing ? '正在保存' : '正在创建', mask: true });
    api.call(this.data.editing ? 'updateContract' : 'createContract', form)
      .then((result) => {
        wx.hideLoading();
        if (!result.ok) throw new Error(result.message);
        if (this.data.editing) {
          wx.navigateBack();
        } else {
          wx.redirectTo({ url: '/pages/employer/waiting/index' });
        }
      })
      .catch((error) => {
        wx.hideLoading();
        this.setData({ submitting: false, error: error.message || '保存失败，请重试' });
      });
  }
});
