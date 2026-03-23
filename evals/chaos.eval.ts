/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { evalTest } from './test-helper.js';

/**
 * This test is designed to trigger the retry logic by containing "Chaos" in its name.
 * It will fail with a simulated 500 INTERNAL error 3 times and then be marked as SKIP.
 */
evalTest('ALWAYS_PASSES', {
  name: 'Chaos Verification Test',
  prompt: 'Trigger the chaos simulation.',
  assert: async () => {},
});
