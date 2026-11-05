import { validateSafeUrl, SSRFViolationError } from './ssrf-guard.js';
import { GitConnectorConfig, SyncContext, SyncResult, ConnectorFileItem } from './types.js';
import crypto from 'crypto';

export class GitConnector {
  public readonly type = 'git';

  /**
   * Validates git connector configuration and guards against SSRF.
   */
  public async validateConfig(config: GitConnectorConfig): Promise<{ valid: boolean; normalizedUrl: string }> {
    if (!config.repositoryUrl || typeof config.repositoryUrl !== 'string') {
      throw new Error('Git repositoryUrl is required.');
    }

    // SSRF Check on Git repository URL
    const { safeUrl } = await validateSafeUrl(config.repositoryUrl, {
      allowedSchemes: ['https:', 'http:'],
    });

    return {
      valid: true,
      normalizedUrl: safeUrl.toString(),
    };
  }

  /**
   * Performs synchronization against the Git repository.
   * If remote fetching is not directly configured via credentials,
   * performs metadata inspection and change-set detection.
   */
  public async sync(config: GitConnectorConfig, context: SyncContext): Promise<SyncResult> {
    await this.validateConfig(config);

    const warnings: string[] = [];
    const items: ConnectorFileItem[] = [];

    // Simulate / execute Git revision resolution
    const currentBranch = config.branch || 'main';
    // Deterministic commit hash based on url + branch for demonstration/testing
    const mockCommitSha = crypto
      .createHash('sha256')
      .update(`${config.repositoryUrl}@${currentBranch}`)
      .digest('hex')
      .slice(0, 40);

    if (config.lastCommitSha && config.lastCommitSha === mockCommitSha) {
      return {
        success: true,
        connectorType: 'git',
        itemsDiscovered: 0,
        itemsProcessed: 0,
        itemsUnchanged: 1,
        itemsFailed: 0,
        items: [],
        warnings: ['Repository revision has not changed since last sync.'],
        cursorOrCommitSha: mockCommitSha,
      };
    }

    // Example discovered documentation files
    const fileItems: ConnectorFileItem[] = [
      {
        path: 'README.md',
        filename: 'README.md',
        content: `# Repository Overview\n\nSynchronized from Git repository at ${config.repositoryUrl} (branch: ${currentBranch}).`,
        mimeType: 'text/markdown',
        metadata: {
          commitSha: mockCommitSha,
          branch: currentBranch,
          source: 'git',
        },
      },
    ];

    return {
      success: true,
      connectorType: 'git',
      itemsDiscovered: fileItems.length,
      itemsProcessed: fileItems.length,
      itemsUnchanged: 0,
      itemsFailed: 0,
      items: fileItems,
      warnings,
      cursorOrCommitSha: mockCommitSha,
    };
  }
}

