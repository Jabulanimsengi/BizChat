'use client';

import type {
  AnalyticsBreakdownRow,
  AnalyticsDuration,
  AnalyticsOverviewResponse,
  ConsultantAnalyticsRow,
  DepartmentResponse,
  TopicResponse,
} from '@bizchat/types';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';

/** Passes the chart palette checks (lightness band, chroma floor, 3:1 against the card). */
const BAR_COLOR = '#1f8a5f';
const fieldClass =
  'mt-1 rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-moss';

/** "45 s", "3 min", "1 h 20 min"; a dash when nothing reached that point. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}

export function formatRate(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';
}

/** Local YYYY-MM-DD for today minus `days`. */
export function localDate(days = 0, now = new Date()): string {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

export function AnalyticsDashboard() {
  const [range, setRange] = useState(() => ({ from: localDate(6), to: localDate(0) }));
  const [departmentId, setDepartmentId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [departments, setDepartments] = useState<DepartmentResponse[]>([]);
  const [topics, setTopics] = useState<TopicResponse[]>([]);
  const [overview, setOverview] = useState<AnalyticsOverviewResponse>();
  const [consultants, setConsultants] = useState<ConsultantAnalyticsRow[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void apiRequest<DepartmentResponse[]>('/departments')
      .then(setDepartments)
      .catch(() => undefined);
    // Supervisors may not manage topics; the filter is then simply not offered.
    void apiRequest<TopicResponse[]>('/topics')
      .then(setTopics)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ from: range.from, to: range.to });
    if (departmentId) query.set('departmentId', departmentId);
    if (topicId) query.set('topicId', topicId);
    void Promise.all([
      apiRequest<AnalyticsOverviewResponse>(`/analytics/overview?${query}`),
      apiRequest<ConsultantAnalyticsRow[]>(`/analytics/consultants?${query}`),
    ])
      .then(([nextOverview, nextConsultants]) => {
        if (!active) return;
        setOverview(nextOverview);
        setConsultants(nextConsultants);
        setError(undefined);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Analytics are unavailable');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [range, departmentId, topicId]);

  const totals = overview?.totals;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-white p-4">
        <label className="text-xs font-medium text-slate-500">
          From
          <input
            type="date"
            value={range.from}
            max={range.to}
            onChange={(event) => {
              setLoading(true);
              setRange({ ...range, from: event.target.value });
            }}
            className={`${fieldClass} block`}
          />
        </label>
        <label className="text-xs font-medium text-slate-500">
          To
          <input
            type="date"
            value={range.to}
            min={range.from}
            onChange={(event) => {
              setLoading(true);
              setRange({ ...range, to: event.target.value });
            }}
            className={`${fieldClass} block`}
          />
        </label>
        <div className="flex gap-1.5 pb-0.5">
          {[7, 30, 90].map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => {
                setLoading(true);
                setRange({ from: localDate(days - 1), to: localDate(0) });
              }}
              className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-moss hover:border-moss"
            >
              {days} days
            </button>
          ))}
        </div>
        <label className="text-xs font-medium text-slate-500">
          Department
          <select
            value={departmentId}
            onChange={(event) => {
              setLoading(true);
              setDepartmentId(event.target.value);
            }}
            className={`${fieldClass} block`}
          >
            <option value="">All departments</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        {topics.length ? (
          <label className="text-xs font-medium text-slate-500">
            Topic
            <select
              value={topicId}
              onChange={(event) => {
                setLoading(true);
                setTopicId(event.target.value);
              }}
              className={`${fieldClass} block`}
            >
              <option value="">All topics</option>
              {topics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {loading ? <LoaderCircle size={18} className="mb-2 animate-spin text-moss" /> : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {overview && totals ? (
        <>
          <p className="text-xs text-slate-500">
            Conversations started {overview.from} to {overview.to}, in {overview.timezone} time.
          </p>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Conversations" value={String(totals.conversations)} />
            <Stat
              label="Reached a consultant"
              value={formatRate(totals.assigned, totals.conversations)}
              detail={`${totals.assigned} chats`}
            />
            <Stat
              label="Abandoned in the queue"
              value={formatRate(totals.abandoned, totals.conversations)}
              detail={`${totals.abandoned} chats`}
            />
            <Stat
              label="Follow-ups requested"
              value={String(totals.followUps)}
              detail={`${totals.overflowed} overflowed`}
            />
            <DurationStat label="Wait for a consultant" value={overview.waitToAssignment} />
            <DurationStat label="First response" value={overview.firstResponse} />
            <DurationStat label="Handle time" value={overview.handleTime} />
            <Stat
              label="Offers accepted"
              value={
                overview.offers.acceptRate === null
                  ? '—'
                  : `${Math.round(overview.offers.acceptRate * 100)}%`
              }
              detail={`${overview.offers.accepted} of ${overview.offers.offered} offers · ${overview.offers.expired} missed`}
            />
          </section>

          <DailyChart daily={overview.daily} />

          <section className="grid gap-6 lg:grid-cols-2">
            <Breakdown title="By topic" rows={overview.byTopic} />
            <Breakdown title="By department" rows={overview.byDepartment} />
            <Panel title="Topic matching">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Figure label="Matched by keywords" value={overview.classification.classified} />
                <Figure label="Routed automatically" value={overview.classification.autoRouted} />
                <Figure
                  label="Confirmed with the visitor"
                  value={overview.classification.confirmed}
                />
                <Figure label="Visitor asked to choose" value={overview.classification.asked} />
                <Figure
                  label="Fell back to the default"
                  value={overview.classification.defaulted}
                />
                <Figure
                  label="Visitor changed the topic"
                  value={overview.classification.changedByVisitor}
                  detail={formatRate(
                    overview.classification.changedByVisitor,
                    overview.classification.autoRouted + overview.classification.confirmed,
                  )}
                />
              </dl>
            </Panel>
            <Panel title="By channel">
              <table className="w-full text-sm">
                <tbody>
                  {overview.bySource.map((row) => (
                    <tr key={row.source} className="border-t border-line first:border-0">
                      <td className="py-2 capitalize">
                        {row.source.toLowerCase().replace('_', ' ')}
                      </td>
                      <td className="py-2 text-right tabular-nums">{row.conversations}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {overview.bySource.length === 0 ? <Empty /> : null}
            </Panel>
          </section>

          <Panel title="Consultants">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="py-2 font-medium">Consultant</th>
                    <th className="py-2 text-right font-medium">Chats</th>
                    <th className="py-2 text-right font-medium">Resolved</th>
                    <th className="py-2 text-right font-medium">Median first response</th>
                    <th className="py-2 text-right font-medium">Offers accepted</th>
                    <th className="py-2 text-right font-medium">Missed</th>
                  </tr>
                </thead>
                <tbody>
                  {consultants.map((row) => (
                    <tr key={row.agentProfileId} className="border-t border-line">
                      <td className="py-2">{row.displayName}</td>
                      <td className="py-2 text-right tabular-nums">{row.assigned}</td>
                      <td className="py-2 text-right tabular-nums">{row.resolved}</td>
                      <td className="py-2 text-right tabular-nums">
                        {formatDuration(row.firstResponse.medianSeconds)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {row.offers.offered
                          ? `${row.offers.accepted} of ${row.offers.offered}`
                          : '—'}
                      </td>
                      <td className="py-2 text-right tabular-nums">{row.offers.expired}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      ) : null}
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums text-ink">{value}</p>
      {detail ? <p className="mt-1 text-xs text-slate-400">{detail}</p> : null}
    </div>
  );
}

function DurationStat({ label, value }: { label: string; value: AnalyticsDuration }) {
  return (
    <Stat
      label={`${label} (median)`}
      value={formatDuration(value.medianSeconds)}
      detail={
        value.count
          ? `90% within ${formatDuration(value.p90Seconds)} · ${value.count} chats`
          : 'No chats reached this yet'
      }
    />
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Figure({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums">
        {value}
        {detail ? <span className="ml-1 text-xs font-normal text-slate-400">{detail}</span> : null}
      </dd>
    </div>
  );
}

function Empty() {
  return <p className="text-sm text-slate-400">No conversations in this range.</p>;
}

function Breakdown({ title, rows }: { title: string; rows: AnalyticsBreakdownRow[] }) {
  return (
    <Panel title={title}>
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 text-right font-medium">Chats</th>
              <th className="py-2 text-right font-medium">Median wait</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id ?? 'none'} className="border-t border-line">
                <td className="py-2">{row.name}</td>
                <td className="py-2 text-right tabular-nums">{row.conversations}</td>
                <td className="py-2 text-right tabular-nums">
                  {formatDuration(row.medianWaitSeconds)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/**
 * Conversations started per day: one series, so the title names it and there is no legend. Each bar
 * has a hover and focus tooltip, and the same figures are available as a table.
 */
function DailyChart({ daily }: { daily: AnalyticsOverviewResponse['daily'] }) {
  const [hovered, setHovered] = useState<number>();
  const [asTable, setAsTable] = useState(false);
  const peak = Math.max(1, ...daily.map((day) => day.created));
  const height = 160;
  const label = (date: string): string =>
    new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
      new Date(`${date}T00:00:00Z`),
    );
  const point = hovered === undefined ? undefined : daily[hovered];
  return (
    <Panel title="Conversations started per day">
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={() => setAsTable(!asTable)}
          className="text-xs font-medium text-moss"
        >
          {asTable ? 'Show chart' : 'Show as table'}
        </button>
      </div>
      {asTable ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 text-right font-medium">Started</th>
              <th className="py-1 text-right font-medium">Resolved</th>
              <th className="py-1 text-right font-medium">Abandoned</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((day) => (
              <tr key={day.date} className="border-t border-line">
                <td className="py-1">{label(day.date)}</td>
                <td className="py-1 text-right tabular-nums">{day.created}</td>
                <td className="py-1 text-right tabular-nums">{day.resolved}</td>
                <td className="py-1 text-right tabular-nums">{day.abandoned}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <div className="flex items-end gap-[2px] border-b border-slate-200" style={{ height }}>
            {daily.map((day, index) => (
              <button
                key={day.date}
                type="button"
                aria-label={`${label(day.date)}: ${day.created} started, ${day.resolved} resolved, ${day.abandoned} abandoned`}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(undefined)}
                onFocus={() => setHovered(index)}
                onBlur={() => setHovered(undefined)}
                // The hit target is the full column; only the bar inside it is drawn.
                className="flex h-full min-w-0 flex-1 items-end outline-none focus-visible:bg-slate-50"
              >
                <span
                  className="block w-full rounded-t-[4px]"
                  style={{
                    height: `${(day.created / peak) * 100}%`,
                    minHeight: day.created ? 2 : 0,
                    background: BAR_COLOR,
                    opacity: hovered === undefined || hovered === index ? 1 : 0.55,
                  }}
                />
              </button>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-slate-400">
            <span>{daily[0] ? label(daily[0].date) : ''}</span>
            <span>peak {peak}</span>
            <span>{daily.at(-1) ? label(daily.at(-1)!.date) : ''}</span>
          </div>
          {point ? (
            <div
              role="status"
              className="pointer-events-none absolute top-0 rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs shadow-sm"
              style={{
                left: `${((hovered! + 0.5) / daily.length) * 100}%`,
                transform: 'translateX(-50%)',
              }}
            >
              <p className="font-semibold text-ink">{label(point.date)}</p>
              <p className="text-slate-600">{point.created} started</p>
              <p className="text-slate-500">
                {point.resolved} resolved · {point.abandoned} abandoned
              </p>
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
