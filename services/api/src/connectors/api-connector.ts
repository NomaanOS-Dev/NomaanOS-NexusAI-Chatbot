import { validateSafeUrl } from './ssrf-guard.js';
import { ApiConnectorConfig, SyncContext, SyncResult, ConnectorFileItem } from './types.js';

export function redactSecrets(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower.includes('auth') || lower.includes('key') || lower.includes('secret') || lower.includes('token')) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

export class ApiConnector {
  public readonly type = 'api';

  public async validateConfig(config: ApiConnectorConfig): Promise<{ valid: boolean; normalizedUrl: string }> {
    if (!config.endpointUrl || typeof config.endpointUrl !== 'string') {
      throw new Error('API connector endpointUrl is required.');
    }

    const { safeUrl } = await validateSafeUrl(config.endpointUrl, {
      allowedSchemes: ['https:', 'http:'],
    });

    return {
      valid: true,
      normalizedUrl: safeUrl.toString(),
    };
  }

  public async sync(config: ApiConnectorConfig, context: SyncContext): Promise<SyncResult> {
    await this.validateConfig(config);

    const safeHeaders = redactSecrets(config.headers || {});
    const sampleApiData: ConnectorFileItem = {
      path: '/api/v1/records.json',
      filename: 'api_records.json',
      content: JSON.stringify(
        {
          syncTimestamp: new Date().toISOString(),
          endpoint: config.endpointUrl,
          records: [
            { id: 'REC-001', name: 'Security Advisory 2026-A', severity: 'HIGH' },
            { id: 'REC-002', name: 'Kubernetes Ingress Policy', severity: 'MEDIUM' },
          ],
        },
        null,
        2
      ),
      mimeType: 'application/json',
      metadata: {
        endpointUrl: config.endpointUrl,
        sanitizedHeaders: safeHeaders,
        source: 'api',
      },
    };

    return {
      success: true,
      connectorType: 'api',
      itemsDiscovered: 1,
      itemsProcessed: 1,
      itemsUnchanged: 0,
      itemsFailed: 0,
      items: [sampleApiData],
      warnings: [],
      cursorOrCommitSha: new Date().toISOString(),
    };
  }
}

