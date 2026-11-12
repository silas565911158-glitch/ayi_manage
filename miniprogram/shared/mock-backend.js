'use strict';

const { handleAction } = require('./backend-core');
const { MemoryRepository, emptyDatabase } = require('./memory-repository');

const STORAGE_KEY = 'aunt-attendance-db-v1';

class MockBackend {
  constructor({ storage, now = () => new Date() } = {}) {
    if (!storage) throw new Error('MockBackend requires storage');
    this.storage = storage;
    this.now = now;
    this.repository = this.load();
  }

  as(openid) {
    return {
      call: (action, payload) => this.call(action, payload, openid)
    };
  }

  async call(action, payload, openid = this.currentOpenid()) {
    try {
      const data = await handleAction({
        action,
        payload,
        openid,
        now: this.now(),
        repository: this.repository
      });
      this.persist();
      return { ok: true, data };
    } catch (error) {
      this.persist();
      throw error;
    }
  }

  reset() {
    this.repository = new MemoryRepository(emptyDatabase());
    this.persist();
  }

  currentOpenid() {
    const value = this.storage.get('aunt-attendance-current-openid');
    return value || 'mock-employer';
  }

  setCurrentOpenid(openid) {
    this.storage.set('aunt-attendance-current-openid', openid);
  }

  load() {
    const raw = this.storage.get(STORAGE_KEY);
    if (!raw) return new MemoryRepository(emptyDatabase());
    try {
      return new MemoryRepository(JSON.parse(raw));
    } catch (error) {
      return new MemoryRepository(emptyDatabase());
    }
  }

  persist() {
    this.storage.set(STORAGE_KEY, JSON.stringify(this.repository.snapshot()));
  }
}

module.exports = { MockBackend, STORAGE_KEY };
