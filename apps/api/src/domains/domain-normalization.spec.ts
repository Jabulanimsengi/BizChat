import { BadRequestException } from '@nestjs/common';
import { normalizeDomain, normalizeWidgetOrigin } from './domain-normalization';

describe('domain normalization', () => {
  it('normalizes case and internationalized hostnames without collapsing www', () => {
    expect(normalizeDomain('HTTPS://WWW.Example.com/')).toBe('www.example.com');
    expect(normalizeDomain('münich.example')).toBe('xn--mnich-kva.example');
  });

  it.each(['https://example.com/path', '*.example.com', '127.0.0.1', 'example.com:8080'])(
    'rejects unsafe domain input %s',
    (input) => expect(() => normalizeDomain(input)).toThrow(BadRequestException),
  );

  it('allows HTTP localhost with a custom port only in development', () => {
    expect(normalizeWidgetOrigin('http://localhost:4173', true)).toEqual({
      origin: 'http://localhost:4173',
      domain: 'localhost',
    });
    expect(() => normalizeWidgetOrigin('http://localhost:4173', false)).toThrow(
      'Widget origins must use HTTPS',
    );
    expect(normalizeWidgetOrigin('http://preview.localhost:4173', true).domain).toBe(
      'preview.localhost',
    );
  });
});
