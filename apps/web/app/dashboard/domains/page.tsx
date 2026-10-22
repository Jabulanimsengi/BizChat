import { DashboardFrame } from '../../../components/dashboard-frame';
import { DomainsManager } from '../../../components/domains-manager';

export default function DomainsPage() {
  return (
    <DashboardFrame
      eyebrow="Widget foundation"
      title="Websites and widget"
      description="Verify each hostname that is allowed to initialize your public widget, then copy its safe public embed code."
    >
      <DomainsManager />
    </DashboardFrame>
  );
}
