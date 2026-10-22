import { AgentProfileManager } from '../../../components/agent-profile-manager';
import { DashboardFrame } from '../../../components/dashboard-frame';

export default function ConsultantsPage() {
  return (
    <DashboardFrame
      eyebrow="Consultant operations"
      title="Consultant profile"
      description="Configure durable capacity and routing preferences. Live availability is controlled from the conversation inbox."
    >
      <AgentProfileManager />
    </DashboardFrame>
  );
}
