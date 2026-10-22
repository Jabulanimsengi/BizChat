import { DashboardFrame } from '../../../components/dashboard-frame';
import { IntegrationsManager } from '../../../components/integrations-manager';
export default function IntegrationsPage() {
  return (
    <DashboardFrame
      eyebrow="Developer tools"
      title="Integrations"
      description="Connect your website backend to BizChat and receive chat events."
    >
      <IntegrationsManager />
    </DashboardFrame>
  );
}
