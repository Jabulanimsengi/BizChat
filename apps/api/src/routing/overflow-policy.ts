import type { OverflowStep } from '@bizchat/types';

/** Reads a topic's stored steps defensively; the API validates them on write. */
export function overflowSteps(value: unknown): OverflowStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (step: unknown): step is Record<string, unknown> =>
        typeof step === 'object' &&
        step !== null &&
        typeof (step as Record<string, unknown>).afterSeconds === 'number',
    )
    .map((step) => ({
      afterSeconds: step.afterSeconds as number,
      addDepartmentIds: Array.isArray(step.addDepartmentIds)
        ? step.addDepartmentIds.filter((id): id is string => typeof id === 'string')
        : [],
      relaxSkill: step.relaxSkill === true,
      anyConsultant: step.anyConsultant === true,
    }))
    .sort((left, right) => left.afterSeconds - right.afterSeconds);
}

/** Who may take a conversation once `level` overflow steps apply. Null departments means anyone. */
export interface OverflowScope {
  departmentIds: string[] | null;
  relaxSkill: boolean;
}

export function overflowScope(
  departmentId: string | null,
  steps: OverflowStep[],
  level: number,
): OverflowScope {
  const applied = steps.slice(0, level);
  if (departmentId === null || applied.some((step) => step.anyConsultant))
    return {
      departmentIds: null,
      relaxSkill: applied.some((step) => step.anyConsultant || step.relaxSkill),
    };
  const departmentIds = new Set([departmentId]);
  for (const step of applied) for (const id of step.addDepartmentIds) departmentIds.add(id);
  return {
    departmentIds: [...departmentIds].sort(),
    relaxSkill: applied.some((step) => step.relaxSkill),
  };
}

/** How many steps are due after waiting `waitedMs`. */
export function dueOverflowLevel(steps: OverflowStep[], waitedMs: number): number {
  return steps.filter((step) => step.afterSeconds * 1_000 <= waitedMs).length;
}

/** When the step after `level` is due, or null when every step already applies. */
export function nextOverflowAt(
  steps: OverflowStep[],
  level: number,
  enqueuedAt: Date,
): Date | null {
  const next = steps[level];
  return next ? new Date(enqueuedAt.getTime() + next.afterSeconds * 1_000) : null;
}
