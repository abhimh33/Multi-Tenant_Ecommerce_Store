'use strict';

const {
  AppError,
  NotFoundError,
  ConflictError,
  ValidationError,
  StoreLimitError,
  InvalidStateTransitionError,
  ProvisioningError,
  HelmError,
  KubernetesError,
} = require('../../src/utils/errors');

describe('Error Classes', () => {
  // ─── AppError ──────────────────────────────────────────────────────────
  describe('AppError', () => {
    it('creates with default options', () => {
      const err = new AppError('Something went wrong');
      expect(err.message).toBe('Something went wrong');
      expect(err.statusCode).toBe(500);
      expect(err.code).toBe('INTERNAL_ERROR');
      expect(err.retryable).toBe(false);
      expect(err.suggestion).toBeUndefined();
      expect(err instanceof Error).toBe(true);
      expect(err instanceof AppError).toBe(true);
    });

    it('creates with custom options', () => {
      const err = new AppError('Custom error', {
        statusCode: 418,
        code: 'TEAPOT',
        suggestion: 'Try a coffee maker instead.',
        retryable: true,
        metadata: { brew: 'earl grey' },
      });
      expect(err.statusCode).toBe(418);
      expect(err.code).toBe('TEAPOT');
      expect(err.suggestion).toBe('Try a coffee maker instead.');
      expect(err.retryable).toBe(true);
      expect(err.metadata).toEqual({ brew: 'earl grey' });
    });

    it('serializes to JSON correctly', () => {
      const err = new AppError('test', {
        code: 'TEST',
        suggestion: 'Fix it',
        retryable: true,
        metadata: { key: 'value' },
      });
      const json = err.toJSON();
      expect(json.code).toBe('TEST');
      expect(json.message).toBe('test');
      expect(json.suggestion).toBe('Fix it');
      expect(json.retryable).toBe(true);
      expect(json.metadata).toEqual({ key: 'value' });
    });

    it('omits metadata from JSON when absent', () => {
      const err = new AppError('test');
      const json = err.toJSON();
      expect(json.metadata).toBeUndefined();
    });
  });

  // ─── NotFoundError ─────────────────────────────────────────────────────
  describe('NotFoundError', () => {
    it('creates with correct status and code', () => {
      const err = new NotFoundError('Store', 'store-abc123');
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe('STORE_NOT_FOUND');
      expect(err.message).toBe("Store 'store-abc123' not found");
      expect(err.suggestion).toContain('Verify the store ID');
    });
  });

  // ─── ConflictError ─────────────────────────────────────────────────────
  describe('ConflictError', () => {
    it('creates with 409 status', () => {
      const err = new ConflictError('Already exists', 'Delete first');
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('CONFLICT');
      expect(err.suggestion).toBe('Delete first');
    });
  });

  // ─── ValidationError ──────────────────────────────────────────────────
  describe('ValidationError', () => {
    it('creates with 400 status and details', () => {
      const details = [{ field: 'name', message: 'required' }];
      const err = new ValidationError('Invalid input', details);
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.metadata).toEqual(details);
    });
  });

  // ─── StoreLimitError ──────────────────────────────────────────────────
  describe('StoreLimitError', () => {
    it('creates with correct limit message', () => {
      const err = new StoreLimitError(5);
      expect(err.statusCode).toBe(429);
      expect(err.code).toBe('STORE_LIMIT_EXCEEDED');
      expect(err.message).toContain('5');
      expect(err.suggestion).toContain('Delete');
    });
  });

  // ─── InvalidStateTransitionError ──────────────────────────────────────
  describe('InvalidStateTransitionError', () => {
    it('creates with from/to states', () => {
      const err = new InvalidStateTransitionError('ready', 'provisioning');
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('INVALID_STATE_TRANSITION');
      expect(err.message).toContain('ready');
      expect(err.message).toContain('provisioning');
    });

    it('uses custom suggestion when provided', () => {
      const err = new InvalidStateTransitionError('x', 'y', 'Custom tip');
      expect(err.suggestion).toBe('Custom tip');
    });
  });

  // ─── ProvisioningError ────────────────────────────────────────────────
  describe('ProvisioningError', () => {
    it('defaults to retryable', () => {
      const err = new ProvisioningError('Timeout');
      expect(err.statusCode).toBe(500);
      expect(err.code).toBe('PROVISIONING_ERROR');
      expect(err.retryable).toBe(true);
    });

    it('respects retryable option', () => {
      const err = new ProvisioningError('Fatal', { retryable: false });
      expect(err.retryable).toBe(false);
    });
  });

  // ─── HelmError ────────────────────────────────────────────────────────
  describe('HelmError', () => {
    it('creates with Helm-specific message', () => {
      const err = new HelmError('Chart not found');
      expect(err.code).toBe('HELM_ERROR');
      expect(err.suggestion).toContain('Helm');
    });
  });

  // ─── KubernetesError ──────────────────────────────────────────────────
  describe('KubernetesError', () => {
    it('creates with K8s-specific message', () => {
      const err = new KubernetesError('Connection refused');
      expect(err.code).toBe('KUBERNETES_ERROR');
      expect(err.suggestion).toContain('Kubernetes');
    });
  });
});
