'use strict';

const { validateEnv } = require('../../src/utils/envValidator');

describe('Environment Validator', () => {
  const validEnv = {
    NODE_ENV: 'development',
    PORT: '3001',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    JWT_SECRET: 'a-secret-that-is-long-enough',
    LOG_LEVEL: 'info',
  };

  it('validates a correct environment', () => {
    const { validated, warnings } = validateEnv(validEnv);
    expect(validated.PORT).toBe(3001);
    expect(validated.NODE_ENV).toBe('development');
    expect(warnings).toEqual([]);
  });

  it('applies default values for missing optional vars', () => {
    const { validated } = validateEnv({});
    expect(validated.PORT).toBe(3001);
    expect(validated.NODE_ENV).toBe('development');
    expect(validated.HOST).toBe('0.0.0.0');
    expect(validated.LOG_LEVEL).toBe('debug');
    expect(validated.HELM_VALUES_FILE).toBe('values-local.yaml');
    expect(validated.MAX_STORES_PER_USER).toBe(5);
  });

  it('rejects invalid NODE_ENV', () => {
    expect(() => validateEnv({ NODE_ENV: 'invalid' })).toThrow('Environment validation failed');
  });

  it('rejects invalid PORT', () => {
    expect(() => validateEnv({ PORT: '99999' })).toThrow('Environment validation failed');
  });

  it('rejects invalid LOG_LEVEL', () => {
    expect(() => validateEnv({ LOG_LEVEL: 'superverbose' })).toThrow('Environment validation failed');
  });

  it('warns about default JWT_SECRET in production', () => {
    const { warnings } = validateEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'dev-jwt-secret-change-in-production',
    });
    expect(warnings.some(w => w.includes('JWT_SECRET'))).toBe(true);
  });

  it('warns about missing CORS_ORIGIN in production', () => {
    const { warnings } = validateEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'a-proper-production-secret-key-here',
    });
    expect(warnings.some(w => w.includes('CORS_ORIGIN'))).toBe(true);
  });

  it('allows unknown environment variables to pass through', () => {
    const { validated } = validateEnv({
      CUSTOM_VAR: 'hello',
      PATH: '/usr/bin',
    });
    expect(validated.CUSTOM_VAR).toBe('hello');
  });
});
