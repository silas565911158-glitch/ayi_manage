'use strict';

class BusinessError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'BusinessError';
    this.code = code;
  }
}

function isBusinessError(error) {
  return error instanceof BusinessError;
}

module.exports = { BusinessError, isBusinessError };
