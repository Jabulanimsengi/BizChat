import { DashboardFrame } from '../../../components/dashboard-frame';
import { SettingsManager } from '../../../components/settings-manager';

export default function SettingsPage() {
  return (
    <DashboardFrame
      eyebrow="Administration"
      title="Business and widget settings"
      description="Manage tenant identity, visitor messaging, routing behavior, and timezone-aware operating hours."
    >
      <SettingsManager />
    </DashboardFrame>
  );
}
