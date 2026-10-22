import { MessagesSquare } from 'lucide-react';
import Link from 'next/link';

export function Brand() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-2 text-lg font-bold tracking-tight text-ink"
    >
      <span className="grid size-9 place-items-center rounded-xl bg-ink text-white">
        <MessagesSquare size={18} />
      </span>
      BizChat
    </Link>
  );
}
