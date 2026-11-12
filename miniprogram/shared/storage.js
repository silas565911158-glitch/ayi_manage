'use strict';

class MemoryStorage {
  constructor(initial = {}) {
    this.data = new Map(Object.entries(initial));
  }

  get(key) {
    return this.data.has(key) ? this.data.get(key) : '';
  }

  set(key, value) {
    this.data.set(key, value);
  }

  remove(key) {
    this.data.delete(key);
  }
}

module.exports = { MemoryStorage };
