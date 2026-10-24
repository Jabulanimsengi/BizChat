import { DashboardFrame } from '../../../components/dashboard-frame';
import { RoutingManager } from '../../../components/routing-manager';

export default function RoutingPage() {
  return (
    <DashboardFrame
      eyebrow="Routing structure"
      title="Routing"
      description="Define the skills conversations can require and choose how available consultants are picked."
    >
      <RoutingManager />
    </DashboardFrame>
  );
}
