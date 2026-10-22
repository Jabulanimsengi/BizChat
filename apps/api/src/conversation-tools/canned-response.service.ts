import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CannedResponseResponse } from '@bizchat/types';
import type {
  CannedResponseListQuery,
  CreateCannedResponseInput,
  UpdateCannedResponseInput,
} from '@bizchat/validation';
import type { AuthContext } from '../common/http.types';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class CannedResponseService {
  public constructor(private readonly prisma: PrismaService) {}
  public async list(
    auth: AuthContext,
    query: CannedResponseListQuery,
  ): Promise<CannedResponseResponse[]> {
    const responses = await this.prisma.cannedResponse.findMany({
      where: {
        businessId: auth.business.id,
        ...(query.includeDisabled ? {} : { status: 'ACTIVE' }),
        AND: [
          ...(query.departmentId
            ? [{ OR: [{ departmentId: null }, { departmentId: query.departmentId }] }]
            : []),
          ...(query.q
            ? [
                {
                  OR: [
                    { title: { contains: query.q, mode: 'insensitive' as const } },
                    { content: { contains: query.q, mode: 'insensitive' as const } },
                    { shortcut: { contains: query.q, mode: 'insensitive' as const } },
                  ],
                },
              ]
            : []),
        ],
      },
      include: { department: { select: { name: true } } },
      orderBy: [{ title: 'asc' }],
      take: 100,
    });
    return responses.map(serializeCannedResponse);
  }
  public async create(
    auth: AuthContext,
    input: CreateCannedResponseInput,
  ): Promise<CannedResponseResponse> {
    await this.assertDepartment(auth.business.id, input.departmentId);
    try {
      const created = await this.prisma.cannedResponse.create({
        data: { businessId: auth.business.id, createdByUserId: auth.user.id, ...input },
        include: { department: { select: { name: true } } },
      });
      return serializeCannedResponse(created);
    } catch (error) {
      this.handleUnique(error);
      throw error;
    }
  }
  public async update(
    auth: AuthContext,
    id: string,
    input: UpdateCannedResponseInput,
  ): Promise<CannedResponseResponse> {
    const existing = await this.prisma.cannedResponse.findFirst({
      where: { id, businessId: auth.business.id },
    });
    if (!existing)
      throw new NotFoundException({
        code: 'CANNED_RESPONSE_NOT_FOUND',
        message: 'Canned response not found',
      });
    await this.assertDepartment(auth.business.id, input.departmentId);
    try {
      return serializeCannedResponse(
        await this.prisma.cannedResponse.update({
          where: { id },
          data: input,
          include: { department: { select: { name: true } } },
        }),
      );
    } catch (error) {
      this.handleUnique(error);
      throw error;
    }
  }
  private async assertDepartment(
    businessId: string,
    departmentId: string | null | undefined,
  ): Promise<void> {
    if (!departmentId) return;
    const department = await this.prisma.department.findFirst({
      where: { id: departmentId, businessId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!department)
      throw new NotFoundException({
        code: 'DEPARTMENT_NOT_FOUND',
        message: 'Department not found',
      });
  }
  private handleUnique(error: unknown): void {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new ConflictException({
        code: 'CANNED_RESPONSE_SHORTCUT_EXISTS',
        message: 'This shortcut is already in use',
      });
  }
}

function serializeCannedResponse(response: {
  id: string;
  departmentId: string | null;
  title: string;
  content: string;
  shortcut: string | null;
  status: 'ACTIVE' | 'DISABLED';
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  department: { name: string } | null;
}): CannedResponseResponse {
  return {
    id: response.id,
    departmentId: response.departmentId,
    departmentName: response.department?.name ?? null,
    title: response.title,
    content: response.content,
    shortcut: response.shortcut,
    status: response.status,
    createdByUserId: response.createdByUserId,
    createdAt: response.createdAt.toISOString(),
    updatedAt: response.updatedAt.toISOString(),
  };
}
