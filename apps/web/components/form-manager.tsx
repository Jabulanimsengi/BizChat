'use client';

import type {
  IntakeFieldType,
  IntakeFormField,
  IntakeFormResponse,
  IntakePrefillClaim,
  RoutingSettingsResponse,
} from '@bizchat/types';
import { ClipboardList, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { announceRoutingConfigChange } from '../lib/routing-config-events';
import { Button } from './ui/button';

interface FieldDraft {
  key: string;
  label: string;
  type: IntakeFieldType;
  required: boolean;
  options: string;
  mask: string;
  prefillFrom: '' | IntakePrefillClaim;
}

interface FormDraft {
  id?: string;
  name: string;
  consentText: string;
  fields: FieldDraft[];
}

const EMPTY_FIELD: FieldDraft = {
  key: '',
  label: '',
  type: 'TEXT',
  required: true,
  options: '',
  mask: '',
  prefillFrom: '',
};
const EMPTY_FORM: FormDraft = { name: '', consentText: '', fields: [{ ...EMPTY_FIELD }] };

const TYPES: { value: IntakeFieldType; label: string }[] = [
  { value: 'TEXT', label: 'Text' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'PHONE', label: 'Phone' },
  { value: 'SELECT', label: 'Choice' },
  { value: 'REFERENCE', label: 'Reference number' },
];

const fieldClass =
  'mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-moss';

/** Pre-chat forms and when visitors see them. */
export function FormManager() {
  const [forms, setForms] = useState<IntakeFormResponse[]>([]);
  const [settings, setSettings] = useState<RoutingSettingsResponse>();
  const [draft, setDraft] = useState<FormDraft>(EMPTY_FORM);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiRequest<IntakeFormResponse[]>('/intake-forms'),
      apiRequest<RoutingSettingsResponse>('/routing/settings'),
    ])
      .then(([formList, current]) => {
        if (!active) return;
        setForms(formList);
        setSettings(current);
        setBusy(false);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setNotice(message(cause));
        setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function run(action: () => Promise<void>, success: string): Promise<void> {
    setBusy(true);
    setNotice(undefined);
    try {
      await action();
      setNotice(success);
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setBusy(false);
    }
  }

  function save(): Promise<void> {
    const body = {
      name: draft.name,
      consentText: draft.consentText.trim() || null,
      fields: toFields(draft.fields),
    };
    return run(
      async () => {
        const saved = await apiRequest<IntakeFormResponse>(
          draft.id ? `/intake-forms/${draft.id}` : '/intake-forms',
          { method: draft.id ? 'PATCH' : 'POST', body: JSON.stringify(body) },
        );
        setForms((current) => merge(current, saved));
        setDraft(EMPTY_FORM);
        announceRoutingConfigChange();
      },
      draft.id ? 'Form saved. New answers use the updated version.' : 'Form created.',
    );
  }

  function toggle(form: IntakeFormResponse): Promise<void> {
    const status = form.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    return run(
      async () => {
        const saved = await apiRequest<IntakeFormResponse>(`/intake-forms/${form.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        });
        setForms((current) => merge(current, saved));
        announceRoutingConfigChange();
      },
      `${form.name} ${status === 'ACTIVE' ? 'enabled' : 'disabled'}.`,
    );
  }

  function saveTiming(input: Partial<RoutingSettingsResponse>): Promise<void> {
    return run(async () => {
      setSettings(
        await apiRequest<RoutingSettingsResponse>('/routing/settings', {
          method: 'PUT',
          body: JSON.stringify(input),
        }),
      );
    }, 'Form settings saved.');
  }

  function updateField(index: number, patch: Partial<FieldDraft>): void {
    setDraft({
      ...draft,
      fields: draft.fields.map((field, position) =>
        position === index ? { ...field, ...patch } : field,
      ),
    });
  }

  if (busy && !settings && !notice)
    return (
      <div className="grid min-h-40 place-items-center rounded-3xl border border-line bg-white">
        <LoaderCircle className="animate-spin text-moss" />
      </div>
    );
  const activeForms = forms.filter(({ status }) => status === 'ACTIVE');
  return (
    <section className="space-y-4 rounded-3xl border border-line bg-white p-6">
      <div className="flex items-center gap-3">
        <ClipboardList className="text-moss" />
        <div>
          <h3 className="font-semibold">Pre-chat forms</h3>
          <p className="text-sm text-slate-500">
            Collect details before a consultant joins. Ask only for what consultants need; avoid ID
            numbers unless the service requires them.
          </p>
        </div>
      </div>
      {notice ? <p className="rounded-2xl bg-cream px-4 py-3 text-sm text-moss">{notice}</p> : null}
      {settings ? (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs font-medium text-slate-500">
            When to ask
            <select
              value={settings.intakeFormTiming}
              disabled={busy}
              onChange={(event) =>
                void saveTiming({
                  intakeFormTiming: event.target
                    .value as RoutingSettingsResponse['intakeFormTiming'],
                })
              }
              className={fieldClass}
            >
              <option value="AFTER_TOPIC">After the topic is known (form per topic)</option>
              <option value="BEFORE_CHAT">Before the first message (default form)</option>
            </select>
          </label>
          <label className="text-xs font-medium text-slate-500">
            Default form
            <select
              value={settings.defaultIntakeFormId ?? ''}
              disabled={busy}
              onChange={(event) =>
                void saveTiming({ defaultIntakeFormId: event.target.value || null })
              }
              className={fieldClass}
            >
              <option value="">No default form</option>
              {activeForms.map((form) => (
                <option key={form.id} value={form.id}>
                  {form.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      <ul className="space-y-2">
        {forms.map((form) => (
          <li
            key={form.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3"
          >
            <div>
              <p className={`font-medium ${form.status === 'ACTIVE' ? '' : 'text-slate-400'}`}>
                {form.name}
              </p>
              <p className="text-xs text-slate-500">
                {form.fields.length} field{form.fields.length === 1 ? '' : 's'} · version{' '}
                {form.version}
                {form.consentText ? ' · asks for consent' : ''}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setDraft(draftFrom(form))}
              >
                Edit
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void toggle(form)}>
                {form.status === 'ACTIVE' ? 'Disable' : 'Enable'}
              </Button>
            </div>
          </li>
        ))}
        {forms.length === 0 ? <p className="text-sm text-slate-400">No forms yet.</p> : null}
      </ul>
      <form
        className="space-y-3 border-t border-line pt-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p className="text-sm font-semibold">{draft.id ? `Edit ${draft.name}` : 'New form'}</p>
        <label className="block text-xs font-medium text-slate-500">
          Form name
          <input
            required
            minLength={2}
            maxLength={100}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            className={fieldClass}
          />
        </label>
        {draft.fields.map((field, index) => (
          <div key={index} className="grid gap-2 rounded-2xl bg-cream/60 p-3 md:grid-cols-6">
            <label className="text-xs font-medium text-slate-500 md:col-span-2">
              Label
              <input
                required
                maxLength={80}
                value={field.label}
                onChange={(event) => updateField(index, { label: event.target.value })}
                className={fieldClass}
              />
            </label>
            <label className="text-xs font-medium text-slate-500">
              Type
              <select
                value={field.type}
                onChange={(event) =>
                  updateField(index, { type: event.target.value as IntakeFieldType })
                }
                className={fieldClass}
              >
                {TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            {field.type === 'SELECT' ? (
              <label className="text-xs font-medium text-slate-500 md:col-span-2">
                Choices (comma separated)
                <input
                  required
                  value={field.options}
                  onChange={(event) => updateField(index, { options: event.target.value })}
                  className={fieldClass}
                />
              </label>
            ) : field.type === 'REFERENCE' ? (
              <label className="text-xs font-medium text-slate-500 md:col-span-2">
                Format (# digit, A letter, * either)
                <input
                  required
                  maxLength={40}
                  placeholder="####/######/##"
                  value={field.mask}
                  onChange={(event) => updateField(index, { mask: event.target.value })}
                  className={fieldClass}
                />
              </label>
            ) : field.type === 'TEXT' || field.type === 'EMAIL' ? (
              <label className="text-xs font-medium text-slate-500 md:col-span-2">
                Fill in for identified customers
                <select
                  value={field.prefillFrom}
                  onChange={(event) =>
                    updateField(index, {
                      prefillFrom: event.target.value as FieldDraft['prefillFrom'],
                    })
                  }
                  className={fieldClass}
                >
                  <option value="">No</option>
                  <option value="name">Their name</option>
                  <option value="email">Their email</option>
                </select>
              </label>
            ) : (
              <span className="md:col-span-2" />
            )}
            <div className="flex items-end justify-between gap-2">
              <label className="flex items-center gap-2 pb-2 text-xs">
                <input
                  type="checkbox"
                  className="accent-[#155f43]"
                  checked={field.required}
                  onChange={(event) => updateField(index, { required: event.target.checked })}
                />
                Required
              </label>
              <button
                type="button"
                aria-label={`Remove ${field.label || 'field'}`}
                disabled={draft.fields.length === 1}
                onClick={() =>
                  setDraft({
                    ...draft,
                    fields: draft.fields.filter((_, position) => position !== index),
                  })
                }
                className="mb-1 rounded-lg p-1.5 text-slate-400 hover:bg-white disabled:opacity-30"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          className="h-9 gap-1.5 px-3 text-xs"
          disabled={draft.fields.length >= 10}
          onClick={() => setDraft({ ...draft, fields: [...draft.fields, { ...EMPTY_FIELD }] })}
        >
          <Plus size={14} /> Add field
        </Button>
        <label className="block text-xs font-medium text-slate-500">
          Consent statement (optional; visitors must tick it)
          <textarea
            rows={2}
            maxLength={1000}
            value={draft.consentText}
            onChange={(event) => setDraft({ ...draft, consentText: event.target.value })}
            placeholder="I agree that my details may be used to handle this request."
            className={fieldClass}
          />
        </label>
        <div className="flex gap-2">
          <Button className="h-10 px-4" disabled={busy || draft.name.trim().length < 2}>
            {draft.id ? 'Save form' : 'Add form'}
          </Button>
          {draft.id ? (
            <Button
              type="button"
              variant="ghost"
              className="h-10 px-4"
              onClick={() => setDraft(EMPTY_FORM)}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}

/** A stable answer key from the label, e.g. "Registration number" → registration_number. */
export function fieldKey(label: string, taken: string[] = []): string {
  const base =
    label
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^(\d)/, 'f_$1')
      .slice(0, 36) || 'field';
  let key = base;
  for (let suffix = 2; taken.includes(key); suffix += 1) key = `${base}_${suffix}`;
  return key;
}

/** Existing fields keep their keys (stored answers use them); new fields get one from the label. */
function toFields(drafts: FieldDraft[]): IntakeFormField[] {
  const taken: string[] = [];
  return drafts.map((field) => {
    const key = field.key || fieldKey(field.label, taken);
    taken.push(key);
    return toField(field, key);
  });
}

function toField(field: FieldDraft, key: string): IntakeFormField {
  return {
    key,
    label: field.label.trim(),
    type: field.type,
    required: field.required,
    ...(field.type === 'SELECT'
      ? {
          options: field.options
            .split(',')
            .map((option) => option.trim())
            .filter(Boolean),
        }
      : {}),
    ...(field.type === 'REFERENCE' ? { mask: field.mask } : {}),
    ...((field.type === 'TEXT' || field.type === 'EMAIL') && field.prefillFrom
      ? { prefillFrom: field.prefillFrom }
      : {}),
  };
}

function draftFrom(form: IntakeFormResponse): FormDraft {
  return {
    id: form.id,
    name: form.name,
    consentText: form.consentText ?? '',
    fields: form.fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      required: field.required,
      options: field.options?.join(', ') ?? '',
      mask: field.mask ?? '',
      prefillFrom: field.prefillFrom ?? '',
    })),
  };
}

function merge(forms: IntakeFormResponse[], saved: IntakeFormResponse): IntakeFormResponse[] {
  return forms.some((form) => form.id === saved.id)
    ? forms.map((form) => (form.id === saved.id ? saved : form))
    : [...forms, saved];
}

function message(value: unknown): string {
  return value instanceof Error ? value.message : 'The request could not be completed';
}
