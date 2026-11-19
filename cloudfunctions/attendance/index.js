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
      await addTemporaryTransferProofUrls(data, sdk);
      return { ok: true, data };
    } catch (error) {
      const log = {
        action: event.action || '',
        code: error.code || (error instanceof BusinessError ? error.code : 'CLOUD_FUNCTION_ERROR'),
        message: error.message || ''
      };
      if (error instanceof BusinessError) {
        console.warn('attendance business rejection', log);
        return { ok: false, code: error.code, message: error.message };
      }
      console.error('attendance unexpected failure', { ...log, stack: error.stack || '' });
      return { ok: false, code: 'CLOUD_FUNCTION_ERROR', message: '服务暂时不可用，请稍后重试' };
    }
  };
}

async function addTemporaryTransferProofUrls(data, sdk) {
  if (!data || !sdk || typeof sdk.getTempFileURL !== 'function') return data;

  const proofGroups = [];
  collectTransferProofGroups(data, proofGroups);
  const proofs = proofGroups
    .flat()
    .filter((proof) => proof && typeof proof.fileId === 'string' && proof.fileId.startsWith('cloud://'));
  if (proofs.length === 0) return data;

  for (let index = 0; index < proofs.length; index += 50) {
    try {
      const chunk = proofs.slice(index, index + 50).map((proof) => proof.fileId);
      const result = await sdk.getTempFileURL({ fileList: chunk });
      const fileList = Array.isArray(result) ? result : result.fileList || [];
      const urls = new Map();
      fileList.forEach((item) => {
        if (item && item.fileID && item.tempFileURL) {
          urls.set(item.fileID, item.tempFileURL);
        }
      });
      proofs.forEach((proof) => {
        const temporaryUrl = urls.get(proof.fileId);
        if (temporaryUrl) proof.temporaryUrl = temporaryUrl;
      });
    } catch (error) {
      // Transfer proofs remain available to their uploader. A temporary URL is only
      // needed so the other participant can view a file from a private bucket.
    }
  }
  return data;
}

function collectTransferProofGroups(value, groups) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectTransferProofGroups(item, groups));
    return;
  }
  if (Array.isArray(value.transferProofs)) groups.push(value.transferProofs);
  Object.values(value).forEach((child) => collectTransferProofGroups(child, groups));
}

exports.createHandler = createHandler;
exports.addTemporaryTransferProofUrls = addTemporaryTransferProofUrls;
exports.main = createHandler();
