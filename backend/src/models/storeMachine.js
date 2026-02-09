'use strict';

const logger = require('../utils/logger').child('state-machine');

/**
 * Store Lifecycle State Machine
 * 
 * Defines all valid states, allowed transitions, and guards.
 * This is the single authority on "what transitions are legal."
 * 
 * State diagram:
 *
 *   requested ──▶ provisioning ──▶ ready ──▶ deleting ──▶ deleted
 *                       │                       │
 *                       └──▶ failed ◀───────────┘
 *                              │
 *                              └──▶ requested (retry)
 */

const STATES = {
  REQUESTED: 'requested',
  PROVISIONING: 'provisioning',
  READY: 'ready',
  FAILED: 'failed',
  DELETING: 'deleting',
  DELETED: 'deleted',
};

/**
 * Valid state transitions.
 * Key = current state, Value = array of allowed next states.
 */
const TRANSITIONS = {
  [STATES.REQUESTED]:     [STATES.PROVISIONING, STATES.FAILED],
  [STATES.PROVISIONING]:  [STATES.READY, STATES.FAILED],
  [STATES.READY]:         [STATES.DELETING],
  [STATES.FAILED]:        [STATES.REQUESTED, STATES.DELETING],  // retry or cleanup
  [STATES.DELETING]:      [STATES.DELETED, STATES.FAILED],
  [STATES.DELETED]:       [],  // terminal state
};

/**
 * Terminal states — stores in these states are "done."
 */
const TERMINAL_STATES = new Set([STATES.DELETED]);

/**
 * Active states — stores that consume resources.
 */
const ACTIVE_STATES = new Set([
  STATES.REQUESTED,
  STATES.PROVISIONING,
  STATES.READY,
  STATES.DELETING,
]);

/**
 * States that indicate work-in-progress (should be recovered on restart).
 */
const IN_PROGRESS_STATES = new Set([
  STATES.REQUESTED,
  STATES.PROVISIONING,
  STATES.DELETING,
]);

/**
 * Validate whether a state transition is allowed.
 * @param {string} from - Current state
 * @param {string} to - Desired next state
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateTransition(from, to) {
  if (!TRANSITIONS[from]) {
    return { valid: false, reason: `Unknown state: ${from}` };
  }

  if (!Object.values(STATES).includes(to)) {
    return { valid: false, reason: `Unknown target state: ${to}` };
  }

  if (!TRANSITIONS[from].includes(to)) {
    return {
      valid: false,
      reason: `Transition from '${from}' to '${to}' is not allowed. Valid transitions: [${TRANSITIONS[from].join(', ')}]`,
    };
  }

  return { valid: true };
}

/**
 * Assert a transition is valid — throws if not.
 * @param {string} from
 * @param {string} to
 * @throws {Error}
 */
function assertTransition(from, to) {
  const result = validateTransition(from, to);
  if (!result.valid) {
    const err = new Error(result.reason);
    err.code = 'INVALID_STATE_TRANSITION';
    err.statusCode = 409;
    logger.warn('Invalid state transition attempted', { from, to, reason: result.reason });
    throw err;
  }
}

/**
 * Check if a store is in a terminal state.
 * @param {string} status
 * @returns {boolean}
 */
function isTerminal(status) {
  return TERMINAL_STATES.has(status);
}

/**
 * Check if a store is actively consuming resources.
 * @param {string} status
 * @returns {boolean}
 */
function isActive(status) {
  return ACTIVE_STATES.has(status);
}

/**
 * Check if a store is in a work-in-progress state that needs recovery.
 * @param {string} status
 * @returns {boolean}
 */
function isInProgress(status) {
  return IN_PROGRESS_STATES.has(status);
}

/**
 * Check if a store can be deleted.
 * @param {string} status
 * @returns {{ allowed: boolean, reason?: string }}
 */
function canDelete(status) {
  if (status === STATES.DELETED) {
    return { allowed: false, reason: 'Store is already deleted' };
  }
  if (status === STATES.DELETING) {
    return { allowed: false, reason: 'Store is already being deleted' };
  }
  if (status === STATES.PROVISIONING) {
    return { allowed: false, reason: 'Store is currently provisioning. Wait for completion or failure before deleting.' };
  }
  // Allow delete from ready and failed
  if (status === STATES.READY || status === STATES.FAILED) {
    return { allowed: true };
  }
  return { allowed: false, reason: `Cannot delete store in '${status}' state` };
}

/**
 * Check if a store can be retried.
 * @param {string} status
 * @returns {{ allowed: boolean, reason?: string }}
 */
function canRetry(status) {
  if (status !== STATES.FAILED) {
    return { allowed: false, reason: `Only failed stores can be retried. Current status: '${status}'` };
  }
  return { allowed: true };
}

module.exports = {
  STATES,
  TRANSITIONS,
  validateTransition,
  assertTransition,
  isTerminal,
  isActive,
  isInProgress,
  canDelete,
  canRetry,
};
