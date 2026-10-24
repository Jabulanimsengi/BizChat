import { DashboardFrame } from '../../../components/dashboard-frame';
import { FormManager } from '../../../components/form-manager';
import { RoutingManager } from '../../../components/routing-manager';
import { TopicManager } from '../../../components/topic-manager';

export default function RoutingPage() {
  return (
    <DashboardFrame
      eyebrow="Routing structure"
      title="Routing"
      description="Define what visitors ask about, the skills conversations need, and how available consultants are picked."
    >
      <div className="space-y-6">
        <TopicManager />
        <FormManager />
        <RoutingManager />
      </div>
    </DashboardFrame>
  );
}
