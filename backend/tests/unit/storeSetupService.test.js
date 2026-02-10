'use strict';

/**
 * Unit tests for storeSetupService — Medusa setup functions.
 * Tests use mocked child_process to avoid actual kubectl calls.
 *
 * Key design: We attach util.promisify.custom to the mocked execFile so that
 * promisify(execFile) returns our mock async function with {stdout, stderr}.
 */

const util = require('util');

// Create the async mock that promisify(execFile) will resolve to
const mockExecFileAsync = jest.fn();

jest.mock('child_process', () => {
    const execFile = jest.fn();
    // Attach the custom promisify symbol so that util.promisify(execFile)
    // returns our mockExecFileAsync instead of the default callback wrapper
    execFile[require('util').promisify.custom] = mockExecFileAsync;
    return { execFile };
});

// Mock the logger to prevent winston initialization issues
jest.mock('../../src/utils/logger', () => {
    const noop = () => { };
    const childLogger = { info: noop, warn: noop, error: noop, debug: noop };
    return { child: () => childLogger, info: noop, warn: noop, error: noop, debug: noop };
});

// Now require the module after mocking
const {
    findMedusaPod,
    kubectlExecMedusa,
} = require('../../src/services/storeSetupService');

describe('Store Setup Service - Medusa', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('findMedusaPod', () => {
        it('returns the pod name when found', async () => {
            mockExecFileAsync.mockResolvedValue({
                stdout: 'my-store-medusa-6f7d8c9b5-x2r4k\n',
                stderr: '',
            });

            const podName = await findMedusaPod('store-abc12345');
            expect(podName).toBe('my-store-medusa-6f7d8c9b5-x2r4k');
            expect(mockExecFileAsync).toHaveBeenCalledWith(
                expect.any(String),
                expect.arrayContaining([
                    'get', 'pods', '-n', 'store-abc12345',
                    '-l', 'app.kubernetes.io/name=medusa',
                ]),
                expect.any(Object)
            );
        });

        it('throws when no pod is found', async () => {
            mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

            await expect(findMedusaPod('store-abc12345'))
                .rejects.toThrow('No Medusa pod found');
        });

        it('throws when kubectl returns empty JSON', async () => {
            mockExecFileAsync.mockResolvedValue({ stdout: '{}', stderr: '' });

            await expect(findMedusaPod('store-abc12345'))
                .rejects.toThrow('No Medusa pod found');
        });

        it('throws when kubectl times out', async () => {
            mockExecFileAsync.mockRejectedValue(new Error('Command timed out'));

            await expect(findMedusaPod('store-abc12345'))
                .rejects.toThrow('Failed to find Medusa pod');
        });
    });

    describe('kubectlExecMedusa', () => {
        it('runs a command in the medusa container', async () => {
            mockExecFileAsync.mockResolvedValue({
                stdout: '{"status":"ok"}',
                stderr: '',
            });

            const result = await kubectlExecMedusa({
                namespace: 'store-abc12345',
                podName: 'medusa-pod-xyz',
                command: 'wget -qO- http://localhost:9000/health',
            });

            expect(result.stdout).toBe('{"status":"ok"}');
            expect(mockExecFileAsync).toHaveBeenCalledWith(
                expect.any(String),
                expect.arrayContaining([
                    'exec', 'medusa-pod-xyz',
                    '-n', 'store-abc12345',
                    '-c', 'medusa',
                ]),
                expect.any(Object)
            );
        });

        it('handles Defaulted container warnings gracefully', async () => {
            const err = new Error('exec failed');
            err.code = 0;
            err.stdout = 'ok';
            err.stderr = 'Defaulted container "medusa" out of: medusa, wait-for-db';
            mockExecFileAsync.mockRejectedValue(err);

            const result = await kubectlExecMedusa({
                namespace: 'store-abc12345',
                podName: 'medusa-pod-xyz',
                command: 'echo ok',
            });

            expect(result.stdout).toBe('ok');
        });

        it('throws on real exec errors', async () => {
            const err = new Error('exec failed');
            err.code = 1;
            err.stderr = 'container not found';
            mockExecFileAsync.mockRejectedValue(err);

            await expect(kubectlExecMedusa({
                namespace: 'store-abc12345',
                podName: 'medusa-pod-xyz',
                command: 'bad-command',
            })).rejects.toThrow('kubectl exec failed');
        });
    });
});
