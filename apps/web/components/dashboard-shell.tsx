'use client';

import { Building2 } from 'lucide-react';
import { Card } from './ui/card';
import { DashboardFrame } from './dashboard-frame';

export function DashboardShell() {
  return (
    <DashboardFrame
      eyebrow="Operations"
      title="Your communication workspace is ready."
      description="Monitor conversations, consultants, and websites from one place. Open a section to get started."
    >
      <section className="grid gap-4 md:grid-cols-3">
        <Metric label="Conversations" value="Open" note="Browse and manage every conversation" />
        <Metric label="Consultants" value="Manage" note="Set capacity and routing preferences" />
        <Metric label="Verified websites" value="Manage" note="Open Websites in the navigation" />
      </section>
      <Card className="mt-6 overflow-hidden shadow-none">
        <div className="flex items-center justify-between border-b border-line p-6">
          <div>
            <h3 className="font-semibold">Platform checklist</h3>
            <p className="mt-1 text-sm text-slate-500">
              Security controls already protecting this workspace.
            </p>
          </div>
          <Building2 className="text-moss" />
        </div>
        <div className="grid gap-px bg-line sm:grid-cols-2">
          {[
            'Tenant context comes from the server session',
            'Domains require explicit ownership verification',
            'Visitor identity uses opaque browser tokens',
            'Widget sockets use short-lived origin-bound sessions',
          ].map((item) => (
            <div key={item} className="flex items-center gap-3 bg-white p-5 text-sm">
              <span className="size-2 rounded-full bg-moss" />
              {item}
            </div>
          ))}
        </div>
      </Card>
    </DashboardFrame>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Card className="p-6 shadow-none">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-4 text-4xl font-bold tracking-tight">{value}</p>
      <p className="mt-2 text-xs text-slate-400">{note}</p>
    </Card>
  );
}
