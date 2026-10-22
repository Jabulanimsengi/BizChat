import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TagResponse } from '@bizchat/types';
import type { CreateTagInput, UpdateTagInput } from '@bizchat/validation';
import type { AuthContext } from '../common/http.types';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class TagService {
  public constructor(private readonly prisma: PrismaService) {}
  public async list(auth: AuthContext): Promise<TagResponse[]> {
    const tags = await this.prisma.tag.findMany({
      where: { businessId: auth.business.id, status: 'ACTIVE' },
      orderBy: { name: 'asc' },
    });
    return tags.map(serializeTag);
  }
  public async create(auth: AuthContext, input: CreateTagInput): Promise<TagResponse> {
    try {
      return serializeTag(
        await this.prisma.tag.create({ data: { businessId: auth.business.id, ...input } }),
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException({
          code: 'TAG_EXISTS',
          message: 'A tag with this name already exists',
        });
      throw error;
    }
  }
  public async update(auth: AuthContext, id: string, input: UpdateTagInput): Promise<TagResponse> {
    const existing = await this.prisma.tag.findFirst({
      where: { id, businessId: auth.business.id },
    });
    if (!existing) throw new NotFoundException({ code: 'TAG_NOT_FOUND', message: 'Tag not found' });
    try {
      return serializeTag(await this.prisma.tag.update({ where: { id }, data: input }));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException({
          code: 'TAG_EXISTS',
          message: 'A tag with this name already exists',
        });
      throw error;
    }
  }
}

function serializeTag(tag: {
  id: string;
  name: string;
  color: string;
  status: 'ACTIVE' | 'DISABLED';
  createdAt: Date;
  updatedAt: Date;
}): TagResponse {
  return {
    id: tag.id,
    name: tag.name,
    color: tag.color,
    status: tag.status,
    createdAt: tag.createdAt.toISOString(),
    updatedAt: tag.updatedAt.toISOString(),
  };
}
