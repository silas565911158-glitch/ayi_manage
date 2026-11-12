'use strict';

const { CloudDatabaseRepository } = require('./repository');
const { handleAction } = require('./backend-core');
const { BusinessError } = require('./errors');

let cloudSDK;
try {
  cloudSDK = require('wx-server-sdk');
  cloudSDK.init({ env: cloudSDK.DYNAMIC_CURRENT_ENV });
} catch (error) {
  cloudSDK = null;
}

function createHandler({
  cloudSDK: sdk = cloudSDK,
  repositoryFactory,
  now = () => new Date()
} = {}) {
  return async function main(event = {}) {
    try {
      if (!sdk) throw new BusinessError('CLOUD_UNAVAILABLE', '云开发环境不可用');
      const wxContext = sdk.getWXContext();
      const repository = repositoryFactory
        ? repositoryFactory(sdk)
        : new CloudDatabaseRepository(sdk.database());
      const data = await handleAction({
        action: event.action,
        payload: event.payload || {},
        openid: wxContext.OPENID,
        now: now(),
        repository
      });
      return { ok: true, data };
    } catch (error) {
      if (error instanceof BusinessError) {
        return { ok: false, code: error.code, message: error.message };
      }
      return { ok: false, code: 'CLOUD_FUNCTION_ERROR', message: '服务暂时不可用，请稍后重试' };
    }
  };
}

exports.createHandler = createHandler;
exports.main = createHandler();
