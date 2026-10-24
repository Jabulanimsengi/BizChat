'use client';

import type { ConversationOfferEvent } from '@bizchat/types';
import { BellRing } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from './ui/button';

/** Chats offered to this consultant, each with a live countdown to its expiry. */
export function OfferTray({
  offers,
  busyOfferId,
  onAccept,
  onDecline,
}: {
  offers: ConversationOfferEvent[];
  busyOfferId: string | undefined;
  onAccept: (offer: ConversationOfferEvent) => void;
  onDecline: (offer: ConversationOfferEvent) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (offers.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [offers.length]);

  const live = offers.filter((offer) => new Date(offer.expiresAt).getTime() > now);
  if (live.length === 0) return null;
  return (
    <div className="space-y-2 border-b border-line bg-amber-50/60 p-3" aria-live="assertive">
      {live.map((offer) => {
        const total = new Date(offer.expiresAt).getTime() - new Date(offer.offeredAt).getTime();
        const remaining = Math.max(0, new Date(offer.expiresAt).getTime() - now);
        const busy = busyOfferId === offer.offerId;
        return (
          <article
            key={offer.offerId}
            className="rounded-2xl border border-amber-200 bg-white p-3 shadow-sm"
            aria-label="New chat offer"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <BellRing size={15} className="text-amber-600" /> New chat
                {offer.conversation.departmentName ? (
                  <span className="text-xs font-normal text-slate-500">
                    · {offer.conversation.departmentName}
                  </span>
                ) : null}
              </span>
              <span className="text-xs font-semibold tabular-nums text-amber-700">
                {Math.ceil(remaining / 1_000)}s
              </span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-amber-100">
              <div
                className="h-full bg-amber-500 transition-[width] duration-500 ease-linear"
                style={{ width: `${total > 0 ? (remaining / total) * 100 : 0}%` }}
              />
            </div>
            {offer.firstMessage ? (
              <p className="mt-2 line-clamp-2 text-sm text-slate-600">“{offer.firstMessage}”</p>
            ) : null}
            <div className="mt-3 flex gap-2">
              <Button
                className="h-9 flex-1 text-xs"
                disabled={busy}
                onClick={() => onAccept(offer)}
              >
                Accept
              </Button>
              <Button
                variant="ghost"
                className="h-9 flex-1 text-xs"
                disabled={busy}
                onClick={() => onDecline(offer)}
              >
                Decline
              </Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
