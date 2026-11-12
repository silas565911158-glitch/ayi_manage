'use strict';

Component({
  data: {
    selected: 0,
    items: [
      { path: '/pages/current/index', text: '当期' },
      { path: '/pages/history/index', text: '历史' }
    ]
  },
  methods: {
    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index);
      const item = this.data.items[index];
      wx.switchTab({ url: item.path });
      this.setData({ selected: index });
    }
  }
});
