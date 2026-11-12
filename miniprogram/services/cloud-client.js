'use strict';

function createCloudClient(wxApi, { cloudEnv } = {}) {
  let initialized = false;

  function ensureInitialized() {
    if (initialized) return;
    if (!wxApi.cloud) throw new Error('CLOUD_UNAVAILABLE');
    wxApi.cloud.init({
      env: cloudEnv || wxApi.cloud.DYNAMIC_CURRENT_ENV
    });
    initialized = true;
  }

  return {
    isMock: false,
    async call(action, payload = {}) {
      try {
        ensureInitialized();
        const response = await wxApi.cloud.callFunction({
          name: 'attendance',
          data: { action, payload }
        });
        if (!response || !response.result) throw new Error('EMPTY_CLOUD_RESPONSE');
        return response.result;
      } catch (error) {
        return {
          ok: false,
          code: error.code || 'NETWORK_ERROR',
          message: error.message || '网络连接失败，请稍后重试'
        };
      }
    },
    setMockRole() {
      throw new Error('Cloud mode has no mock role');
    },
    reset() {
      throw new Error('Cloud mode cannot reset local data');
    }
  };
}

module.exports = { createCloudClient };
