import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import { BadRequestException } from '@nestjs/common';

const DOMAIN_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export function normalizeDomain(input: string, allowLocalhost = false): string {
  const trimmed = input.trim();
  const candidate = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw invalidDomain();
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    (parsed.pathname !== '' && parsed.pathname !== '/') ||
    parsed.search ||
    parsed.hash
  )
    throw invalidDomain();

  const hostname = domainToASCII(parsed.hostname.toLowerCase().replace(/\.$/, ''));
  if (allowLocalhost && hostname === 'localhost') return hostname;
  if (!hostname || hostname.length > 253 || isIP(hostname) !== 0 || hostname.includes('*'))
    throw invalidDomain();
  const labels = hostname.split('.');
  if (labels.length < 2 || labels.some((label) => !DOMAIN_LABEL.test(label))) throw invalidDomain();
  return hostname;
}

export function normalizeWidgetOrigin(
  value: string,
  allowDevelopmentOrigin = false,
): { origin: string; domain: string } {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BadRequestException({
      code: 'ORIGIN_REQUIRED',
      message: 'A valid widget origin is required',
    });
  }
  const localDevelopment = allowDevelopmentOrigin && isLocalhost(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(localDevelopment && parsed.protocol === 'http:')) {
    throw new BadRequestException({
      code: 'INSECURE_ORIGIN',
      message: 'Widget origins must use HTTPS',
    });
  }
  if (!localDevelopment && parsed.port) {
    throw new BadRequestException({
      code: 'INVALID_ORIGIN_PORT',
      message: 'Widget origins cannot use a custom port',
    });
  }
  return { origin: parsed.origin, domain: normalizeDomain(parsed.hostname, localDevelopment) };
}

export function isLocalhost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return normalized === 'localhost' || normalized.endsWith('.localhost');
}

function invalidDomain(): BadRequestException {
  return new BadRequestException({
    code: 'INVALID_DOMAIN',
    message: 'Enter a hostname such as example.com without a path or port',
  });
}
