import { Injectable } from '@nestjs/common';

interface DurationStat {
  count: number;
  totalMs: number;
}

const MAX_SERIES = 2_000;

@Injectable()
export class MetricsService {
  private readonly startedAt = Date.now();
  private readonly requests = new Map<string, number>();
  private readonly durations = new Map<string, DurationStat>();

  public recordRequest(method: string, route: string, status: number, durationMs: number): void {
    const requestKey = this.requestKey(method, route, status);
    this.requests.set(requestKey, (this.requests.get(requestKey) ?? 0) + 1);
    const durationKey = this.durationKey(method, route);
    const duration = this.durations.get(durationKey) ?? { count: 0, totalMs: 0 };
    duration.count += 1;
    duration.totalMs += durationMs;
    this.durations.set(durationKey, duration);
  }

  private requestKey(method: string, route: string, status: number): string {
    const key = `${method}|${route}|${status}`;
    if (this.requests.has(key) || this.requests.size < MAX_SERIES) return key;
    return 'OTHER|overflow|0';
  }

  private durationKey(method: string, route: string): string {
    const key = `${method}|${route}`;
    if (this.durations.has(key) || this.durations.size < MAX_SERIES) return key;
    return 'OTHER|overflow';
  }

  public render(): string {
    const lines: string[] = [];
    lines.push('# HELP bizchat_http_requests_total Total HTTP requests by method, route, status.');
    lines.push('# TYPE bizchat_http_requests_total counter');
    for (const [key, count] of [...this.requests.entries()].sort()) {
      const [method, route, status] = key.split('|');
      lines.push(
        `bizchat_http_requests_total{method="${escapeLabel(method ?? '')}",route="${escapeLabel(route ?? '')}",status="${escapeLabel(status ?? '')}"} ${count}`,
      );
    }
    lines.push('# HELP bizchat_http_request_duration_ms Request duration in milliseconds.');
    lines.push('# TYPE bizchat_http_request_duration_ms summary');
    for (const [key, duration] of [...this.durations.entries()].sort()) {
      const [method, route] = key.split('|');
      const labels = `method="${escapeLabel(method ?? '')}",route="${escapeLabel(route ?? '')}"`;
      lines.push(`bizchat_http_request_duration_ms_sum{${labels}} ${duration.totalMs}`);
      lines.push(`bizchat_http_request_duration_ms_count{${labels}} ${duration.count}`);
    }
    const memory = process.memoryUsage();
    lines.push('# HELP bizchat_process_uptime_seconds Process uptime in seconds.');
    lines.push('# TYPE bizchat_process_uptime_seconds gauge');
    lines.push(`bizchat_process_uptime_seconds ${(Date.now() - this.startedAt) / 1000}`);
    lines.push('# HELP bizchat_process_resident_memory_bytes Resident memory in bytes.');
    lines.push('# TYPE bizchat_process_resident_memory_bytes gauge');
    lines.push(`bizchat_process_resident_memory_bytes ${memory.rss}`);
    return `${lines.join('\n')}\n`;
  }
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
