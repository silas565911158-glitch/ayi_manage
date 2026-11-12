'use strict';

const { MockBackend } = require('../shared/mock-backend');

function createWxStorage(wxApi) {
  return {
    get(key) {
      const value = wxApi.getStorageSync(key);
      return value === undefined || value === null ? '' : value;
    },
    set(key, value) {
      wxApi.setStorageSync(key, value);
    },
    remove(key) {
      wxApi.removeStorageSync(key);
    }
  };
}

function createMockClient(wxApi) {
  const backend = new MockBackend({ storage: createWxStorage(wxApi) });
  return {
    isMock: true,
    async call(action, payload) {
      try {
        return await backend.call(action, payload);
      } catch (error) {
        return {
          ok: false,
          code: error.code || 'MOCK_BACKEND_ERROR',
          message: error.message || '本地模拟服务异常'
        };
      }
    },
    setMockRole(role) {
      backend.setCurrentOpenid(role === 'employee' ? 'mock-employee' : 'mock-employer');
    },
    reset() {
      backend.reset();
      backend.setCurrentOpenid('mock-employer');
    }
  };
}

module.exports = { createMockClient, createWxStorage };
