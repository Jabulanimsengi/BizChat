import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type IntakeForm } from '@prisma/client';
import type { IntakeFormField, IntakeFormResponse } from '@bizchat/types';
import type { CreateIntakeFormInput, UpdateIntakeFormInput } from '@bizchat/validation';
import { AuditService, auditActor } from '../audit/audit.service';
import type { AuthContext } from '../common/http.types';
import { PrismaService } from '../database/prisma.service';

/** Pre-chat form definitions. Stored answers keep the version the visitor saw. */
@Injectable()
export class IntakeFormAdminService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  public async list(auth: AuthContext): Promise<IntakeFormResponse[]> {
    const forms = await this.prisma.intakeForm.findMany({
      where: { businessId: auth.business.id },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    return forms.map(serializeForm);
  }

  public async create(
    auth: AuthContext,
    input: CreateIntakeFormInput,
    requestId: string,
    ipAddress?: string,
  ): Promise<IntakeFormResponse> {
    const form = await this.unique(() =>
      this.prisma.intakeForm.create({
        data: {
          businessId: auth.business.id,
          name: input.name,
          fields: input.fields,
          consentText: input.consentText ?? null,
        },
      }),
    );
    await this.record(auth, 'intake_form.created', form.id, requestId, ipAddress);
    return serializeForm(form);
  }

  public async update(
    auth: AuthContext,
    id: string,
    input: UpdateIntakeFormInput,
    requestId: string,
    ipAddress?: string,
  ): Promise<IntakeFormResponse> {
    const existing = await this.prisma.intakeForm.findFirst({
      where: { id, businessId: auth.business.id },
      select: { id: true },
    });
    if (!existing)
      throw new NotFoundException({ code: 'INTAKE_FORM_NOT_FOUND', message: 'Form not found' });
    // What the visitor is asked changed, so new answers are recorded against a new version.
    const contentChanged = input.fields !== undefined || input.consentText !== undefined;
    const form = await this.unique(() =>
      this.prisma.intakeForm.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.fields !== undefined ? { fields: input.fields } : {}),
          ...(input.consentText !== undefined ? { consentText: input.consentText } : {}),
          ...(contentChanged ? { version: { increment: 1 } } : {}),
        },
      }),
    );
    await this.record(auth, 'intake_form.updated', form.id, requestId, ipAddress);
    return serializeForm(form);
  }

  private async unique(write: () => Promise<IntakeForm>): Promise<IntakeForm> {
    try {
      return await write();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException({
          code: 'INTAKE_FORM_EXISTS',
          message: 'A form with this name already exists',
        });
      throw error;
    }
  }

  private record(
    auth: AuthContext,
    action: string,
    formId: string,
    requestId: string,
    ipAddress?: string,
  ): Promise<void> {
    return this.audit.record({
      businessId: auth.business.id,
      ...auditActor(auth),
      action,
      targetType: 'IntakeForm',
      targetId: formId,
      requestId,
      ipAddress,
    });
  }
}

function serializeForm(form: IntakeForm): IntakeFormResponse {
  return {
    id: form.id,
    name: form.name,
    version: form.version,
    fields: form.fields as unknown as IntakeFormField[],
    consentText: form.consentText,
    status: form.status,
    createdAt: form.createdAt.toISOString(),
    updatedAt: form.updatedAt.toISOString(),
  };
}
