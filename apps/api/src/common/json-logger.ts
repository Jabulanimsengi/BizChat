import type { LoggerService } from '@nestjs/common';

type Level = 'info' | 'warn' | 'error' | 'debug' | 'verbose';

function normalize(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function stringify(record: Record<string, unknown>): string {
  return `${JSON.stringify(record, (_key: string, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  )}\n`;
}

export class JsonLogger implements LoggerService {
  public log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', message, optionalParams);
  }

  public error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }

  public warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  public debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  public verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('verbose', message, optionalParams);
  }

  private write(level: Level, message: unknown, params: unknown[]): void {
    const context = [...params].reverse().find((param) => typeof param === 'string');
    const details = params.filter((param) => param !== context).map(normalize);
    const record: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      message: normalize(message),
      ...(typeof context === 'string' ? { context } : {}),
      ...(details.length > 0 ? { details } : {}),
    };
    const stream = level === 'error' ? process.stderr : process.stdout;
    stream.write(stringify(record));
  }
}
