import { ConversationToolsManager } from '../../../components/conversation-tools-manager';
import { DashboardFrame } from '../../../components/dashboard-frame';

export default function ConversationToolsPage() {
  return (
    <DashboardFrame
      eyebrow="Team productivity"
      title="Conversation tools"
      description="Manage tenant-scoped tags and reusable responses that consultants can insert from the live inbox."
    >
      <ConversationToolsManager />
    </DashboardFrame>
  );
}
