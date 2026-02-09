'use strict';

const {
  generateStoreId,
  generateRequestId,
  storeIdToNamespace,
  storeIdToHelmRelease,
} = require('../../src/utils/idGenerator');

describe('ID Generator', () => {
  describe('generateStoreId', () => {
    it('returns a string starting with "store-"', () => {
      const id = generateStoreId();
      expect(id).toMatch(/^store-[a-f0-9]{8}$/);
    });

    it('generates unique IDs', () => {
      const ids = new Set();
      for (let i = 0; i < 1000; i++) {
        ids.add(generateStoreId());
      }
      expect(ids.size).toBe(1000);
    });
  });

  describe('generateRequestId', () => {
    it('returns a string starting with "req_"', () => {
      const id = generateRequestId();
      expect(id).toMatch(/^req_[a-f0-9]{12}$/);
    });

    it('generates unique IDs', () => {
      const ids = new Set();
      for (let i = 0; i < 1000; i++) {
        ids.add(generateRequestId());
      }
      expect(ids.size).toBe(1000);
    });
  });

  describe('storeIdToNamespace', () => {
    it('returns the store ID as-is (already DNS-compatible)', () => {
      expect(storeIdToNamespace('store-a1b2c3d4')).toBe('store-a1b2c3d4');
    });
  });

  describe('storeIdToHelmRelease', () => {
    it('returns the store ID as the release name', () => {
      expect(storeIdToHelmRelease('store-a1b2c3d4')).toBe('store-a1b2c3d4');
    });
  });
});
