/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { evalTest } from './test-helper.js';
import { TestRig } from '@google/gemini-cli-test-utils';

// Mock Vitest's 'it' to capture the function passed to it
vi.mock('vitest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vitest')>();
  return {
    ...actual,
    it: vi.fn(),
  };
});

// Mock TestRig to control API success/failure
vi.mock('@google/gemini-cli-test-utils', () => {
  return {
    TestRig: vi.fn().mockImplementation(() => ({
      setup: vi.fn(),
      run: vi.fn(),
      cleanup: vi.fn(),
      readToolLogs: vi.fn().mockReturnValue([]),
      _lastRunStderr: '',
    })),
  };
});

describe('evalTest reliability logic', () => {
  const LOG_DIR = path.resolve(process.cwd(), 'evals/logs');
  const RELIABILITY_LOG = path.join(LOG_DIR, 'api-reliability.jsonl');

  beforeEach(() => {
    vi.clearAllMocks();
    if (fs.existsSync(RELIABILITY_LOG)) {
      fs.unlinkSync(RELIABILITY_LOG);
    }
  });

  afterEach(() => {
    if (fs.existsSync(RELIABILITY_LOG)) {
      fs.unlinkSync(RELIABILITY_LOG);
    }
  });

  it('should retry 3 times on 500 INTERNAL error and then SKIP', async () => {
    const mockRig = new TestRig() as any;
    (TestRig as any).mockReturnValue(mockRig);

    // Simulate permanent 500 error
    mockRig.run.mockRejectedValue(new Error('status: INTERNAL - API Down'));

    // Trigger evalTest
    evalTest('ALWAYS_PASSES', {
      name: 'test-api-failure',
      prompt: 'do something',
      assert: async () => {},
    });

    // Extract the internal function passed to vitest's 'it'
    const testFn = (it as any).mock.calls[0][1];

    // Execute the test function
    await testFn();

    // Verify retries: 1 initial + 3 retries = 4 setups/runs
    expect(mockRig.run).toHaveBeenCalledTimes(4);

    // Verify log content
    const logContent = fs
      .readFileSync(RELIABILITY_LOG, 'utf-8')
      .trim()
      .split('\n');
    expect(logContent.length).toBe(4);

    const entries = logContent.map((line) => JSON.parse(line));
    expect(entries[0].status).toBe('RETRY');
    expect(entries[0].attempt).toBe(0);
    expect(entries[3].status).toBe('SKIP');
    expect(entries[3].attempt).toBe(3);
    expect(entries[3].testName).toBe('test-api-failure');
  });

  it('should fail immediately on non-500 errors (like assertion failures)', async () => {
    const mockRig = new TestRig() as any;
    (TestRig as any).mockReturnValue(mockRig);

    // Simulate a real logic error/bug
    mockRig.run.mockResolvedValue('Success');
    const assertError = new Error('Assertion failed: expected foo to be bar');

    evalTest('ALWAYS_PASSES', {
      name: 'test-logic-failure',
      prompt: 'do something',
      assert: async () => {
        throw assertError;
      },
    });

    const testFn = (it as any).mock.calls[0][1];

    // Expect the test function to throw immediately
    await expect(testFn()).rejects.toThrow('Assertion failed');

    // Verify NO retries: only 1 attempt
    expect(mockRig.run).toHaveBeenCalledTimes(1);

    // Verify NO reliability log was created (it's not an API error)
    expect(fs.existsSync(RELIABILITY_LOG)).toBe(false);
  });

  it('should recover if a retry succeeds', async () => {
    const mockRig = new TestRig() as any;
    (TestRig as any).mockReturnValue(mockRig);

    // Fail once, then succeed
    mockRig.run
      .mockRejectedValueOnce(new Error('status: INTERNAL'))
      .mockResolvedValueOnce('Success');

    evalTest('ALWAYS_PASSES', {
      name: 'test-recovery',
      prompt: 'do something',
      assert: async () => {},
    });

    const testFn = (it as any).mock.calls[0][1];
    await testFn();

    // Ran twice: initial (fail) + retry 1 (success)
    expect(mockRig.run).toHaveBeenCalledTimes(2);

    // Log should only have the one RETRY entry
    const logContent = fs
      .readFileSync(RELIABILITY_LOG, 'utf-8')
      .trim()
      .split('\n');
    expect(logContent.length).toBe(1);
    expect(JSON.parse(logContent[0]).status).toBe('RETRY');
  });
});
