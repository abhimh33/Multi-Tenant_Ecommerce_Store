'use strict';

/**
 * Unit tests for storeSetupService — Medusa setup functions.
 * Tests use mocked child_process to avoid actual kubectl calls.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');

// Mock child_process.execFile
jest.mock('child_process', () => ({
    execFile: jest.fn(),
}));

// Mock the promisify to return our mocked execFile as an async function
jest.mock('util', () => ({
    promisify: jest.fn((fn) => {
        return (...args) => {
            return new Promise((resolve, reject) => {
                fn(...args, (err, stdout, stderr) => {
                    if (err) {
                        err.stdout = stdout;
                        err.stderr = stderr;
                        reject(err);
                    } else {
                        resolve({ stdout, stderr });
                    }
                });
            });
        };
    }),
}));

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
            execFile.mockImplementation((cmd, args, opts, callback) => {
                callback(null, 'my-store-medusa-6f7d8c9b5-x2r4k', '');
            });

            const podName = await findMedusaPod('store-abc12345');
            expect(podName).toBe('my-store-medusa-6f7d8c9b5-x2r4k');
            expect(execFile).toHaveBeenCalledWith(
                expect.any(String),
                expect.arrayContaining(['get', 'pods', '-n', 'store-abc12345', '-l', 'app.kubernetes.io/name=medusa']),
                expect.any(Object),
                expect.any(Function)
            );
        });

        it('throws when no pod is found', async () => {
            execFile.mockImplementation((cmd, args, opts, callback) => {
                callback(null, '', '');
            });

            await expect(findMedusaPod('store-abc12345')).rejects.toThrow('No Medusa pod found');
        });

        it('throws when kubectl returns empty JSON', async () => {
            execFile.mockImplementation((cmd, args, opts, callback) => {
                callback(null, '{}', '');
            });

            await expect(findMedusaPod('store-abc12345')).rejects.toThrow('No Medusa pod found');
        });

        it('throws when kubectl times out', async () => {
            execFile.mockImplementation((cmd, args, opts, callback) => {
                const err = new Error('Command timed out');
                callback(err, '', '');
            });

            await expect(findMedusaPod('store-abc12345')).rejects.toThrow('Failed to find Medusa pod');
        });
    });

    describe('kubectlExecMedusa', () => {
        it('runs a command in the medusa container', async () => {
            execFile.mockImplementation((cmd, args, opts, callback) => {
                callback(null, '{"status":"ok"}', '');
            });

            const result = await kubectlExecMedusa({
                namespace: 'store-abc12345',
                podName: 'medusa-pod-xyz',
                command: 'wget -qO- http://localhost:9000/health',
            });

            expect(result.stdout).toBe('{"status":"ok"}');
            expect(execFile).toHaveBeenCalledWith(
                expect.any(String),
                expect.arrayContaining([
                    'exec', 'medusa-pod-xyz',
                    '-n', 'store-abc12345',
                    '-c', 'medusa',
                ]),
                expect.any(Object),
                expect.any(Function)
            );
        });

        it('handles Defaulted container warnings gracefully', async () => {
            execFile.mockImplementation((cmd, args, opts, callback) => {
                const err = new Error('exec failed');
                err.code = 0;
                err.stdout = 'ok';
                err.stderr = 'Defaulted container "medusa" out of: medusa, wait-for-db';
                callback(err, undefined, undefined);
            });

            const result = await kubectlExecMedusa({
                namespace: 'store-abc12345',
                podName: 'medusa-pod-xyz',
                command: 'echo ok',
            });

            expect(result.stdout).toBe('ok');
        });

        it('throws on real exec errors', async () => {
            execFile.mockImplementation((cmd, args, opts, callback) => {
                const err = new Error('exec failed');
                err.code = 1;
                err.stderr = 'container not found';
                callback(err, '', 'container not found');
            });

            await expect(kubectlExecMedusa({
                namespace: 'store-abc12345',
                podName: 'medusa-pod-xyz',
                command: 'bad-command',
            })).rejects.toThrow('kubectl exec failed');
        });
    });
});
