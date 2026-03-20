/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { MessageType, type HistoryItemCompression } from '../types.js';
import { CommandKind, type SlashCommand } from './types.js';
import { tokenLimit } from '@google/gemini-cli-core';

export const compressCommand: SlashCommand = {
  name: 'compress',
  altNames: ['summarize', 'compact'],
  description: 'Compresses the context by replacing it with a summary',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context) => {
    const { ui, services } = context;
    const config = services.config;
    if (ui.pendingItem) {
      ui.addItem(
        {
          type: MessageType.ERROR,
          text: 'Already compressing, wait for previous request to complete',
        },
        Date.now(),
      );
      return;
    }

    const pendingMessage: HistoryItemCompression = {
      type: MessageType.COMPRESSION,
      compression: {
        isPending: true,
        beforePercentage: null,
        afterPercentage: null,
        compressionStatus: null,
        isManual: true,
      },
    };

    try {
      ui.setPendingItem(pendingMessage);
      const promptId = `compress-${Date.now()}`;
      const compressed = await config
        ?.getGeminiClient()
        ?.tryCompressChat(promptId, true);
      if (compressed) {
        const limit = tokenLimit(config.getModel());
        const beforePercentage = Math.round(
          (compressed.originalTokenCount / limit) * 100,
        );
        const afterPercentage = Math.round(
          (compressed.newTokenCount / limit) * 100,
        );

        ui.addItem(
          {
            type: MessageType.COMPRESSION,
            compression: {
              isPending: false,
              beforePercentage,
              afterPercentage,
              compressionStatus: compressed.compressionStatus,
              isManual: true,
            },
          } as HistoryItemCompression,
          Date.now(),
        );
      } else {
        ui.addItem(
          {
            type: MessageType.ERROR,
            text: 'Failed to compress chat history.',
          },
          Date.now(),
        );
      }
    } catch (e) {
      ui.addItem(
        {
          type: MessageType.ERROR,
          text: `Failed to compress chat history: ${
            e instanceof Error ? e.message : String(e)
          }`,
        },
        Date.now(),
      );
    } finally {
      ui.setPendingItem(null);
    }
  },
};
