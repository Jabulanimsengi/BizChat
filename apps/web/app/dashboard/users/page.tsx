import { DashboardFrame } from '../../../components/dashboard-frame';
import { UsersManager } from '../../../components/users-manager';

export default function UsersPage() {
  return (
    <DashboardFrame
      eyebrow="Administration"
      title="Users and access"
      description="Create business accounts, assign roles and departments, tune routing capacity, and revoke access immediately."
    >
      <UsersManager />
    </DashboardFrame>
  );
}
