'use strict';

const runtimeConfig = require('../config/runtime');
const { createMockClient } = require('./mock-client');
const { createCloudClient } = require('./cloud-client');

function createApiClient({
  runtime = runtimeConfig,
  wxApi = typeof wx === 'undefined' ? null : wx,
  mockClientFactory = createMockClient,
  cloudClientFactory = createCloudClient
} = {}) {
  let client;

  function getClient() {
    if (client) return client;
    if (!wxApi) {
      return {
        async call() {
          return { ok: false, code: 'RUNTIME_UNAVAILABLE', message: '微信运行环境不可用' };
        },
        setMockRole() {},
        reset() {}
      };
    }
    if (runtime.mode === 'mock') {
      client = mockClientFactory(wxApi);
    } else if (runtime.mode === 'cloud') {
      client = cloudClientFactory(wxApi, { cloudEnv: runtime.cloudEnv });
    } else {
      client = {
        async call() {
          return { ok: false, code: 'INVALID_RUNTIME_MODE', message: '运行模式配置无效' };
        },
        setMockRole() {},
        reset() {}
      };
    }
    return client;
  }

  return {
    mode: runtime.mode,
    async call(action, payload) {
      const backend = getClient();
      try {
        return await backend.call(action, payload);
      } catch (error) {
        return { ok: false, code: 'NETWORK_ERROR', message: '网络连接失败，请稍后重试' };
      }
    },
    setMockRole(role) {
      getClient().setMockRole(role);
    },
    resetMockData() {
      getClient().reset();
    }
  };
}

const api = createApiClient();

module.exports = { api, createApiClient };
