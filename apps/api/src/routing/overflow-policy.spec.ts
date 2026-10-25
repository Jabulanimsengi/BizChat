import type { OverflowStep } from '@bizchat/types';
import { dueOverflowLevel, nextOverflowAt, overflowScope, overflowSteps } from './overflow-policy';

const step = (afterSeconds: number, change: Partial<OverflowStep>): OverflowStep => ({
  afterSeconds,
  addDepartmentIds: [],
  relaxSkill: false,
  anyConsultant: false,
  ...change,
});

describe('overflow policy', () => {
  const steps = [
    step(60, { addDepartmentIds: ['general'] }),
    step(180, { relaxSkill: true }),
    step(300, { anyConsultant: true }),
  ];

  it('widens eligibility cumulatively with each level', () => {
    expect(overflowScope('sales', steps, 0)).toEqual({
      departmentIds: ['sales'],
      relaxSkill: false,
    });
    expect(overflowScope('sales', steps, 1)).toEqual({
      departmentIds: ['general', 'sales'],
      relaxSkill: false,
    });
    expect(overflowScope('sales', steps, 2)).toEqual({
      departmentIds: ['general', 'sales'],
      relaxSkill: true,
    });
    expect(overflowScope('sales', steps, 3)).toEqual({ departmentIds: null, relaxSkill: true });
  });

  it('leaves a conversation without a department open to anyone', () => {
    expect(overflowScope(null, steps, 0)).toEqual({ departmentIds: null, relaxSkill: false });
  });

  it('computes the due level and the next step time from the queue entry time', () => {
    const enqueuedAt = new Date('2026-10-25T10:00:00Z');
    expect(dueOverflowLevel(steps, 59_000)).toBe(0);
    expect(dueOverflowLevel(steps, 60_000)).toBe(1);
    expect(dueOverflowLevel(steps, 400_000)).toBe(3);
    expect(nextOverflowAt(steps, 0, enqueuedAt)?.toISOString()).toBe('2026-10-25T10:01:00.000Z');
    expect(nextOverflowAt(steps, 2, enqueuedAt)?.toISOString()).toBe('2026-10-25T10:05:00.000Z');
    expect(nextOverflowAt(steps, 3, enqueuedAt)).toBeNull();
  });

  it('reads stored steps defensively and in wait order', () => {
    expect(overflowSteps(null)).toEqual([]);
    expect(
      overflowSteps([{ afterSeconds: 120, relaxSkill: true }, { nope: 1 }, step(30, {})]),
    ).toEqual([step(30, {}), step(120, { relaxSkill: true })]);
  });
});
