import type { Request } from 'express';
import { methodLabel, routeLabel } from './request-logging.middleware';

describe('request logging labels', () => {
  it('uses the matched route template when available', () => {
    const request = {
      baseUrl: '/api/v1',
      path: '/api/v1/domains/123',
      route: { path: '/domains/:id' },
    } as unknown as Request;
    expect(routeLabel(request)).toBe('/api/v1/domains/:id');
  });

  it('collapses unmatched paths to a single bounded label', () => {
    const request = {
      baseUrl: '/api/v1',
      path: '/api/v1/anything/with/many/segments',
      route: undefined,
    } as unknown as Request;
    expect(routeLabel(request)).toBe('unmatched');
  });

  it('bounds method labels', () => {
    expect(methodLabel('GET')).toBe('GET');
    expect(methodLabel('BREW')).toBe('OTHER');
  });
});
