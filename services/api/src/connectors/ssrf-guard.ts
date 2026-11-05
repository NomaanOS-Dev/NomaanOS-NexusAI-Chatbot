import dns from 'dns/promises';
import net from 'net';
import { URL } from 'url';

export class SSRFViolationError extends Error {
  public statusCode = 400;
  public errorCode = 'SSRF_VIOLATION';
  constructor(message: string) {
    super(message);
    this.name = 'SSRFViolationError';
  }
}

/**
 * Checks if an IPv4 or IPv6 address is in a reserved, private, loopback, or metadata range.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  if (!net.isIP(ip)) return true;

  // IPv4 checks
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    const [b0, b1, b2, b3] = parts;

    // 0.0.0.0/8 (Current network)
    if (b0 === 0) return true;

    // 127.0.0.0/8 (Loopback)
    if (b0 === 127) return true;

    // 10.0.0.0/8 (Private RFC1918)
    if (b0 === 10) return true;

    // 172.16.0.0/12 (Private RFC1918)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;

    // 192.168.0.0/16 (Private RFC1918)
    if (b0 === 192 && b1 === 168) return true;

    // 169.254.0.0/16 (Link-local & AWS/GCP/Azure Cloud Metadata 169.254.169.254)
    if (b0 === 169 && b1 === 254) return true;

    // 100.64.0.0/10 (Carrier-grade NAT RFC6598)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;

    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (b0 === 192 && b1 === 0 && b2 === 0) return true;

    // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (Documentation/Test-Net)
    if (b0 === 192 && b1 === 0 && b2 === 2) return true;
    if (b0 === 198 && b1 === 51 && b2 === 100) return true;
    if (b0 === 203 && b1 === 0 && b2 === 113) return true;

    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (b0 >= 224) return true;

    // Broadcast
    if (ip === '255.255.255.255') return true;

    return false;
  }

  // IPv6 checks
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  // Unique local addresses (fc00::/7)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  // Link-local addresses (fe80::/10)
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
  // IPv4-mapped IPv6 (::ffff:127.0.0.1 etc)
  if (normalized.startsWith('::ffff:')) {
    const v4 = normalized.replace('::ffff:', '');
    return isPrivateOrReservedIp(v4);
  }

  return false;
}

export interface UrlValidationOptions {
  allowedSchemes?: string[];
  allowedDomains?: string[];
  allowPrivateForTesting?: boolean;
}

/**
 * Validates a target URL against SSRF vulnerabilities, ensuring:
 * - Scheme is http or https (no file://, gopher://, etc.)
 * - Hostname resolves to a public, non-private IP
 * - Domain matches allowedDomains list if specified
 */
export async function validateSafeUrl(
  rawUrl: string,
  options: UrlValidationOptions = {}
): Promise<{ safeUrl: URL; resolvedIp: string }> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SSRFViolationError(`Invalid URL format: '${rawUrl}'.`);
  }

  const allowedSchemes = options.allowedSchemes || ['http:', 'https:'];
  if (!allowedSchemes.includes(parsed.protocol)) {
    throw new SSRFViolationError(
      `Unsupported URL scheme '${parsed.protocol}'. Only ${allowedSchemes.join(', ')} are permitted.`
    );
  }

  const hostname = parsed.hostname;
  if (!hostname) {
    throw new SSRFViolationError('URL must contain a valid hostname.');
  }

  // Check domain allowlist if configured
  if (options.allowedDomains && options.allowedDomains.length > 0) {
    const isDomainAllowed = options.allowedDomains.some((d) => {
      const cleanDomain = d.toLowerCase().trim();
      return (
        hostname.toLowerCase() === cleanDomain ||
        hostname.toLowerCase().endsWith('.' + cleanDomain)
      );
    });

    if (!isDomainAllowed) {
      throw new SSRFViolationError(
        `Hostname '${hostname}' is not in the allowed domains list: [${options.allowedDomains.join(', ')}].`
      );
    }
  }

  // If host is already an IP address
  if (net.isIP(hostname)) {
    if (!options.allowPrivateForTesting && isPrivateOrReservedIp(hostname)) {
      throw new SSRFViolationError(
        `Destination IP '${hostname}' belongs to a private, loopback, or cloud-metadata network range.`
      );
    }
    return { safeUrl: parsed, resolvedIp: hostname };
  }

  // Special-case localhost hostname
  if (hostname.toLowerCase() === 'localhost') {
    if (!options.allowPrivateForTesting) {
      throw new SSRFViolationError(`Host 'localhost' resolves to private loopback address and is forbidden.`);
    }
    return { safeUrl: parsed, resolvedIp: '127.0.0.1' };
  }

  // Resolve hostname via DNS
  try {
    const lookup = await dns.lookup(hostname);
    if (!options.allowPrivateForTesting && isPrivateOrReservedIp(lookup.address)) {
      throw new SSRFViolationError(
        `Host '${hostname}' resolved to prohibited private or metadata IP '${lookup.address}'.`
      );
    }
    return { safeUrl: parsed, resolvedIp: lookup.address };
  } catch (err: any) {
    if (err instanceof SSRFViolationError) throw err;
    throw new SSRFViolationError(`DNS resolution failed for hostname '${hostname}': ${err.message}`);
  }
}

