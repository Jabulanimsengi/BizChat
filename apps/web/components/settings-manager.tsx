'use client';

import type {
  AuthenticatedBusiness,
  BusinessHoursResponse,
  WidgetSettingsResponse,
} from '@bizchat/types';
import { Clock3, LoaderCircle, MessageCircleMore, Save, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function SettingsManager() {
  const [business, setBusiness] = useState<AuthenticatedBusiness>();
  const [widget, setWidget] = useState<WidgetSettingsResponse>();
  const [hours, setHours] = useState<BusinessHoursResponse>();
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    void Promise.all([
      apiRequest<AuthenticatedBusiness>('/business'),
      apiRequest<WidgetSettingsResponse>('/widget-settings'),
      apiRequest<BusinessHoursResponse>('/business-hours'),
    ])
      .then(([businessResult, widgetResult, hoursResult]) => {
        setBusiness(businessResult);
        setWidget(widgetResult);
        setHours(hoursResult);
      })
      .catch((cause: unknown) => setNotice(messageOf(cause)));
  }, []);

  async function saveBusiness(): Promise<void> {
    if (!business) return;
    setBusy('business');
    setNotice(undefined);
    try {
      setBusiness(
        await apiRequest<AuthenticatedBusiness>('/business', {
          method: 'PATCH',
          body: JSON.stringify({
            name: business.name,
            timezone: business.timezone,
            defaultLocale: business.defaultLocale,
          }),
        }),
      );
      setNotice('Business settings saved.');
    } catch (cause) {
      setNotice(messageOf(cause));
    } finally {
      setBusy(undefined);
    }
  }
  async function saveWidget(): Promise<void> {
    if (!widget) return;
    setBusy('widget');
    setNotice(undefined);
    try {
      setWidget(
        await apiRequest<WidgetSettingsResponse>('/widget-settings', {
          method: 'PATCH',
          body: JSON.stringify({
            displayName: widget.businessName,
            primaryColor: widget.primaryColor,
            greeting: widget.greeting,
            launcherPosition: widget.launcherPosition,
            enabled: widget.enabled,
            departmentSelectionEnabled: widget.departmentSelectionEnabled,
            preferPreviousConsultant: widget.preferPreviousConsultant,
            queueMessage: widget.queueMessage,
            offlineMessage: widget.offlineMessage,
            resolvedMessage: widget.resolvedMessage,
            reopenWindowMinutes: widget.reopenWindowMinutes,
            agentDisconnectGraceSeconds: widget.agentDisconnectGraceSeconds,
          }),
        }),
      );
      setNotice('Widget settings saved.');
    } catch (cause) {
      setNotice(messageOf(cause));
    } finally {
      setBusy(undefined);
    }
  }
  async function saveHours(): Promise<void> {
    if (!hours) return;
    setBusy('hours');
    setNotice(undefined);
    try {
      setHours(
        await apiRequest<BusinessHoursResponse>('/business-hours', {
          method: 'PUT',
          body: JSON.stringify({ hours: hours.hours }),
        }),
      );
      setNotice('Business hours saved.');
    } catch (cause) {
      setNotice(messageOf(cause));
    } finally {
      setBusy(undefined);
    }
  }

  if (!business || !widget || !hours)
    return (
      <Card className="grid min-h-64 place-items-center shadow-none">
        {notice ? (
          <p className="text-sm text-red-700">{notice}</p>
        ) : (
          <LoaderCircle className="animate-spin text-moss" />
        )}
      </Card>
    );
  return (
    <div className="space-y-6">
      {notice ? (
        <p className="rounded-2xl border border-line bg-white px-4 py-3 text-sm text-moss">
          {notice}
        </p>
      ) : null}
      <Card className="p-6 shadow-none">
        <div className="flex items-center gap-3">
          <SlidersHorizontal className="text-moss" />
          <div>
            <h3 className="font-semibold">Business profile</h3>
            <p className="text-sm text-slate-500">
              Identity, locale, and the IANA timezone used throughout BizChat.
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <Field label="Business name">
            <Input
              value={business.name}
              onChange={(event) => setBusiness({ ...business, name: event.target.value })}
            />
          </Field>
          <Field label="Timezone">
            <Input
              value={business.timezone}
              onChange={(event) => setBusiness({ ...business, timezone: event.target.value })}
              placeholder="Africa/Johannesburg"
            />
          </Field>
          <Field label="Default locale">
            <Input
              value={business.defaultLocale}
              onChange={(event) => setBusiness({ ...business, defaultLocale: event.target.value })}
              placeholder="en-ZA"
            />
          </Field>
        </div>
        <Button
          className="mt-5 gap-2"
          onClick={() => void saveBusiness()}
          disabled={busy === 'business'}
        >
          <Save size={16} /> Save business profile
        </Button>
      </Card>
      <Card className="p-6 shadow-none">
        <div className="flex items-center gap-3">
          <MessageCircleMore className="text-moss" />
          <div>
            <h3 className="font-semibold">Widget experience</h3>
            <p className="text-sm text-slate-500">
              Control presentation, lifecycle messages, and routing behavior.
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Field label="Display name">
            <Input
              value={widget.businessName}
              onChange={(event) => setWidget({ ...widget, businessName: event.target.value })}
            />
          </Field>
          <Field label="Brand color">
            <div className="flex gap-3">
              <Input
                className="w-20 p-1"
                type="color"
                value={widget.primaryColor}
                onChange={(event) => setWidget({ ...widget, primaryColor: event.target.value })}
              />
              <Input
                value={widget.primaryColor}
                onChange={(event) => setWidget({ ...widget, primaryColor: event.target.value })}
              />
            </div>
          </Field>
          <MessageField
            label="Online greeting"
            value={widget.greeting}
            onChange={(value) => setWidget({ ...widget, greeting: value })}
          />
          <MessageField
            label="Queue message"
            value={widget.queueMessage}
            onChange={(value) => setWidget({ ...widget, queueMessage: value })}
          />
          <MessageField
            label="Offline message"
            value={widget.offlineMessage}
            onChange={(value) => setWidget({ ...widget, offlineMessage: value })}
          />
          <MessageField
            label="Resolved message"
            value={widget.resolvedMessage}
            onChange={(value) => setWidget({ ...widget, resolvedMessage: value })}
          />
          <Field label="Launcher position">
            <select
              className="h-11 w-full rounded-xl border border-line bg-white px-3 text-sm"
              value={widget.launcherPosition}
              onChange={(event) =>
                setWidget({
                  ...widget,
                  launcherPosition: event.target
                    .value as WidgetSettingsResponse['launcherPosition'],
                })
              }
            >
              <option value="BOTTOM_RIGHT">Bottom right</option>
              <option value="BOTTOM_LEFT">Bottom left</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Reopen minutes">
              <Input
                type="number"
                min={1}
                max={43200}
                value={widget.reopenWindowMinutes}
                onChange={(event) =>
                  setWidget({ ...widget, reopenWindowMinutes: Number(event.target.value) })
                }
              />
            </Field>
            <Field label="Disconnect grace">
              <Input
                type="number"
                min={1}
                max={900}
                value={widget.agentDisconnectGraceSeconds}
                onChange={(event) =>
                  setWidget({ ...widget, agentDisconnectGraceSeconds: Number(event.target.value) })
                }
              />
            </Field>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <Toggle
            label="Widget enabled"
            checked={widget.enabled}
            onChange={(value) => setWidget({ ...widget, enabled: value })}
          />
          <Toggle
            label="Department picker"
            checked={widget.departmentSelectionEnabled}
            onChange={(value) => setWidget({ ...widget, departmentSelectionEnabled: value })}
          />
          <Toggle
            label="Prefer previous consultant"
            checked={widget.preferPreviousConsultant}
            onChange={(value) => setWidget({ ...widget, preferPreviousConsultant: value })}
          />
        </div>
        <Button
          className="mt-5 gap-2"
          onClick={() => void saveWidget()}
          disabled={busy === 'widget'}
        >
          <Save size={16} /> Save widget experience
        </Button>
      </Card>
      <Card className="p-6 shadow-none">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Clock3 className="text-moss" />
            <div>
              <h3 className="font-semibold">Business hours</h3>
              <p className="text-sm text-slate-500">
                Evaluated in {business.timezone}. Overnight schedules are supported.
              </p>
            </div>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${hours.isOpenNow ? 'bg-mint text-moss' : 'bg-slate-100 text-slate-500'}`}
          >
            {hours.isOpenNow ? 'Open now' : 'Closed now'}
          </span>
        </div>
        <div className="mt-5 divide-y divide-line">
          {hours.hours.map((hour, index) => (
            <div
              key={hour.weekday}
              className="grid items-center gap-3 py-3 sm:grid-cols-[140px_1fr_1fr_110px]"
            >
              <span className="text-sm font-medium">{WEEKDAYS[hour.weekday]}</span>
              <Input
                aria-label={`${WEEKDAYS[hour.weekday]} opening time`}
                type="time"
                value={hour.openingTime}
                disabled={hour.isClosed}
                onChange={(event) =>
                  setHours({
                    ...hours,
                    hours: hours.hours.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, openingTime: event.target.value } : item,
                    ),
                  })
                }
              />
              <Input
                aria-label={`${WEEKDAYS[hour.weekday]} closing time`}
                type="time"
                value={hour.closingTime}
                disabled={hour.isClosed}
                onChange={(event) =>
                  setHours({
                    ...hours,
                    hours: hours.hours.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, closingTime: event.target.value } : item,
                    ),
                  })
                }
              />
              <Toggle
                compact
                label="Closed"
                checked={hour.isClosed}
                onChange={(value) =>
                  setHours({
                    ...hours,
                    hours: hours.hours.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, isClosed: value } : item,
                    ),
                  })
                }
              />
            </div>
          ))}
        </div>
        <Button className="mt-5 gap-2" onClick={() => void saveHours()} disabled={busy === 'hours'}>
          <Save size={16} /> Save business hours
        </Button>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
function MessageField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <textarea
        className="min-h-20 w-full rounded-xl border border-line p-3 text-sm outline-none focus:border-moss"
        maxLength={240}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}
function Toggle({
  label,
  checked,
  onChange,
  compact = false,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  compact?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-sm ${compact ? '' : 'rounded-xl border border-line p-3'}`}
    >
      <input
        type="checkbox"
        className="size-4 accent-[#155f43]"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}
function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : 'The request could not be completed';
}
