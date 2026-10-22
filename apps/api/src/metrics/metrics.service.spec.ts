import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('records request counters and duration summaries', () => {
    const metrics = new MetricsService();
    metrics.recordRequest('GET', '/api/v1/health/ready', 200, 12);
    metrics.recordRequest('GET', '/api/v1/health/ready', 200, 8);

    const output = metrics.render();
    expect(output).toContain(
      'bizchat_http_requests_total{method="GET",route="/api/v1/health/ready",status="200"} 2',
    );
    expect(output).toContain(
      'bizchat_http_request_duration_ms_sum{method="GET",route="/api/v1/health/ready"} 20',
    );
    expect(output).toContain(
      'bizchat_http_request_duration_ms_count{method="GET",route="/api/v1/health/ready"} 2',
    );
  });

  it('bounds the number of series and folds the rest into overflow', () => {
    const metrics = new MetricsService();
    for (let index = 0; index < 5_000; index += 1) {
      metrics.recordRequest('GET', `/api/v1/nope/${index}`, 404, 1);
    }
    const output = metrics.render();
    const seriesCount = (output.match(/bizchat_http_requests_total\{/g) ?? []).length;
    expect(seriesCount).toBeLessThanOrEqual(2_001);
    expect(output).toContain('route="overflow"');
  });

  it('still increments existing series after the cap is reached', () => {
    const metrics = new MetricsService();
    metrics.recordRequest('POST', '/api/v1/known', 201, 5);
    for (let index = 0; index < 3_000; index += 1) {
      metrics.recordRequest('GET', `/api/v1/nope/${index}`, 404, 1);
    }
    metrics.recordRequest('POST', '/api/v1/known', 201, 5);
    expect(metrics.render()).toContain(
      'bizchat_http_requests_total{method="POST",route="/api/v1/known",status="201"} 2',
    );
  });
});
