import { Logger, type INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly adapterConstructor: ReturnType<typeof createAdapter>;

  public constructor(app: INestApplicationContext, redisUrl: string) {
    super(app);
    const options = {
      connectTimeout: 3_000,
      maxRetriesPerRequest: null,
      retryStrategy: (attempt: number): number => Math.min(attempt * 250, 5_000),
    };
    this.publisher = new Redis(redisUrl, options);
    this.subscriber = this.publisher.duplicate();
    this.publisher.on('ready', () => this.logger.log('Socket.IO Redis publisher ready'));
    this.subscriber.on('ready', () => this.logger.log('Socket.IO Redis subscriber ready'));
    this.publisher.on('error', (error) =>
      this.logger.warn(`Socket.IO Redis publisher unavailable: ${error.message}`),
    );
    this.subscriber.on('error', (error) =>
      this.logger.warn(`Socket.IO Redis subscriber unavailable: ${error.message}`),
    );
    this.adapterConstructor = createAdapter(this.publisher, this.subscriber, {
      publishOnSpecificResponseChannel: true,
    });
  }

  public override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    server.adapter(this.adapterConstructor);
    return server;
  }

  public override async close(server: Server): Promise<void> {
    await Promise.allSettled([
      this.publisher.status === 'end' ? Promise.resolve() : this.publisher.quit(),
      this.subscriber.status === 'end' ? Promise.resolve() : this.subscriber.quit(),
    ]);
    await super.close(server);
  }
}
