import {
  isValidProxyEntry,
  parseTrustedProxies,
  resolveThrottlerFailMode,
  validateEnvironment,
} from './environment';

const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/bizchat',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: 'x'.repeat(32),
  WIDGET_TOKEN_SECRET: 'y'.repeat(32),
  APP_URL: 'http://localhost:4000',
  DASHBOARD_URL: 'http://localhost:3000',
};

const production = {
  ...valid,
  NODE_ENV: 'production',
  APP_URL: 'https://api.bizchat.example',
  DASHBOARD_URL: 'https://app.bizchat.example',
  SESSION_SECRET: 's'.repeat(48),
  WIDGET_TOKEN_SECRET: 'w'.repeat(48),
  ATTACHMENT_STORAGE_DRIVER: 's3',
  S3_BUCKET: 'bizchat-attachments',
  S3_ACCESS_KEY_ID: 'access-key',
  S3_SECRET_ACCESS_KEY: 'secret-key',
  ATTACHMENT_SCANNER: 'clamav',
  SMTP_HOST: 'smtp.bizchat.example',
  SMTP_FROM: 'BizChat <no-reply@bizchat.example>',
};

describe('environment validation', () => {
  it('parses a secure configuration', () => {
    expect(validateEnvironment(valid).API_PORT).toBe(4000);
  });

  it('rejects a short session secret', () => {
    expect(() => validateEnvironment({ ...valid, SESSION_SECRET: 'short' })).toThrow(
      'Invalid environment',
    );
  });

  it('rejects public placeholder secrets in production', () => {
    expect(() =>
      validateEnvironment({
        ...production,
        SESSION_SECRET: 'replace-with-at-least-32-random-characters',
      }),
    ).toThrow('Invalid environment');
  });

  it('rejects reusing one secret for both token boundaries', () => {
    expect(() =>
      validateEnvironment({
        ...production,
        SESSION_SECRET: 's'.repeat(48),
        WIDGET_TOKEN_SECRET: 's'.repeat(48),
      }),
    ).toThrow('Invalid environment');
  });

  it('accepts independent secrets and HTTPS origins in production', () => {
    const result = validateEnvironment(production);
    expect(result.NODE_ENV).toBe('production');
  });

  it('requires HTTPS origins in production', () => {
    expect(() =>
      validateEnvironment({ ...production, APP_URL: 'http://api.bizchat.example' }),
    ).toThrow('Invalid environment');
  });

  it('requires development origins to be empty in production', () => {
    expect(() =>
      validateEnvironment({ ...production, ALLOWED_DEV_ORIGINS: 'http://localhost:3000' }),
    ).toThrow('Invalid environment');
  });

  it('requires object storage and scanning in production', () => {
    expect(() =>
      validateEnvironment({
        ...production,
        ATTACHMENT_STORAGE_DRIVER: 'filesystem',
        ATTACHMENT_SCANNER: 'disabled',
      }),
    ).toThrow('Invalid environment');
  });

  it('requires S3 credentials when the s3 driver is selected', () => {
    expect(() =>
      validateEnvironment({
        ...valid,
        ATTACHMENT_STORAGE_DRIVER: 's3',
        S3_BUCKET: undefined,
        S3_ACCESS_KEY_ID: undefined,
        S3_SECRET_ACCESS_KEY: undefined,
      }),
    ).toThrow('Invalid environment');
  });

  it('rejects a plaintext non-loopback S3 endpoint in production by default', () => {
    expect(() => validateEnvironment({ ...production, S3_ENDPOINT: 'http://minio:9000' })).toThrow(
      'Invalid environment',
    );
  });

  it('allows a plaintext internal S3 endpoint when S3_ALLOW_INSECURE is set', () => {
    const result = validateEnvironment({
      ...production,
      S3_ENDPOINT: 'http://minio:9000',
      S3_ALLOW_INSECURE: 'true',
    });
    expect(result.S3_ALLOW_INSECURE).toBe(true);
  });

  it('rejects an invalid trusted proxy value', () => {
    expect(() => validateEnvironment({ ...valid, TRUSTED_PROXIES: 'not-an-ip' })).toThrow(
      'Invalid environment',
    );
  });

  it('rejects a wildcard trusted proxy in every environment', () => {
    expect(() => validateEnvironment({ ...valid, TRUSTED_PROXIES: '*' })).toThrow(
      'Invalid environment',
    );
  });

  it('accepts IP and CIDR trusted proxies', () => {
    const result = validateEnvironment({
      ...valid,
      TRUSTED_PROXIES: '10.0.0.1, 172.16.0.0/12, 2001:db8::/32',
    });
    expect(parseTrustedProxies(result.TRUSTED_PROXIES)).toEqual([
      '10.0.0.1',
      '172.16.0.0/12',
      '2001:db8::/32',
    ]);
  });

  it('classifies proxy entries correctly', () => {
    expect(isValidProxyEntry('10.0.0.1')).toBe(true);
    expect(isValidProxyEntry('10.0.0.0/8')).toBe(true);
    expect(isValidProxyEntry('2001:db8::1')).toBe(true);
    expect(isValidProxyEntry('2001:db8::/129')).toBe(false);
    expect(isValidProxyEntry('10.0.0.0/33')).toBe(false);
    expect(isValidProxyEntry('example.com')).toBe(false);
    expect(isValidProxyEntry('*')).toBe(false);
  });

  it('requires SMTP in production', () => {
    expect(() => validateEnvironment({ ...production, SMTP_HOST: undefined })).toThrow(
      'Invalid environment',
    );
  });

  it('rejects fail-open throttling in production', () => {
    expect(() => validateEnvironment({ ...production, THROTTLER_FAIL_MODE: 'open' })).toThrow(
      'Invalid environment',
    );
  });

  it('defaults the throttler to fail closed in production and open elsewhere', () => {
    expect(resolveThrottlerFailMode({ NODE_ENV: 'production' })).toBe('closed');
    expect(resolveThrottlerFailMode({ NODE_ENV: 'development' })).toBe('open');
    expect(
      resolveThrottlerFailMode({ NODE_ENV: 'production', THROTTLER_FAIL_MODE: 'closed' }),
    ).toBe('closed');
  });
});
