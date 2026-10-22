import { AuditLogManager } from '../../../components/audit-log-manager';
import { DashboardFrame } from '../../../components/dashboard-frame';

export default function AuditLogsPage() {
  return (
    <DashboardFrame
      eyebrow="Administration"
      title="Audit logs"
      description="Review tenant-scoped administrative changes, actors, request identifiers, and supporting metadata."
    >
      <AuditLogManager />
    </DashboardFrame>
  );
}
