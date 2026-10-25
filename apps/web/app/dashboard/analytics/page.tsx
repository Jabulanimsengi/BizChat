import { AnalyticsDashboard } from '../../../components/analytics-dashboard';
import { DashboardFrame } from '../../../components/dashboard-frame';

export default function AnalyticsPage() {
  return (
    <DashboardFrame
      eyebrow="Reporting"
      title="Analytics"
      description="How quickly visitors reach a consultant, how chats end, and how each consultant is doing."
    >
      <AnalyticsDashboard />
    </DashboardFrame>
  );
}
