'use strict';

const { STATES, assertTransition, canDelete, canRetry, isTerminal, isActive } = require('../../src/models/storeMachine');

describe('Store State Machine', () => {
  describe('STATES', () => {
    it('has all expected states', () => {
      expect(STATES.REQUESTED).toBe('requested');
      expect(STATES.PROVISIONING).toBe('provisioning');
      expect(STATES.READY).toBe('ready');
      expect(STATES.FAILED).toBe('failed');
      expect(STATES.DELETING).toBe('deleting');
      expect(STATES.DELETED).toBe('deleted');
    });
  });

  describe('assertTransition', () => {
    it('allows valid transitions', () => {
      expect(() => assertTransition('requested', 'provisioning')).not.toThrow();
      expect(() => assertTransition('provisioning', 'ready')).not.toThrow();
      expect(() => assertTransition('provisioning', 'failed')).not.toThrow();
      expect(() => assertTransition('ready', 'deleting')).not.toThrow();
      expect(() => assertTransition('failed', 'requested')).not.toThrow();
      expect(() => assertTransition('failed', 'deleting')).not.toThrow();
      expect(() => assertTransition('deleting', 'deleted')).not.toThrow();
      expect(() => assertTransition('deleting', 'failed')).not.toThrow();
    });

    it('rejects invalid transitions', () => {
      expect(() => assertTransition('requested', 'ready')).toThrow();
      expect(() => assertTransition('ready', 'provisioning')).toThrow();
      expect(() => assertTransition('deleted', 'requested')).toThrow();
      expect(() => assertTransition('deleted', 'ready')).toThrow();
    });
  });

  describe('canDelete', () => {
    it('allows deletion from ready and failed states', () => {
      expect(canDelete('ready').allowed).toBe(true);
      expect(canDelete('failed').allowed).toBe(true);
    });

    it('disallows deletion from provisioning and deleting states', () => {
      expect(canDelete('provisioning').allowed).toBe(false);
      expect(canDelete('deleting').allowed).toBe(false);
    });

    it('provides a reason when disallowed', () => {
      const result = canDelete('provisioning');
      expect(result.reason).toBeDefined();
      expect(typeof result.reason).toBe('string');
    });
  });

  describe('canRetry', () => {
    it('allows retry from failed state', () => {
      expect(canRetry('failed').allowed).toBe(true);
    });

    it('disallows retry from non-failed states', () => {
      expect(canRetry('ready').allowed).toBe(false);
      expect(canRetry('provisioning').allowed).toBe(false);
      expect(canRetry('requested').allowed).toBe(false);
    });
  });

  describe('isTerminal', () => {
    it('returns true for deleted state', () => {
      expect(isTerminal('deleted')).toBe(true);
    });

    it('returns false for non-terminal states', () => {
      expect(isTerminal('ready')).toBe(false);
      expect(isTerminal('failed')).toBe(false);
      expect(isTerminal('provisioning')).toBe(false);
    });
  });

  describe('isActive', () => {
    it('returns true for active states', () => {
      expect(isActive('requested')).toBe(true);
      expect(isActive('provisioning')).toBe(true);
      expect(isActive('ready')).toBe(true);
    });

    it('returns false for inactive states', () => {
      expect(isActive('deleted')).toBe(false);
      expect(isActive('failed')).toBe(false);
    });
  });
});
