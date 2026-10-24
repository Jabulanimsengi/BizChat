'use client';

import type {
  ConversationPriority,
  DepartmentResponse,
  RoutingSettingsResponse,
  SkillResponse,
  TopicKeyword,
  TopicResponse,
  TopicTestResponse,
} from '@bizchat/types';
import { FlaskConical, LoaderCircle, Plus, Tags } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { Button } from './ui/button';

interface TopicDraft {
  id?: string;
  name: string;
  description: string;
  departmentId: string;
  requiredSkillId: string;
  requiredSkillMinProficiency: string;
  priority: ConversationPriority;
  keywords: string;
  negativeKeywords: string;
  examples: string;
  showAsQuickReply: boolean;
  isDefault: boolean;
  sortOrder: string;
}

const EMPTY_DRAFT: TopicDraft = {
  name: '',
  description: '',
  departmentId: '',
  requiredSkillId: '',
  requiredSkillMinProficiency: '1',
  priority: 'NORMAL',
  keywords: '',
  negativeKeywords: '',
  examples: '',
  showAsQuickReply: true,
  isDefault: false,
  sortOrder: '0',
};

const fieldClass =
  'mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-moss';

/** Topics: what visitors ask about, how the first message is matched, and where it routes. */
export function TopicManager() {
  const [topics, setTopics] = useState<TopicResponse[]>([]);
  const [departments, setDepartments] = useState<DepartmentResponse[]>([]);
  const [skills, setSkills] = useState<SkillResponse[]>([]);
  const [settings, setSettings] = useState<RoutingSettingsResponse>();
  const [draft, setDraft] = useState<TopicDraft>(EMPTY_DRAFT);
  const [testMessage, setTestMessage] = useState('');
  const [testResult, setTestResult] = useState<TopicTestResponse>();
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiRequest<TopicResponse[]>('/topics'),
      apiRequest<DepartmentResponse[]>('/departments'),
      apiRequest<SkillResponse[]>('/skills'),
      apiRequest<RoutingSettingsResponse>('/routing/settings'),
    ])
      .then(([topicList, departmentList, skillList, current]) => {
        if (!active) return;
        setTopics(topicList);
        setDepartments(departmentList.filter(({ status }) => status === 'ACTIVE'));
        setSkills(skillList.filter(({ status }) => status === 'ACTIVE'));
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

  async function run(action: () => Promise<void>, success?: string): Promise<void> {
    setBusy(true);
    setNotice(undefined);
    try {
      await action();
      if (success) setNotice(success);
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setBusy(false);
    }
  }

  function save(): Promise<void> {
    const body = {
      name: draft.name,
      description: draft.description.trim() || null,
      departmentId: draft.departmentId || null,
      requiredSkillId: draft.requiredSkillId || null,
      requiredSkillMinProficiency: draft.requiredSkillId
        ? Number(draft.requiredSkillMinProficiency)
        : null,
      priority: draft.priority,
      keywords: parseKeywords(draft.keywords),
      negativeKeywords: lines(draft.negativeKeywords),
      examples: lines(draft.examples),
      showAsQuickReply: draft.showAsQuickReply,
      isDefault: draft.isDefault,
      sortOrder: Number(draft.sortOrder),
    };
    return run(
      async () => {
        const saved = await apiRequest<TopicResponse>(
          draft.id ? `/topics/${draft.id}` : '/topics',
          { method: draft.id ? 'PATCH' : 'POST', body: JSON.stringify(body) },
        );
        // Saving a default topic clears the previous default, so reload the list.
        setTopics(
          saved.isDefault ? await apiRequest<TopicResponse[]>('/topics') : merge(topics, saved),
        );
        setDraft(EMPTY_DRAFT);
      },
      draft.id ? 'Topic saved.' : 'Topic created.',
    );
  }

  function toggleStatus(topic: TopicResponse): Promise<void> {
    const status = topic.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    return run(
      async () => {
        const saved = await apiRequest<TopicResponse>(`/topics/${topic.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        });
        setTopics(merge(topics, saved));
      },
      `${topic.name} ${status === 'ACTIVE' ? 'enabled' : 'disabled'}.`,
    );
  }

  function test(): Promise<void> {
    return run(async () => {
      setTestResult(
        await apiRequest<TopicTestResponse>('/topics/test', {
          method: 'POST',
          body: JSON.stringify({ message: testMessage }),
        }),
      );
    });
  }

  function saveThresholds(form: HTMLFormElement): Promise<void> {
    const data = new FormData(form);
    return run(async () => {
      setSettings(
        await apiRequest<RoutingSettingsResponse>('/routing/settings', {
          method: 'PUT',
          body: JSON.stringify({
            autoRouteThreshold: Number(data.get('autoRouteThreshold')),
            confirmThreshold: Number(data.get('confirmThreshold')),
            topicPromptTimeoutSeconds: Number(data.get('topicPromptTimeoutSeconds')),
          }),
        }),
      );
    }, 'Matching settings saved.');
  }

  if (busy && !settings && !notice)
    return (
      <div className="grid min-h-64 place-items-center rounded-3xl border border-line bg-white">
        <LoaderCircle className="animate-spin text-moss" />
      </div>
    );
  const departmentName = (id: string | null): string =>
    departments.find((department) => department.id === id)?.name ?? 'Default department';
  return (
    <div className="space-y-6">
      {notice ? (
        <p className="rounded-2xl border border-line bg-white px-4 py-3 text-sm text-moss">
          {notice}
        </p>
      ) : null}
      <section className="rounded-3xl border border-line bg-white p-6">
        <div className="flex items-center gap-3">
          <Tags className="text-moss" />
          <div>
            <h3 className="font-semibold">Topics</h3>
            <p className="text-sm text-slate-500">
              BizChat matches a visitor&apos;s first message against each topic&apos;s keywords and
              examples, then routes it to the topic&apos;s department and skill. When it is unsure,
              the visitor picks from the best matches.
            </p>
          </div>
        </div>
        <ul className="mt-5 space-y-2">
          {topics.map((topic) => (
            <li
              key={topic.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3"
            >
              <div className="min-w-0">
                <p className={`font-medium ${topic.status === 'ACTIVE' ? '' : 'text-slate-400'}`}>
                  {topic.name}
                  {topic.isDefault ? (
                    <span className="ml-2 rounded-full bg-mint px-2 py-0.5 text-xs text-moss">
                      default
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {departmentName(topic.departmentId)} · {topic.keywords.length} keyword
                  {topic.keywords.length === 1 ? '' : 's'} · {topic.examples.length} example
                  {topic.examples.length === 1 ? '' : 's'}
                  {topic.showAsQuickReply ? ' · shown as a button' : ''}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setDraft(draftFrom(topic))}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void toggleStatus(topic)}
                >
                  {topic.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                </Button>
              </div>
            </li>
          ))}
          {topics.length === 0 ? (
            <p className="text-sm text-slate-400">
              No topics yet. Without topics, chats route to the default department as before.
            </p>
          ) : null}
        </ul>
        <form
          className="mt-6 grid gap-4 border-t border-line pt-5 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <p className="text-sm font-semibold md:col-span-2">
            {draft.id ? `Edit ${draft.name}` : 'New topic'}
          </p>
          <label className="text-xs font-medium text-slate-500">
            Name
            <input
              required
              minLength={2}
              maxLength={100}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              className={fieldClass}
            />
          </label>
          <label className="text-xs font-medium text-slate-500">
            Department
            <select
              value={draft.departmentId}
              onChange={(event) => setDraft({ ...draft, departmentId: event.target.value })}
              className={fieldClass}
            >
              <option value="">Default department</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-500">
            Required skill
            <select
              value={draft.requiredSkillId}
              onChange={(event) => setDraft({ ...draft, requiredSkillId: event.target.value })}
              className={fieldClass}
            >
              <option value="">No skill required</option>
              {skills.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  {skill.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="text-xs font-medium text-slate-500">
              Minimum level
              <select
                value={draft.requiredSkillMinProficiency}
                disabled={!draft.requiredSkillId}
                onChange={(event) =>
                  setDraft({ ...draft, requiredSkillMinProficiency: event.target.value })
                }
                className={fieldClass}
              >
                {[1, 2, 3, 4, 5].map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-500">
              Priority
              <select
                value={draft.priority}
                onChange={(event) =>
                  setDraft({ ...draft, priority: event.target.value as ConversationPriority })
                }
                className={fieldClass}
              >
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-500">
              Order
              <input
                type="number"
                min={0}
                max={1000}
                value={draft.sortOrder}
                onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })}
                className={fieldClass}
              />
            </label>
          </div>
          <label className="text-xs font-medium text-slate-500">
            Keywords and phrases, one per line (add &quot;| 3&quot; to weight a line 1-5)
            <textarea
              rows={5}
              value={draft.keywords}
              onChange={(event) => setDraft({ ...draft, keywords: event.target.value })}
              placeholder={'register\nnew company | 3\nincorporate'}
              className={fieldClass}
            />
          </label>
          <label className="text-xs font-medium text-slate-500">
            Example messages, one per line
            <textarea
              rows={5}
              value={draft.examples}
              onChange={(event) => setDraft({ ...draft, examples: event.target.value })}
              placeholder="I want to start a private company"
              className={fieldClass}
            />
          </label>
          <label className="text-xs font-medium text-slate-500">
            Words that rule this topic out, one per line
            <textarea
              rows={3}
              value={draft.negativeKeywords}
              onChange={(event) => setDraft({ ...draft, negativeKeywords: event.target.value })}
              placeholder="deregister"
              className={fieldClass}
            />
          </label>
          <label className="text-xs font-medium text-slate-500">
            Description (staff only)
            <textarea
              rows={3}
              maxLength={500}
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              className={fieldClass}
            />
          </label>
          <div className="flex flex-wrap items-center gap-5 md:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-[#155f43]"
                checked={draft.showAsQuickReply}
                onChange={(event) => setDraft({ ...draft, showAsQuickReply: event.target.checked })}
              />
              Show as a button in the chat widget
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-[#155f43]"
                checked={draft.isDefault}
                onChange={(event) => setDraft({ ...draft, isDefault: event.target.checked })}
              />
              Default topic (&quot;Something else&quot; and unanswered prompts)
            </label>
          </div>
          <div className="flex gap-2 md:col-span-2">
            <Button className="h-10 gap-1.5 px-4" disabled={busy || draft.name.trim().length < 2}>
              <Plus size={15} /> {draft.id ? 'Save topic' : 'Add topic'}
            </Button>
            {draft.id ? (
              <Button
                type="button"
                variant="ghost"
                className="h-10 px-4"
                onClick={() => setDraft(EMPTY_DRAFT)}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-3xl border border-line bg-white p-6">
          <div className="flex items-center gap-3">
            <FlaskConical className="text-moss" />
            <div>
              <h3 className="font-semibold">Test a message</h3>
              <p className="text-sm text-slate-500">
                See how a visitor&apos;s message would route.
              </p>
            </div>
          </div>
          <textarea
            rows={3}
            value={testMessage}
            onChange={(event) => setTestMessage(event.target.value)}
            placeholder="I need to register a new company"
            className={`${fieldClass} mt-4`}
          />
          <Button
            className="mt-3 h-10 px-4"
            disabled={busy || !testMessage.trim()}
            onClick={() => void test()}
          >
            Test
          </Button>
          {testResult ? (
            <div className="mt-4 rounded-2xl bg-cream p-4 text-sm">
              <p className="font-medium">{DECISIONS[testResult.decision]}</p>
              <p className="text-slate-600">
                {testResult.topic ? `Best match: ${testResult.topic.name}` : 'No topic matched'} ·
                confidence {Math.round(testResult.confidence * 100)}%
              </p>
              {testResult.candidates.length > 1 ? (
                <ul className="mt-2 text-xs text-slate-500">
                  {testResult.candidates.map((candidate) => (
                    <li key={candidate.topicId}>
                      {candidate.name}: score {candidate.score}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>
        {settings ? (
          <section className="rounded-3xl border border-line bg-white p-6">
            <h3 className="font-semibold">Matching settings</h3>
            <p className="text-sm text-slate-500">
              Confidence at or above the first value routes straight away; between the two, the
              visitor may change the topic; below the second, the visitor is asked.
            </p>
            <form
              key={`${settings.autoRouteThreshold}-${settings.confirmThreshold}-${settings.topicPromptTimeoutSeconds}`}
              className="mt-4 grid gap-3 sm:grid-cols-3"
              onSubmit={(event) => {
                event.preventDefault();
                void saveThresholds(event.currentTarget);
              }}
            >
              <label className="text-xs font-medium text-slate-500">
                Route at (0.1-0.95)
                <input
                  name="autoRouteThreshold"
                  type="number"
                  step="0.05"
                  min={0.1}
                  max={0.95}
                  defaultValue={settings.autoRouteThreshold}
                  className={fieldClass}
                />
              </label>
              <label className="text-xs font-medium text-slate-500">
                Ask below (0.05-0.9)
                <input
                  name="confirmThreshold"
                  type="number"
                  step="0.05"
                  min={0.05}
                  max={0.9}
                  defaultValue={settings.confirmThreshold}
                  className={fieldClass}
                />
              </label>
              <label className="text-xs font-medium text-slate-500">
                Seconds to answer (15-600)
                <input
                  name="topicPromptTimeoutSeconds"
                  type="number"
                  min={15}
                  max={600}
                  defaultValue={settings.topicPromptTimeoutSeconds}
                  className={fieldClass}
                />
              </label>
              <div className="sm:col-span-3">
                <Button className="h-10 px-4" disabled={busy}>
                  Save matching settings
                </Button>
              </div>
            </form>
          </section>
        ) : null}
      </div>
    </div>
  );
}

const DECISIONS: Record<TopicTestResponse['decision'], string> = {
  ROUTE: 'Routes straight away',
  CONFIRM: 'Routes, and the visitor may change the topic',
  ASK: 'Asks the visitor to choose a topic',
};

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** "phrase" or "phrase | 3" per line. */
export function parseKeywords(value: string): TopicKeyword[] {
  return lines(value).map((line) => {
    const [phrase = '', weight] = line.split('|').map((part) => part.trim());
    const parsed = Number(weight);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5
      ? { phrase, weight: parsed }
      : { phrase };
  });
}

function draftFrom(topic: TopicResponse): TopicDraft {
  return {
    id: topic.id,
    name: topic.name,
    description: topic.description ?? '',
    departmentId: topic.departmentId ?? '',
    requiredSkillId: topic.requiredSkillId ?? '',
    requiredSkillMinProficiency: String(topic.requiredSkillMinProficiency ?? 1),
    priority: topic.priority,
    keywords: topic.keywords
      .map(({ phrase, weight }) => (weight ? `${phrase} | ${weight}` : phrase))
      .join('\n'),
    negativeKeywords: topic.negativeKeywords.join('\n'),
    examples: topic.examples.join('\n'),
    showAsQuickReply: topic.showAsQuickReply,
    isDefault: topic.isDefault,
    sortOrder: String(topic.sortOrder),
  };
}

function merge(topics: TopicResponse[], saved: TopicResponse): TopicResponse[] {
  return topics.some((topic) => topic.id === saved.id)
    ? topics.map((topic) => (topic.id === saved.id ? saved : topic))
    : [...topics, saved];
}

function message(value: unknown): string {
  return value instanceof Error ? value.message : 'The request could not be completed';
}
