import { ConversationManager } from '../../../components/conversation-manager';
import { DashboardFrame } from '../../../components/dashboard-frame';

export default function ConversationsPage() {
  return (
    <DashboardFrame
      eyebrow="Customer conversations"
      title="Conversations"
      description="Review secure widget conversations, load their complete history, and reply without losing an in-progress draft."
    >
      <ConversationManager />
    </DashboardFrame>
  );
}
