import { DepartmentManager } from '../../../components/department-manager';
import { DashboardFrame } from '../../../components/dashboard-frame';

export default function DepartmentsPage() {
  return (
    <DashboardFrame
      eyebrow="Routing structure"
      title="Departments"
      description="Organize consultants into routing groups, control the visitor department picker, and monitor live queue pressure."
    >
      <DepartmentManager />
    </DashboardFrame>
  );
}
