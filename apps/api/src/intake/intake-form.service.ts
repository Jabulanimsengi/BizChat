import { BadRequestException, Injectable } from '@nestjs/common';
import type { IntakeForm, Prisma } from '@prisma/client';
import type {
  ConversationIntakeResponse,
  IntakeAnswer,
  IntakeFormField,
  WidgetIntakeForm,
} from '@bizchat/types';
import { validateIntakeAnswers, type IntakeAnswersInput } from '@bizchat/validation';
import { PrismaService } from '../database/prisma.service';

/** A form the visitor still has to complete, or answers already satisfied by identity claims. */
export interface FormRequirement {
  form: IntakeForm;
  prefill: Record<string, string>;
  /** Set when identity claims answer every required field and there is no consent to give. */
  autoAnswers: IntakeAnswer[] | null;
}

export function formFields(form: IntakeForm): IntakeFormField[] {
  return form.fields as unknown as IntakeFormField[];
}

/** Pre-chat forms: which one applies, pre-filling from identity claims, validation, and storage. */
@Injectable()
export class IntakeFormService {
  public constructor(private readonly prisma: PrismaService) {}

  /** The form asked after a topic is known (AFTER_TOPIC timing): the topic's own, else the default. */
  public async afterTopicForm(
    businessId: string,
    topicId: string | null,
  ): Promise<IntakeForm | null> {
    const settings = await this.prisma.routingSettings.findUnique({
      where: { businessId },
      select: { intakeFormTiming: true, defaultIntakeFormId: true },
    });
    if (settings?.intakeFormTiming === 'BEFORE_CHAT') return null;
    const topic = topicId
      ? await this.prisma.topic.findFirst({
          where: { id: topicId, businessId },
          select: { intakeFormId: true },
        })
      : null;
    return this.active(businessId, topic?.intakeFormId ?? settings?.defaultIntakeFormId ?? null);
  }

  /** The default form shown before the first message (BEFORE_CHAT timing). */
  public async beforeChatForm(businessId: string): Promise<IntakeForm | null> {
    const settings = await this.prisma.routingSettings.findUnique({
      where: { businessId },
      select: { intakeFormTiming: true, defaultIntakeFormId: true },
    });
    return settings?.intakeFormTiming === 'BEFORE_CHAT'
      ? this.active(businessId, settings.defaultIntakeFormId)
      : null;
  }

  public async requirement(
    businessId: string,
    topicId: string | null,
    visitorId: string | null,
  ): Promise<FormRequirement | null> {
    const form = await this.afterTopicForm(businessId, topicId);
    if (!form) return null;
    const prefill = await this.prefill(form, visitorId);
    const result = form.consentText
      ? null
      : validateIntakeAnswers(
          { fields: formFields(form), consentText: null },
          { answers: {} },
          prefill,
        );
    return { form, prefill, autoAnswers: result?.ok ? result.answers : null };
  }

  /** Values for fields filled from the visitor's signed identity claims (name, email). */
  public async prefill(
    form: IntakeForm,
    visitorId: string | null,
  ): Promise<Record<string, string>> {
    const fields = formFields(form).filter((field) => field.prefillFrom);
    if (!visitorId || fields.length === 0) return {};
    const customer = await this.prisma.integrationCustomer.findUnique({
      where: { visitorId },
      select: { displayName: true, email: true },
    });
    const claims = { name: customer?.displayName, email: customer?.email };
    return Object.fromEntries(
      fields
        .map((field) => [field.key, field.prefillFrom ? claims[field.prefillFrom] : null] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
    );
  }

  public widgetForm(form: IntakeForm, prefill: Record<string, string>): WidgetIntakeForm {
    return {
      name: form.name,
      consentText: form.consentText,
      // Which claim fills a field stays on the server; the widget only sees the value.
      fields: formFields(form).map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        required: field.required,
        ...(field.maxLength ? { maxLength: field.maxLength } : {}),
        ...(field.options ? { options: field.options } : {}),
        ...(field.mask ? { mask: field.mask } : {}),
        ...(prefill[field.key] ? { value: prefill[field.key] } : {}),
      })),
    };
  }

  /** Validated answers, or a 400 listing each problem by field key. */
  public validate(
    form: IntakeForm,
    input: IntakeAnswersInput,
    prefill: Record<string, string>,
  ): IntakeAnswer[] {
    const result = validateIntakeAnswers(
      { fields: formFields(form), consentText: form.consentText },
      input,
      prefill,
    );
    if (!result.ok)
      throw new BadRequestException({
        code: 'INTAKE_INVALID',
        message: 'Please check the highlighted fields',
        details: { fieldErrors: result.errors },
      });
    return result.answers;
  }

  public async record(
    transaction: Prisma.TransactionClient,
    businessId: string,
    conversationId: string,
    form: IntakeForm,
    answers: IntakeAnswer[],
    consent: boolean,
  ): Promise<void> {
    await transaction.conversationIntake.create({
      data: {
        businessId,
        conversationId,
        formId: form.id,
        formVersion: form.version,
        answers: answers as unknown as Prisma.InputJsonValue,
        consentAt: form.consentText && consent ? new Date() : null,
      },
    });
  }

  public async forConversation(conversationId: string): Promise<ConversationIntakeResponse | null> {
    const intake = await this.prisma.conversationIntake.findUnique({
      where: { conversationId },
      include: { form: { select: { name: true } } },
    });
    if (!intake) return null;
    return {
      formName: intake.form?.name ?? null,
      formVersion: intake.formVersion,
      answers: intake.answers as unknown as IntakeAnswer[],
      consentAt: intake.consentAt?.toISOString() ?? null,
      submittedAt: intake.submittedAt.toISOString(),
    };
  }

  private active(businessId: string, formId: string | null): Promise<IntakeForm | null> {
    return formId
      ? this.prisma.intakeForm.findFirst({ where: { id: formId, businessId, status: 'ACTIVE' } })
      : Promise.resolve(null);
  }
}
