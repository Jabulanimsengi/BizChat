import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createConnection } from 'node:net';

export const ATTACHMENT_SCANNER = Symbol('ATTACHMENT_SCANNER');

export interface AttachmentScanInput {
  buffer: Buffer;
  fileName: string;
}

export type AttachmentScanResult = { clean: true } | { clean: false; signature: string };

export interface AttachmentScanner {
  scan(input: AttachmentScanInput): Promise<AttachmentScanResult>;
}

export class AttachmentRejectedError extends Error {
  public constructor(public readonly signature: string) {
    super(`Attachment rejected by malware scanner: ${signature}`);
    this.name = 'AttachmentRejectedError';
  }
}

@Injectable()
export class DisabledAttachmentScanner implements AttachmentScanner {
  public scan(): Promise<AttachmentScanResult> {
    return Promise.resolve({ clean: true });
  }
}

export interface ClamavScannerOptions {
  host: string;
  port: number;
  timeoutMs: number;
}

const CHUNK_SIZE = 64 * 1024;

@Injectable()
export class ClamavAttachmentScanner implements AttachmentScanner {
  private readonly logger = new Logger(ClamavAttachmentScanner.name);

  public constructor(private readonly options: ClamavScannerOptions) {}

  public scan(input: AttachmentScanInput): Promise<AttachmentScanResult> {
    return new Promise<AttachmentScanResult>((resolve, reject) => {
      const socket = createConnection({ host: this.options.host, port: this.options.port });
      let response = '';
      let settled = false;
      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        action();
      };
      const timer = setTimeout(() => {
        finish(() =>
          reject(
            new ServiceUnavailableException({
              code: 'ATTACHMENT_SCAN_UNAVAILABLE',
              message: 'The malware scanner did not respond in time',
            }),
          ),
        );
      }, this.options.timeoutMs);
      socket.setTimeout(this.options.timeoutMs);
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        for (let offset = 0; offset < input.buffer.length; offset += CHUNK_SIZE) {
          const chunk = input.buffer.subarray(offset, offset + CHUNK_SIZE);
          const length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.length, 0);
          socket.write(length);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      });
      socket.on('data', (chunk) => {
        response += chunk.toString('utf8');
      });
      socket.on('timeout', () => {
        finish(() =>
          reject(
            new ServiceUnavailableException({
              code: 'ATTACHMENT_SCAN_UNAVAILABLE',
              message: 'The malware scanner did not respond in time',
            }),
          ),
        );
      });
      socket.on('error', (error) => {
        this.logger.error(`Malware scanner connection failed: ${error.message}`);
        finish(() =>
          reject(
            new ServiceUnavailableException({
              code: 'ATTACHMENT_SCAN_UNAVAILABLE',
              message: 'The malware scanner is unavailable',
            }),
          ),
        );
      });
      socket.on('end', () => {
        finish(() => resolve(parseClamavResponse(response)));
      });
    });
  }
}

export function parseClamavResponse(response: string): AttachmentScanResult {
  const normalized = response.replace(/\0/g, '').trim();
  if (/(^|\s)OK(\s|$)/i.test(normalized) && !/FOUND/i.test(normalized)) return { clean: true };
  const found = normalized.match(/^(?:stream:\s*)?(.+?)\s+FOUND/i);
  if (found?.[1]) return { clean: false, signature: found[1].trim() };
  throw new ServiceUnavailableException({
    code: 'ATTACHMENT_SCAN_UNAVAILABLE',
    message: 'The malware scanner returned an unrecognized response',
  });
}
