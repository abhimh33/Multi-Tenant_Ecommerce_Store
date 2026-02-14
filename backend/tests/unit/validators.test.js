'use strict';

const Joi = require('joi');

// Import schemas from validators
const {
  registerSchema,
  loginSchema,
  createStoreSchema,
  listStoresSchema,
  storeIdSchema,
  logsQuerySchema,
  auditQuerySchema,
} = require('../../src/middleware/validators');

describe('Validation Schemas', () => {
  // ─── Register Schema ──────────────────────────────────────────────────
  describe('registerSchema', () => {
    it('accepts valid registration', () => {
      const { error } = registerSchema.validate({
        email: 'test@example.com',
        username: 'testuser',
        password: 'password123',
      });
      expect(error).toBeUndefined();
    });

    it('rejects missing email', () => {
      const { error } = registerSchema.validate({
        username: 'testuser',
        password: 'password123',
      });
      expect(error).toBeDefined();
    });

    it('rejects invalid email format', () => {
      const { error } = registerSchema.validate({
        email: 'not-an-email',
        username: 'testuser',
        password: 'password123',
      });
      expect(error).toBeDefined();
    });

    it('rejects short password', () => {
      const { error } = registerSchema.validate({
        email: 'test@example.com',
        username: 'testuser',
        password: 'short',
      });
      expect(error).toBeDefined();
    });

    it('rejects username with special characters', () => {
      const { error } = registerSchema.validate({
        email: 'test@example.com',
        username: 'test user!',
        password: 'password123',
      });
      expect(error).toBeDefined();
    });

    it('strips unknown fields', () => {
      const { value } = registerSchema.validate({
        email: 'test@example.com',
        username: 'testuser',
        password: 'password123',
        ownerId: 'injected',
        role: 'admin',
      });
      expect(value.ownerId).toBeUndefined();
      expect(value.role).toBeUndefined();
    });
  });

  // ─── Login Schema ─────────────────────────────────────────────────────
  describe('loginSchema', () => {
    it('accepts valid login', () => {
      const { error } = loginSchema.validate({
        email: 'test@example.com',
        password: 'password123',
      });
      expect(error).toBeUndefined();
    });

    it('rejects missing password', () => {
      const { error } = loginSchema.validate({
        email: 'test@example.com',
      });
      expect(error).toBeDefined();
    });
  });

  // ─── Create Store Schema ──────────────────────────────────────────────
  describe('createStoreSchema', () => {
    it('accepts valid store name', () => {
      const { error, value } = createStoreSchema.validate({
        name: 'my-store-01',
        engine: 'woocommerce',
      });
      expect(error).toBeUndefined();
      expect(value.name).toBe('my-store-01');
    });

    it('rejects uppercase store names', () => {
      const { error } = createStoreSchema.validate({
        name: 'My-Store',
        engine: 'woocommerce',
      });
      expect(error).toBeDefined();
    });

    it('rejects store names starting with hyphen', () => {
      const { error } = createStoreSchema.validate({
        name: '-my-store',
        engine: 'woocommerce',
      });
      expect(error).toBeDefined();
    });

    it('rejects store names ending with hyphen', () => {
      const { error } = createStoreSchema.validate({
        name: 'my-store-',
        engine: 'woocommerce',
      });
      expect(error).toBeDefined();
    });

    it('rejects store names with consecutive hyphens', () => {
      const { error } = createStoreSchema.validate({
        name: 'my--store',
        engine: 'woocommerce',
      });
      expect(error).toBeDefined();
    });

    it('rejects reserved store names', () => {
      const reserved = ['admin', 'api', 'kubernetes', 'default', 'login', 'store'];
      for (const name of reserved) {
        const { error } = createStoreSchema.validate({
          name,
          engine: 'woocommerce',
        });
        expect(error).toBeDefined();
      }
    });

    it('rejects names shorter than 3 characters', () => {
      const { error } = createStoreSchema.validate({
        name: 'ab',
        engine: 'woocommerce',
      });
      expect(error).toBeDefined();
    });

    it('rejects names longer than 63 characters', () => {
      const { error } = createStoreSchema.validate({
        name: 'a'.repeat(64),
        engine: 'woocommerce',
      });
      expect(error).toBeDefined();
    });

    it('rejects invalid engine', () => {
      const { error } = createStoreSchema.validate({
        name: 'my-store',
        engine: 'shopify',
      });
      expect(error).toBeDefined();
    });

    it('strips ownerId if provided (tenant isolation)', () => {
      const { value } = createStoreSchema.validate({
        name: 'my-store',
        engine: 'woocommerce',
        ownerId: 'injected-owner',
      });
      expect(value.ownerId).toBeUndefined();
    });

    it('accepts medusa engine', () => {
      const { error } = createStoreSchema.validate({
        name: 'medusa-store',
        engine: 'medusa',
      });
      expect(error).toBeUndefined();
    });

    it('accepts storefront theme for woocommerce', () => {
      const { error, value } = createStoreSchema.validate({
        name: 'woo-store',
        engine: 'woocommerce',
        theme: 'storefront',
      });
      expect(error).toBeUndefined();
      expect(value.theme).toBe('storefront');
    });

    it('accepts astra theme for woocommerce', () => {
      const { error, value } = createStoreSchema.validate({
        name: 'woo-store',
        engine: 'woocommerce',
        theme: 'astra',
      });
      expect(error).toBeUndefined();
      expect(value.theme).toBe('astra');
    });

    it('defaults theme to storefront for woocommerce', () => {
      const { error, value } = createStoreSchema.validate({
        name: 'woo-store',
        engine: 'woocommerce',
      });
      expect(error).toBeUndefined();
      expect(value.theme).toBe('storefront');
    });

    it('rejects theme for medusa engine', () => {
      const { error } = createStoreSchema.validate({
        name: 'medusa-store',
        engine: 'medusa',
        theme: 'storefront',
      });
      expect(error).toBeDefined();
    });

    it('rejects invalid theme', () => {
      const { error } = createStoreSchema.validate({
        name: 'woo-store',
        engine: 'woocommerce',
        theme: 'divi',
      });
      expect(error).toBeDefined();
    });
  });

  // ─── List Stores Schema ───────────────────────────────────────────────
  describe('listStoresSchema', () => {
    it('accepts empty query (uses defaults)', () => {
      const { error, value } = listStoresSchema.validate({});
      expect(error).toBeUndefined();
      expect(value.limit).toBe(50);
      expect(value.offset).toBe(0);
    });

    it('accepts valid filters', () => {
      const { error } = listStoresSchema.validate({
        status: 'ready',
        engine: 'woocommerce',
        limit: 10,
        offset: 20,
      });
      expect(error).toBeUndefined();
    });

    it('rejects invalid status', () => {
      const { error } = listStoresSchema.validate({
        status: 'invalid-status',
      });
      expect(error).toBeDefined();
    });

    it('rejects limit above max', () => {
      const { error } = listStoresSchema.validate({
        limit: 500,
      });
      expect(error).toBeDefined();
    });
  });

  // ─── Store ID Schema ──────────────────────────────────────────────────
  describe('storeIdSchema', () => {
    it('accepts valid store ID', () => {
      const { error } = storeIdSchema.validate({ id: 'store-a1b2c3d4' });
      expect(error).toBeUndefined();
    });

    it('rejects invalid store ID format', () => {
      const { error } = storeIdSchema.validate({ id: 'not-a-store-id' });
      expect(error).toBeDefined();
    });

    it('rejects uppercase hex', () => {
      const { error } = storeIdSchema.validate({ id: 'store-A1B2C3D4' });
      expect(error).toBeDefined();
    });
  });

  // ─── Logs Query Schema ────────────────────────────────────────────────
  describe('logsQuerySchema', () => {
    it('applies defaults', () => {
      const { value } = logsQuerySchema.validate({});
      expect(value.limit).toBe(100);
      expect(value.offset).toBe(0);
    });

    it('rejects limit above 500', () => {
      const { error } = logsQuerySchema.validate({ limit: 501 });
      expect(error).toBeDefined();
    });
  });

  // ─── Audit Query Schema ───────────────────────────────────────────────
  describe('auditQuerySchema', () => {
    it('accepts valid audit query', () => {
      const { error, value } = auditQuerySchema.validate({
        storeId: 'store-a1b2c3d4',
        eventType: 'status_change',
        limit: 50,
      });
      expect(error).toBeUndefined();
      expect(value.limit).toBe(50);
    });

    it('rejects invalid store ID in audit query', () => {
      const { error } = auditQuerySchema.validate({
        storeId: 'invalid-id',
      });
      expect(error).toBeDefined();
    });
  });

  // ─── Profanity Filter ─────────────────────────────────────────────────
  describe('profanity filter', () => {
    it('rejects store names containing profanity', () => {
      const { error } = createStoreSchema.validate({
        name: 'my-fuck-store',
        engine: 'medusa',
      });
      expect(error).toBeDefined();
    });

    it('rejects profanity as exact store name', () => {
      const { error } = createStoreSchema.validate({
        name: 'porn',
        engine: 'woocommerce',
      });
      expect(error).toBeDefined();
    });

    it('rejects embedded profanity', () => {
      const { error } = createStoreSchema.validate({
        name: 'mykillershop',
        engine: 'medusa',
      });
      expect(error).toBeDefined();
    });

    it('allows clean store names', () => {
      const { error } = createStoreSchema.validate({
        name: 'awesome-shop',
        engine: 'medusa',
      });
      expect(error).toBeUndefined();
    });
  });
});
