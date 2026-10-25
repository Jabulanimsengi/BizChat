import type { ConversationResponse } from '@bizchat/types';
import { PhoneForwarded } from 'lucide-react';

/** Contact details a visitor left instead of waiting; shown so a consultant can get back to them. */
export function FollowUpDetails({ conversation }: { conversation: ConversationResponse }) {
  const contact = conversation.followUpContact;
  if (!conversation.followUpRequestedAt || !contact) return null;
  const rows = [
    ['Name', contact.name],
    ['Email', contact.email],
    ['Phone', contact.phone],
    ['Note', contact.note],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  return (
    <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-center gap-2">
        <PhoneForwarded size={16} className="text-amber-700" />
        <p className="text-sm font-semibold text-amber-900">Follow-up requested</p>
      </div>
      <p className="mt-1 text-xs text-amber-800">
        The visitor chose not to wait.{' '}
        {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(conversation.followUpRequestedAt),
        )}
      </p>
      <dl className="mt-3 grid gap-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-amber-700">{label}</dt>
            <dd className="mt-0.5 break-words font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Short flags for the inbox list: a follow-up request, or a chat that overflowed. */
export function waitFlags(conversation: ConversationResponse): string[] {
  const flags: string[] = [];
  if (conversation.followUpRequestedAt) flags.push('Follow-up');
  if (conversation.overflowLevel > 0 && conversation.status === 'QUEUED') flags.push('Overflow');
  return flags;
}
