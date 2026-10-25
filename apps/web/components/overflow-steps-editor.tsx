'use client';

import type { DepartmentResponse, OverflowStep } from '@bizchat/types';
import { Plus, Trash2 } from 'lucide-react';

export interface OverflowStepDraft {
  afterSeconds: string;
  addDepartmentIds: string[];
  relaxSkill: boolean;
  anyConsultant: boolean;
}

const MAX_STEPS = 5;

export function overflowDrafts(steps: OverflowStep[]): OverflowStepDraft[] {
  return steps.map((step) => ({ ...step, afterSeconds: String(step.afterSeconds) }));
}

/** The steps to save, in wait order; the API rejects steps that widen nothing. */
export function overflowStepsFrom(drafts: OverflowStepDraft[]): OverflowStep[] {
  return drafts
    .map((step) => ({
      afterSeconds: Number(step.afterSeconds),
      addDepartmentIds: step.anyConsultant ? [] : step.addDepartmentIds,
      relaxSkill: step.relaxSkill,
      anyConsultant: step.anyConsultant,
    }))
    .sort((left, right) => left.afterSeconds - right.afterSeconds);
}

const fieldClass =
  'mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-moss';

/** Timed steps that widen who may take a waiting chat; each step adds to the ones before it. */
export function OverflowStepsEditor({
  steps,
  departments,
  homeDepartmentId,
  onChange,
}: {
  steps: OverflowStepDraft[];
  departments: DepartmentResponse[];
  homeDepartmentId: string;
  onChange: (steps: OverflowStepDraft[]) => void;
}) {
  const update = (index: number, change: Partial<OverflowStepDraft>): void =>
    onChange(steps.map((step, position) => (position === index ? { ...step, ...change } : step)));
  const previous = steps.at(-1);
  return (
    <div className="rounded-xl border border-line p-3 md:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-ink">Overflow while waiting</p>
          <p className="text-xs text-slate-500">
            If nobody takes the chat in time, widen who can. Each step adds to the previous ones.
          </p>
        </div>
        <button
          type="button"
          disabled={steps.length >= MAX_STEPS}
          onClick={() =>
            onChange([
              ...steps,
              {
                afterSeconds: String(Number(previous?.afterSeconds ?? 0) + 60),
                addDepartmentIds: [],
                relaxSkill: false,
                anyConsultant: false,
              },
            ])
          }
          className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-moss disabled:opacity-40"
        >
          <Plus size={13} /> Add step
        </button>
      </div>
      {steps.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">
          No overflow: the chat waits for its own department.
        </p>
      ) : null}
      <ol className="mt-2 grid gap-2">
        {steps.map((step, index) => (
          <li
            key={index}
            className="grid gap-2 rounded-lg bg-slate-50 p-2 md:grid-cols-[110px_1fr_auto]"
          >
            <label className="text-xs font-medium text-slate-500">
              After (seconds)
              <input
                type="number"
                min={10}
                max={86_400}
                value={step.afterSeconds}
                onChange={(event) => update(index, { afterSeconds: event.target.value })}
                className={fieldClass}
              />
            </label>
            <div className="grid gap-1.5 text-xs">
              <span className="font-medium text-slate-500">Also allow</span>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {departments
                  .filter(({ id }) => id !== homeDepartmentId)
                  .map((department) => (
                    <label key={department.id} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="accent-[#155f43]"
                        disabled={step.anyConsultant}
                        checked={step.addDepartmentIds.includes(department.id)}
                        onChange={(event) =>
                          update(index, {
                            addDepartmentIds: event.target.checked
                              ? [...step.addDepartmentIds, department.id]
                              : step.addDepartmentIds.filter((id) => id !== department.id),
                          })
                        }
                      />
                      {department.name}
                    </label>
                  ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    className="accent-[#155f43]"
                    checked={step.relaxSkill}
                    onChange={(event) => update(index, { relaxSkill: event.target.checked })}
                  />
                  Drop the skill requirement
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    className="accent-[#155f43]"
                    checked={step.anyConsultant}
                    onChange={(event) => update(index, { anyConsultant: event.target.checked })}
                  />
                  Any online consultant
                </label>
              </div>
            </div>
            <button
              type="button"
              aria-label={`Remove step ${index + 1}`}
              onClick={() => onChange(steps.filter((_, position) => position !== index))}
              className="self-start rounded-lg p-1.5 text-slate-400 hover:text-red-600"
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
