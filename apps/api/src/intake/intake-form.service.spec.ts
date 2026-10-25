import { BadRequestException } from '@nestjs/common';
import { IntakeFormService } from './intake-form.service';

describe('IntakeFormService', () => {
  const companyForm = {
    id: 'form-company',
    businessId: 'business-1',
    name: 'Company details',
    version: 3,
    consentText: null,
    status: 'ACTIVE',
    fields: [
      { key: 'full_name', label: 'Full name', type: 'TEXT', required: true, prefillFrom: 'name' },
      { key: 'email', label: 'Email', type: 'EMAIL', required: true, prefillFrom: 'email' },
      {
        key: 'registration_number',
        label: 'Registration number',
        type: 'REFERENCE',
        required: false,
        mask: '####/######/##',
      },
    ],
  };

  const setup = (
    settings: Record<string, unknown> | null,
    topicFormId: string | null,
    customer: Record<string, unknown> | null = null,
  ): { service: IntakeFormService; findForm: jest.Mock } => {
    const findForm = jest.fn((args: { where: { id: string } }) =>
      Promise.resolve(args.where.id === companyForm.id ? companyForm : null),
    );
    const prisma = {
      routingSettings: { findUnique: jest.fn().mockResolvedValue(settings) },
      topic: { findFirst: jest.fn().mockResolvedValue({ intakeFormId: topicFormId }) },
      intakeForm: { findFirst: findForm },
      integrationCustomer: { findUnique: jest.fn().mockResolvedValue(customer) },
    };
    return { service: new IntakeFormService(prisma as never), findForm };
  };

  it("uses the topic's own form after the topic is known", async () => {
    const { service } = setup(
      { intakeFormTiming: 'AFTER_TOPIC', defaultIntakeFormId: null },
      'form-company',
    );
    await expect(service.afterTopicForm('business-1', 'topic-1')).resolves.toBe(companyForm);
  });

  it('falls back to the default form, and asks nothing after topics in BEFORE_CHAT mode', async () => {
    const fallback = setup(
      { intakeFormTiming: 'AFTER_TOPIC', defaultIntakeFormId: 'form-company' },
      null,
    );
    await expect(fallback.service.afterTopicForm('business-1', 'topic-1')).resolves.toBe(
      companyForm,
    );

    const before = setup(
      { intakeFormTiming: 'BEFORE_CHAT', defaultIntakeFormId: 'form-company' },
      null,
    );
    await expect(before.service.afterTopicForm('business-1', 'topic-1')).resolves.toBeNull();
    await expect(before.service.beforeChatForm('business-1')).resolves.toBe(companyForm);
  });

  it('only uses active forms of the same tenant', async () => {
    const { service, findForm } = setup(
      { intakeFormTiming: 'AFTER_TOPIC', defaultIntakeFormId: null },
      'form-company',
    );
    await service.afterTopicForm('business-1', 'topic-1');
    expect(findForm).toHaveBeenCalledWith({
      where: { id: 'form-company', businessId: 'business-1', status: 'ACTIVE' },
    });
  });

  it('answers a form from identity claims when they cover every required field', async () => {
    const { service } = setup(
      { intakeFormTiming: 'AFTER_TOPIC', defaultIntakeFormId: 'form-company' },
      null,
      { displayName: 'Thandi Mokoena', email: 'thandi@example.com' },
    );

    const requirement = await service.requirement('business-1', null, 'visitor-1');

    expect(requirement?.prefill).toEqual({
      full_name: 'Thandi Mokoena',
      email: 'thandi@example.com',
    });
    expect(requirement?.autoAnswers).toEqual([
      { key: 'full_name', label: 'Full name', value: 'Thandi Mokoena' },
      { key: 'email', label: 'Email', value: 'thandi@example.com' },
    ]);
  });

  it('still asks an anonymous visitor, showing nothing prefilled', async () => {
    const { service } = setup(
      { intakeFormTiming: 'AFTER_TOPIC', defaultIntakeFormId: 'form-company' },
      null,
    );

    const requirement = await service.requirement('business-1', null, null);

    expect(requirement?.autoAnswers).toBeNull();
    expect(service.widgetForm(companyForm as never, {}).fields.map(({ key }) => key)).toEqual([
      'full_name',
      'email',
      'registration_number',
    ]);
  });

  it('reports invalid answers per field', () => {
    const { service } = setup(null, null);
    try {
      service.validate(
        companyForm as never,
        { answers: { full_name: 'Thandi', email: 'not-an-email', registration_number: '2019-1' } },
        {},
      );
      throw new Error('expected a validation error');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse() as {
        code: string;
        details: { fieldErrors: Record<string, string> };
      };
      expect(body.code).toBe('INTAKE_INVALID');
      expect(Object.keys(body.details.fieldErrors).sort()).toEqual([
        'email',
        'registration_number',
      ]);
    }
  });
});
