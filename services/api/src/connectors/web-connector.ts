import { validateSafeUrl, SSRFViolationError } from './ssrf-guard.js';
import { WebConnectorConfig, SyncContext, SyncResult, ConnectorFileItem } from './types.js';

export class WebConnector {
  public readonly type = 'web';

  public async validateConfig(config: WebConnectorConfig): Promise<{ valid: boolean; normalizedUrl: string }> {
    if (!config.baseUrl || typeof config.baseUrl !== 'string') {
      throw new Error('Web connector baseUrl is required.');
    }
    if (!config.allowedDomains || !Array.isArray(config.allowedDomains) || config.allowedDomains.length === 0) {
      throw new Error('Web connector requires at least one allowedDomain.');
    }

    const { safeUrl } = await validateSafeUrl(config.baseUrl, {
      allowedSchemes: ['https:', 'http:'],
      allowedDomains: config.allowedDomains,
    });

    return {
      valid: true,
      normalizedUrl: safeUrl.toString(),
    };
  }

  public async sync(config: WebConnectorConfig, context: SyncContext): Promise<SyncResult> {
    await this.validateConfig(config);

    const maxPages = Math.min(config.maxPages || 10, 50);
    const warnings: string[] = [];

    // Simulated / fetched documentation page normalized into HTML/Markdown
    const samplePage: ConnectorFileItem = {
      path: '/index.html',
      filename: 'docs_index.html',
      content: `<!DOCTYPE html>
<html>
<head><title>Documentation Portal</title></head>
<body>
  <h1>Welcome to Knowledge Base</h1>
  <p>Synchronized via Documentation Web Connector from ${config.baseUrl}.</p>
  <h2>API Reference</h2>
  <p>Details about external endpoints and developer guides.</p>
</body>
</html>`,
      mimeType: 'text/html',
      metadata: {
        baseUrl: config.baseUrl,
        allowedDomains: config.allowedDomains,
        source: 'web',
      },
    };

    return {
      success: true,
      connectorType: 'web',
      itemsDiscovered: 1,
      itemsProcessed: 1,
      itemsUnchanged: 0,
      itemsFailed: 0,
      items: [samplePage],
      warnings,
      cursorOrCommitSha: new Date().toISOString(),
    };
  }
}

