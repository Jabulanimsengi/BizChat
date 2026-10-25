import type { ConversationResponse } from '@bizchat/types';
import { describe, expect, it } from 'vitest';
import { waitFlags } from './follow-up-details';
import { overflowDrafts, overflowStepsFrom } from './overflow-steps-editor';

describe('overflow step drafts', () => {
  it('saves steps in wait order and drops departments when any consultant may take the chat', () => {
    expect(
      overflowStepsFrom([
        {
          afterSeconds: '300',
          addDepartmentIds: ['general'],
          relaxSkill: false,
          anyConsultant: true,
        },
        {
          afterSeconds: '60',
          addDepartmentIds: ['general'],
          relaxSkill: false,
          anyConsultant: false,
        },
      ]),
    ).toEqual([
      { afterSeconds: 60, addDepartmentIds: ['general'], relaxSkill: false, anyConsultant: false },
      { afterSeconds: 300, addDepartmentIds: [], relaxSkill: false, anyConsultant: true },
    ]);
  });

  it('round-trips saved steps through the editor', () => {
    const steps = [
      { afterSeconds: 90, addDepartmentIds: [], relaxSkill: true, anyConsultant: false },
    ];
    expect(overflowStepsFrom(overflowDrafts(steps))).toEqual(steps);
  });
});

describe('inbox wait flags', () => {
  const conversation = (change: Partial<ConversationResponse>): ConversationResponse =>
    ({
      status: 'QUEUED',
      overflowLevel: 0,
      followUpRequestedAt: null,
      ...change,
    }) as ConversationResponse;

  it('flags follow-ups and overflowed chats still waiting', () => {
    expect(waitFlags(conversation({}))).toEqual([]);
    expect(waitFlags(conversation({ overflowLevel: 1 }))).toEqual(['Overflow']);
    expect(waitFlags(conversation({ overflowLevel: 1, status: 'ASSIGNED' }))).toEqual([]);
    expect(waitFlags(conversation({ followUpRequestedAt: '2026-10-25T10:00:00Z' }))).toEqual([
      'Follow-up',
    ]);
  });
});
