import { DashboardFrame } from '../../../components/dashboard-frame';
import { PlatformManager } from '../../../components/platform-manager';

export default function PlatformPage() {
  return (
    <DashboardFrame
      eyebrow="Platform"
      title="Plans and tenants"
      description="Set the limits each plan allows, assign plans to businesses, and suspend or restore them."
    >
      <PlatformManager />
    </DashboardFrame>
  );
}
