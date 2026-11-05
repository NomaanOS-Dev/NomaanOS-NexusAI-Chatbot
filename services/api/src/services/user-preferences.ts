/**
 * NomaanOS Nexus AI - User Preferences Service (Day 15)
 *
 * Manages optional, user-controlled persistent settings (response language, response style,
 * code theme, custom contextual hints). Enforces user and workspace tenancy isolation.
 */

import { pool } from '../database/pool.js';
import { logger } from '../config/logger.js';
import { config } from '../config/env.js';

export type ResponseStyle = 'concise' | 'detailed' | 'standard' | 'bullet_points' | 'executive';

export interface UserPreferencesRecord {
  id: string;
  userId: string;
  workspaceId: string | null;
  language: string;
  responseStyle: ResponseStyle;
  codeTheme: string | null;
  customInstructions: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SetPreferencesInput {
  language?: string;
  responseStyle?: ResponseStyle;
  codeTheme?: string | null;
  customInstructions?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Retrieves stored user preferences for a given user and optional workspace scope.
 * Returns default preferences if none are explicitly configured.
 */
export async function getUserPreferences(
  userId: string,
  workspaceId?: string | null,
  customPool = pool
): Promise<UserPreferencesRecord> {
  const defaultPrefs: UserPreferencesRecord = {
    id: 'default',
    userId,
    workspaceId: workspaceId || null,
    language: config.multilingual.defaultLanguage,
    responseStyle: 'standard',
    codeTheme: 'dark',
    customInstructions: null,
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (!userId) return defaultPrefs;

  try {
    const query = `
      SELECT id, user_id, workspace_id, language, response_style, code_theme, custom_instructions, metadata, created_at, updated_at
      FROM user_preferences
      WHERE user_id = $1::uuid
        AND (workspace_id = $2::uuid OR ($2 IS NULL AND workspace_id IS NULL))
      LIMIT 1;
    `;

    const res = await customPool.query(query, [userId, workspaceId || null]);
    if (res.rows.length === 0) {
      // Check fallback user-level preference without workspace
      if (workspaceId) {
        const fallbackRes = await customPool.query(
          `SELECT id, user_id, workspace_id, language, response_style, code_theme, custom_instructions, metadata, created_at, updated_at
           FROM user_preferences
           WHERE user_id = $1::uuid AND workspace_id IS NULL
           LIMIT 1;`,
          [userId]
        );
        if (fallbackRes.rows.length > 0) {
          const row = fallbackRes.rows[0];
          return {
            id: row.id,
            userId: row.user_id,
            workspaceId: null,
            language: row.language,
            responseStyle: row.response_style,
            codeTheme: row.code_theme,
            customInstructions: row.custom_instructions,
            metadata: row.metadata || {},
            createdAt: row.created_at.toISOString(),
            updatedAt: row.updated_at.toISOString(),
          };
        }
      }
      return defaultPrefs;
    }

    const row = res.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      workspaceId: row.workspace_id,
      language: row.language,
      responseStyle: row.response_style,
      codeTheme: row.code_theme,
      customInstructions: row.custom_instructions,
      metadata: row.metadata || {},
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  } catch (err) {
    logger.warn({ err, userId }, 'Failed to query user preferences, returning defaults');
    return defaultPrefs;
  }
}

/**
 * Creates or updates user preferences with anti-injection sanitization.
 */
export async function setUserPreferences(
  userId: string,
  input: SetPreferencesInput,
  workspaceId?: string | null,
  customPool = pool
): Promise<UserPreferencesRecord> {
  if (!userId) throw new Error('userId is required to set preferences');

  // Sanitize custom instructions to prevent prompt injection via preferences
  let sanitizedInstructions = input.customInstructions;
  if (sanitizedInstructions) {
    sanitizedInstructions = sanitizedInstructions
      .replace(/(?:ignore\s+all\s+previous\s+instructions|system\s+override)/gi, '[REDACTED_PROMPT_INJECTION]')
      .slice(0, 1000);
  }

  const query = `
    INSERT INTO user_preferences (
      user_id, workspace_id, language, response_style, code_theme, custom_instructions, metadata, updated_at
    ) VALUES (
      $1::uuid, $2, $3, $4, $5, $6, $7, NOW()
    )
    ON CONFLICT (user_id, COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO UPDATE SET
      language = COALESCE(EXCLUDED.language, user_preferences.language),
      response_style = COALESCE(EXCLUDED.response_style, user_preferences.response_style),
      code_theme = COALESCE(EXCLUDED.code_theme, user_preferences.code_theme),
      custom_instructions = EXCLUDED.custom_instructions,
      metadata = COALESCE(EXCLUDED.metadata, user_preferences.metadata),
      updated_at = NOW()
    RETURNING id, user_id, workspace_id, language, response_style, code_theme, custom_instructions, metadata, created_at, updated_at;
  `;

  const res = await customPool.query(query, [
    userId,
    workspaceId || null,
    input.language || config.multilingual.defaultLanguage,
    input.responseStyle || 'standard',
    input.codeTheme || 'dark',
    sanitizedInstructions || null,
    JSON.stringify(input.metadata || {}),
  ]);

  const row = res.rows[0];
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    language: row.language,
    responseStyle: row.response_style,
    codeTheme: row.code_theme,
    customInstructions: row.custom_instructions,
    metadata: row.metadata || {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Deletes user preferences for a user (and optional workspace).
 */
export async function deleteUserPreferences(
  userId: string,
  workspaceId?: string | null,
  customPool = pool
): Promise<boolean> {
  if (!userId) return false;

  const query = `
    DELETE FROM user_preferences
    WHERE user_id = $1::uuid
      AND (workspace_id = $2::uuid OR ($2 IS NULL AND workspace_id IS NULL));
  `;

  const res = await customPool.query(query, [userId, workspaceId || null]);
  return (res.rowCount || 0) > 0;
}
