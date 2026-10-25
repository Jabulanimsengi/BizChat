'use client';

import type {
  AgentConnectedEvent,
  AgentNoticeEvent,
  AgentPresenceEvent,
  AgentPresenceState,
  AgentProfileResponse,
  CannedResponseResponse,
  ConversationOfferEvent,
  ConversationOfferWithdrawnEvent,
  ConversationOperationEvent,
  ConversationPage,
  ConversationRecoveryEvent,
  ConversationResponse,
  ConversationRoutingEvent,
  ConversationSessionResponse,
  DepartmentResponse,
  MessagePage,
  MessageReceiptEvent,
  MessageResponse,
  SocketAck,
  TagResponse,
  TypingEvent,
  VisitorPresenceEvent,
} from '@bizchat/types';
import {
  ArrowRightLeft,
  CheckCircle2,
  ChevronLeft,
  Circle,
  Inbox,
  LoaderCircle,
  LockKeyhole,
  MessageSquareText,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Send,
  StickyNote,
  Tags,
  Users,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_ORIGIN, apiRequest } from '../lib/api';
import { FollowUpDetails, waitFlags } from './follow-up-details';
import { IntakeAnswers } from './intake-answers';
import { OfferTray } from './offer-tray';
import { Button } from './ui/button';

type ReliableMessage = MessageResponse & { pending?: boolean; failed?: boolean };
interface ThreadState {
  conversation: ConversationResponse;
  messages: ReliableMessage[];
  hasEarlier: boolean;
}
type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'error';

export function ConversationManager() {
  const [conversations, setConversations] = useState<ConversationResponse[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [threads, setThreads] = useState<Record<string, ThreadState>>({});
  const [selectedId, setSelectedId] = useState<string>();
  const [profile, setProfile] = useState<AgentConnectedEvent['profile']>();
  const [presence, setPresence] = useState<AgentPresenceState>('OFFLINE');
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [recovery, setRecovery] = useState<Record<string, ConversationRecoveryEvent>>({});
  const [visitorPresence, setVisitorPresence] = useState<Record<string, 'ONLINE' | 'OFFLINE'>>({});
  const [typing, setTyping] = useState<Record<string, TypingEvent>>({});
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const [agents, setAgents] = useState<AgentProfileResponse[]>([]);
  const [departments, setDepartments] = useState<DepartmentResponse[]>([]);
  const [availableTags, setAvailableTags] = useState<TagResponse[]>([]);
  const [cannedResponses, setCannedResponses] = useState<CannedResponseResponse[]>([]);
  const [noteMode, setNoteMode] = useState(false);
  const [operationBusy, setOperationBusy] = useState(false);
  const [transferTarget, setTransferTarget] = useState('');
  const [offers, setOffers] = useState<ConversationOfferEvent[]>([]);
  const [offerBusy, setOfferBusy] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const socketRef = useRef<Socket | undefined>(undefined);
  const selectedRef = useRef<string | undefined>(undefined);
  const profileIdRef = useRef<string | undefined>(undefined);
  const threadsRef = useRef<Record<string, ThreadState>>({});
  const scrollArea = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef<Record<string, number>>({});
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const typingActive = useRef(false);

  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiRequest<AgentProfileResponse[]>('/agent-profile'),
      apiRequest<DepartmentResponse[]>('/departments'),
      apiRequest<TagResponse[]>('/tags'),
      apiRequest<CannedResponseResponse[]>('/canned-responses'),
    ])
      .then(([agentList, departmentList, tagList, cannedList]) => {
        if (active) {
          setAgents(agentList);
          setDepartments(departmentList.filter((item) => item.status === 'ACTIVE'));
          setAvailableTags(tagList);
          setCannedResponses(cannedList);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const loadConversations = useCallback(async (cursor?: string, append = false) => {
    setError(undefined);
    try {
      const page = await apiRequest<ConversationPage>(
        `/conversations?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      setConversations((current) =>
        append ? mergeConversations(current, page.conversations) : page.conversations,
      );
      setNextCursor(page.nextCursor);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const socket = io(`${API_ORIGIN}/agent`, {
      withCredentials: true,
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 10_000,
      randomizationFactor: 0.4,
    });
    socketRef.current = socket;
    void apiRequest<ConversationPage>('/conversations?limit=30')
      .then((page) => {
        if (active) {
          setConversations(page.conversations);
          setNextCursor(page.nextCursor);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const recoverOpenThreads = async (): Promise<void> => {
      for (const [conversationId, currentThread] of Object.entries(threadsRef.current)) {
        let recoveredMessages = currentThread.messages;
        let afterSequence = [...currentThread.messages]
          .reverse()
          .find((message) => !message.pending)?.sequenceNumber;
        for (let page = 0; page < 50; page += 1) {
          const result = await emitAck<ConversationSessionResponse>(
            socket,
            'conversation.subscribe',
            { conversationId, ...(afterSequence ? { afterSequence } : {}) },
          );
          if (!result.ok) {
            setError(result.error.message);
            break;
          }
          recoveredMessages = mergeMessages(recoveredMessages, result.data.history.messages);
          setThreads((current) => {
            const thread = current[conversationId] ?? currentThread;
            return {
              ...current,
              [conversationId]: {
                ...thread,
                conversation: result.data.conversation,
                messages: mergeMessages(thread.messages, recoveredMessages),
              },
            };
          });
          const nextSequence = result.data.history.latestSequence ?? afterSequence;
          if (!result.data.history.hasMore || !nextSequence || nextSequence === afterSequence)
            break;
          afterSequence = nextSequence;
        }
        const latestVisitor = [...recoveredMessages]
          .reverse()
          .find((message) => message.senderType === 'VISITOR' && !message.pending);
        if (latestVisitor)
          void emitAck<MessageReceiptEvent[]>(socket, 'message.read', {
            conversationId,
            throughSequence: latestVisitor.sequenceNumber,
          });
      }
    };
    socket.on('connect', () => setConnectionState('connecting'));
    socket.io.on('reconnect_attempt', () => setConnectionState('reconnecting'));
    socket.on('disconnect', () => setConnectionState('reconnecting'));
    socket.on('connect_error', () => setConnectionState('error'));
    socket.on('agent.connected', (event: AgentConnectedEvent) => {
      profileIdRef.current = event.profile.id;
      setProfile(event.profile);
      setPresence(event.profile.presence);
      setConnectionState('connected');
      void recoverOpenThreads();
    });
    socket.on('agent.error', (event: { message?: string }) => {
      setConnectionState('error');
      setError(event.message ?? 'Live inbox session expired');
    });
    socket.on('agent.presence', (event: AgentPresenceEvent) => {
      if (event.agentProfileId === profileIdRef.current) setPresence(event.state);
    });
    socket.on('agent.notice', (event: AgentNoticeEvent) => setNotice(event.message));
    socket.on('conversation.offered', (offer: ConversationOfferEvent) =>
      setOffers((current) => [
        ...current.filter(({ offerId }) => offerId !== offer.offerId),
        offer,
      ]),
    );
    socket.on('conversation.offer.withdrawn', (event: ConversationOfferWithdrawnEvent) =>
      setOffers((current) => current.filter(({ offerId }) => offerId !== event.offerId)),
    );
    socket.on('conversation.new', (conversation: ConversationResponse) =>
      setConversations((current) => mergeConversations([conversation], current)),
    );
    const routingUpdate = (event: ConversationRoutingEvent): void => {
      setConversations((current) => mergeConversations([event.conversation], current));
      setThreads((current) => {
        const thread = current[event.conversation.id];
        return thread
          ? {
              ...current,
              [event.conversation.id]: {
                ...thread,
                conversation: { ...thread.conversation, ...event.conversation },
              },
            }
          : current;
      });
      if (event.outcome === 'ASSIGNED') void loadConversations();
    };
    socket.on('conversation.routed', routingUpdate);
    socket.on('conversation.assigned', routingUpdate);
    const operationUpdate = (event: ConversationOperationEvent): void => {
      setConversations((current) => mergeConversations([event.conversation], current));
      setThreads((current) => {
        const thread = current[event.conversation.id];
        return thread
          ? {
              ...current,
              [event.conversation.id]: {
                ...thread,
                conversation: { ...thread.conversation, ...event.conversation },
              },
            }
          : current;
      });
    };
    socket.on('conversation.operation', operationUpdate);
    socket.on('conversation.transferred', operationUpdate);
    socket.on('message.new', (message: MessageResponse) => {
      const isSelected =
        selectedRef.current === message.conversationId && document.visibilityState === 'visible';
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === message.conversationId
            ? {
                ...conversation,
                lastMessageAt: message.createdAt,
                lastMessagePreview: message.content?.slice(0, 160) ?? null,
                unreadCount:
                  message.senderType === 'VISITOR' && !isSelected
                    ? conversation.unreadCount + 1
                    : isSelected
                      ? 0
                      : conversation.unreadCount,
              }
            : conversation,
        ),
      );
      setThreads((current) => {
        const thread = current[message.conversationId];
        return thread
          ? {
              ...current,
              [message.conversationId]: {
                ...thread,
                messages: mergeMessages(thread.messages, [message]),
              },
            }
          : current;
      });
      if (message.senderType === 'VISITOR') {
        void emitAck<MessageReceiptEvent>(socket, 'message.delivered', {
          conversationId: message.conversationId,
          messageId: message.id,
        });
        if (isSelected)
          void emitAck<MessageReceiptEvent[]>(socket, 'message.read', {
            conversationId: message.conversationId,
            throughSequence: message.sequenceNumber,
          });
      }
    });
    socket.on('message.receipt', (receipt: MessageReceiptEvent) =>
      setThreads((current) => updateReceipt(current, receipt)),
    );
    socket.on('typing.changed', (event: TypingEvent) => {
      setTyping((current) =>
        event.typing
          ? { ...current, [event.conversationId]: event }
          : omitKey(current, event.conversationId),
      );
      if (event.typing && event.expiresAt)
        window.setTimeout(
          () => setTyping((current) => omitKey(current, event.conversationId)),
          Math.max(0, new Date(event.expiresAt).getTime() - Date.now()),
        );
    });
    socket.on('visitor.presence', (event: VisitorPresenceEvent) =>
      setVisitorPresence((current) => ({ ...current, [event.conversationId]: event.state })),
    );
    socket.on('conversation.recovery', (event: ConversationRecoveryEvent) => {
      setRecovery((current) =>
        event.state === 'RESTORED'
          ? omitKey(current, event.conversationId)
          : { ...current, [event.conversationId]: event },
      );
      if (event.state === 'REASSIGNING') void loadConversations();
    });
    const heartbeat = window.setInterval(() => {
      if (socket.connected) void emitAck(socket, 'agent.heartbeat', {});
    }, 15_000);
    return () => {
      active = false;
      window.clearInterval(heartbeat);
      socket.disconnect();
    };
  }, [loadConversations]); // The socket owns its subscriptions for the component lifetime.

  const selected = selectedId ? threads[selectedId] : undefined;
  const selectedRecovery = selected ? recovery[selected.conversation.id] : undefined;

  async function respondToOffer(
    offer: ConversationOfferEvent,
    response: 'offer.accept' | 'offer.decline',
  ): Promise<void> {
    setOfferBusy(offer.offerId);
    const result = await emitAck<ConversationRoutingEvent>(socketRef.current, response, {
      offerId: offer.offerId,
    });
    setOfferBusy(undefined);
    const gone =
      result.ok ||
      result.error.code === 'OFFER_NO_LONGER_AVAILABLE' ||
      result.error.code === 'OFFER_NOT_FOUND';
    if (gone) setOffers((current) => current.filter(({ offerId }) => offerId !== offer.offerId));
    if (!result.ok) {
      setNotice(result.error.message);
      return;
    }
    if (response === 'offer.accept') {
      setNotice(undefined);
      setConversations((current) => mergeConversations([result.data.conversation], current));
      await openConversation(result.data.conversation);
    }
  }

  async function openConversation(conversation: ConversationResponse): Promise<void> {
    if (selectedId && scrollArea.current)
      scrollPositions.current[selectedId] = scrollArea.current.scrollTop;
    setSelectedId(conversation.id);
    selectedRef.current = conversation.id;
    setDraft(safeStorageGet(draftKey(conversation.id)) ?? '');
    setThreadLoading(true);
    setError(undefined);
    const result = await emitAck<ConversationSessionResponse>(
      socketRef.current,
      'conversation.subscribe',
      { conversationId: conversation.id },
    );
    if (!result.ok) {
      setError(result.error.message);
      setThreadLoading(false);
      return;
    }
    setThreads((current) => ({
      ...current,
      [conversation.id]: {
        conversation: result.data.conversation,
        messages: result.data.history.messages,
        hasEarlier: result.data.history.hasMore,
      },
    }));
    setConversations((current) =>
      current.map((item) => (item.id === conversation.id ? { ...item, unreadCount: 0 } : item)),
    );
    const latestVisitor = [...result.data.history.messages]
      .reverse()
      .find((message) => message.senderType === 'VISITOR');
    if (latestVisitor)
      void emitAck<MessageReceiptEvent[]>(socketRef.current, 'message.read', {
        conversationId: conversation.id,
        throughSequence: latestVisitor.sequenceNumber,
      });
    setThreadLoading(false);
    requestAnimationFrame(() => {
      if (scrollArea.current)
        scrollArea.current.scrollTop =
          scrollPositions.current[conversation.id] ?? scrollArea.current.scrollHeight;
    });
  }

  function switchThread(id: string): void {
    if (selectedId && scrollArea.current)
      scrollPositions.current[selectedId] = scrollArea.current.scrollTop;
    setSelectedId(id);
    selectedRef.current = id;
    setDraft(safeStorageGet(draftKey(id)) ?? '');
    setConversations((current) =>
      current.map((item) => (item.id === id ? { ...item, unreadCount: 0 } : item)),
    );
    const latestVisitor = [...(threads[id]?.messages ?? [])]
      .reverse()
      .find((message) => message.senderType === 'VISITOR');
    if (latestVisitor)
      void emitAck<MessageReceiptEvent[]>(socketRef.current, 'message.read', {
        conversationId: id,
        throughSequence: latestVisitor.sequenceNumber,
      });
    requestAnimationFrame(() => {
      if (scrollArea.current)
        scrollArea.current.scrollTop =
          scrollPositions.current[id] ?? scrollArea.current.scrollHeight;
    });
  }

  async function loadEarlier(): Promise<void> {
    const oldest = selected?.messages[0]?.sequenceNumber;
    if (!selected || !oldest) return;
    setThreadLoading(true);
    try {
      const page = await apiRequest<MessagePage>(
        `/conversations/${selected.conversation.id}/messages?limit=50&beforeSequence=${oldest}`,
      );
      setThreads((current) => ({
        ...current,
        [selected.conversation.id]: {
          ...selected,
          messages: mergeMessages(page.messages, selected.messages),
          hasEarlier: page.hasMore,
        },
      }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setThreadLoading(false);
    }
  }

  async function sendMessage(retry?: ReliableMessage): Promise<void> {
    const content = (retry?.content ?? draft).trim();
    if (!selected || !content || sending) return;
    stopTyping();
    if (noteMode) {
      setSending(true);
      try {
        const note = await apiRequest<MessageResponse>(
          `/conversations/${selected.conversation.id}/notes`,
          {
            method: 'POST',
            body: JSON.stringify({ clientMessageId: crypto.randomUUID(), content }),
          },
        );
        setThreads((current) => {
          const thread = current[selected.conversation.id] ?? selected;
          return {
            ...current,
            [selected.conversation.id]: {
              ...thread,
              messages: mergeMessages(thread.messages, [note]),
            },
          };
        });
        setDraft('');
        safeStorageRemove(draftKey(selected.conversation.id));
        setNoteMode(false);
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setSending(false);
      }
      return;
    }
    if (selected.conversation.status === 'RESOLVED') {
      setError('Reopen this conversation before replying.');
      return;
    }
    const clientMessageId = retry?.clientMessageId ?? crypto.randomUUID();
    const nextSequence =
      selected.messages.reduce((maximum, message) => {
        const current = BigInt(message.sequenceNumber);
        return current > maximum ? current : maximum;
      }, 0n) + 1n;
    const pending: ReliableMessage = {
      ...(retry ?? {
        id: `pending:${clientMessageId}`,
        conversationId: selected.conversation.id,
        clientMessageId,
        sequenceNumber: nextSequence.toString(),
        senderType: 'AGENT',
        messageType: 'TEXT',
        content,
        createdAt: new Date().toISOString(),
        editedAt: null,
        deliveryState: 'SENT',
        attachments: [],
      }),
      pending: true,
      failed: false,
    };
    setSending(true);
    setDraft('');
    safeStorageRemove(draftKey(selected.conversation.id));
    setThreads((current) => {
      const thread = current[selected.conversation.id] ?? selected;
      const withoutPending = thread.messages.filter(
        (message) => message.clientMessageId !== clientMessageId,
      );
      return {
        ...current,
        [selected.conversation.id]: { ...thread, messages: [...withoutPending, pending] },
      };
    });
    const result = await emitAck<MessageResponse>(socketRef.current, 'message.send', {
      conversationId: selected.conversation.id,
      clientMessageId,
      content,
    });
    if (result.ok)
      setThreads((current) => {
        const thread = current[selected.conversation.id] ?? selected;
        return {
          ...current,
          [selected.conversation.id]: {
            ...thread,
            messages: mergeMessages(thread.messages, [result.data]),
          },
        };
      });
    else {
      const failed: ReliableMessage = { ...pending, pending: false, failed: true };
      setThreads((current) => {
        const thread = current[selected.conversation.id] ?? selected;
        return {
          ...current,
          [selected.conversation.id]: {
            ...thread,
            messages: thread.messages.map((message) =>
              message.clientMessageId === clientMessageId ? failed : message,
            ),
          },
        };
      });
      setError(result.error.message);
    }
    setSending(false);
    requestAnimationFrame(() => {
      if (scrollArea.current) scrollArea.current.scrollTop = scrollArea.current.scrollHeight;
    });
  }

  async function uploadAttachment(file: File): Promise<void> {
    if (!selected || sending || noteMode) return;
    if (selected.conversation.status === 'RESOLVED') {
      setError('Reopen this conversation before sending an attachment.');
      return;
    }
    setSending(true);
    setError(undefined);
    try {
      const body = new FormData();
      body.set('clientMessageId', crypto.randomUUID());
      body.set('content', file.name);
      body.set('file', file);
      const response = await fetch(
        `${API_ORIGIN}/api/v1/conversations/${selected.conversation.id}/attachments`,
        { method: 'POST', credentials: 'include', body },
      );
      if (!response.ok) {
        const failure = (await response.json().catch(() => undefined)) as
          { error?: { message?: string } } | undefined;
        throw new Error(failure?.error?.message ?? 'The attachment could not be uploaded');
      }
      const message = (await response.json()) as MessageResponse;
      setThreads((current) => {
        const thread = current[selected.conversation.id] ?? selected;
        return {
          ...current,
          [selected.conversation.id]: {
            ...thread,
            messages: mergeMessages(thread.messages, [message]),
          },
        };
      });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSending(false);
      if (attachmentInputRef.current) attachmentInputRef.current.value = '';
    }
  }

  function updateDraft(value: string): void {
    setDraft(value);
    if (!selectedId) return;
    if (value) safeStorageSet(draftKey(selectedId), value);
    else safeStorageRemove(draftKey(selectedId));
    if (value.trim() && !typingActive.current) {
      typingActive.current = true;
      void emitAck<TypingEvent>(socketRef.current, 'typing.start', { conversationId: selectedId });
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (!value.trim()) stopTyping();
    else typingTimer.current = setTimeout(stopTyping, 1_500);
  }

  function stopTyping(): void {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (typingActive.current && selectedRef.current)
      void emitAck<TypingEvent>(socketRef.current, 'typing.stop', {
        conversationId: selectedRef.current,
      });
    typingActive.current = false;
  }
  async function changePresence(state: Exclude<AgentPresenceState, 'OFFLINE'>): Promise<void> {
    const result = await emitAck<AgentPresenceEvent>(socketRef.current, 'agent.presence.set', {
      state,
    });
    if (result.ok) setPresence(result.data.state);
    else setError(result.error.message);
  }

  function applyConversationUpdate(conversation: ConversationResponse): void {
    setConversations((current) => mergeConversations([conversation], current));
    setThreads((current) => {
      const thread = current[conversation.id];
      return thread ? { ...current, [conversation.id]: { ...thread, conversation } } : current;
    });
  }

  async function resolveConversation(): Promise<void> {
    if (!selected) return;
    setOperationBusy(true);
    setError(undefined);
    try {
      applyConversationUpdate(
        await apiRequest<ConversationResponse>(
          `/conversations/${selected.conversation.id}/resolve`,
          { method: 'POST', body: '{}' },
        ),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setOperationBusy(false);
    }
  }

  async function reopenConversation(): Promise<void> {
    if (!selected) return;
    setOperationBusy(true);
    setError(undefined);
    try {
      applyConversationUpdate(
        await apiRequest<ConversationResponse>(
          `/conversations/${selected.conversation.id}/reopen`,
          { method: 'POST', body: '{}' },
        ),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setOperationBusy(false);
    }
  }

  async function transferConversation(): Promise<void> {
    if (!selected || !transferTarget) return;
    setOperationBusy(true);
    setError(undefined);
    const [kind, id] = transferTarget.split(':');
    try {
      const updated = await apiRequest<ConversationResponse>(
        `/conversations/${selected.conversation.id}/transfer`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...(kind === 'agent' ? { agentProfileId: id } : { departmentId: id }),
            expectedAssignedAgentMembershipId: selected.conversation.assignedAgentMembershipId,
          }),
        },
      );
      if (kind === 'agent' && updated.assignedAgentMembershipId !== profile?.membershipId) {
        setConversations((current) => current.filter((item) => item.id !== updated.id));
        setThreads((current) => omitKey(current, updated.id));
        setSelectedId(undefined);
      } else applyConversationUpdate(updated);
      setTransferTarget('');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setOperationBusy(false);
    }
  }

  async function toggleTag(tagId: string): Promise<void> {
    if (!selected) return;
    setOperationBusy(true);
    setError(undefined);
    const currentIds = selected.conversation.tags.map((tag) => tag.id);
    const tagIds = currentIds.includes(tagId)
      ? currentIds.filter((id) => id !== tagId)
      : [...currentIds, tagId];
    try {
      applyConversationUpdate(
        await apiRequest<ConversationResponse>(`/conversations/${selected.conversation.id}/tags`, {
          method: 'POST',
          body: JSON.stringify({ tagIds }),
        }),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setOperationBusy(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-white shadow-sm xl:grid xl:min-h-[680px] xl:grid-cols-[320px_minmax(420px,1fr)_250px]">
      <section
        className={`${selected ? 'hidden xl:flex' : 'flex'} min-h-[580px] flex-col border-line xl:border-r`}
        aria-label="Conversation inbox"
      >
        <div className="border-b border-line p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">Live inbox</p>
              <p className="text-xs text-slate-500">
                {connectionState === 'connected'
                  ? `${conversations.reduce((sum, item) => sum + item.unreadCount, 0)} unread`
                  : connectionState === 'error'
                    ? 'Connection interrupted'
                    : 'Recovering live connection…'}
              </p>
            </div>
            <button
              type="button"
              className="rounded-xl p-2 text-slate-500 hover:bg-cream"
              onClick={() => {
                setLoading(true);
                void loadConversations();
              }}
              aria-label="Refresh conversations"
            >
              <RefreshCw
                size={17}
                className={connectionState === 'reconnecting' ? 'animate-spin' : undefined}
              />
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-xl bg-cream px-3 py-2">
            <span className="flex items-center gap-2 text-xs font-medium">
              <Circle
                size={9}
                className={
                  connectionState === 'connected' ? presenceColor(presence) : 'text-amber-500'
                }
                fill="currentColor"
              />
              {connectionState === 'connected'
                ? formatStatus(presence)
                : formatStatus(connectionState)}
            </span>
            <select
              value={presence === 'OFFLINE' ? 'ONLINE' : presence}
              disabled={connectionState !== 'connected'}
              onChange={(event) =>
                void changePresence(event.target.value as Exclude<AgentPresenceState, 'OFFLINE'>)
              }
              className="bg-transparent text-xs outline-none disabled:opacity-50"
            >
              <option value="ONLINE">Online</option>
              <option value="BUSY">Busy</option>
              <option value="AWAY">Away</option>
              <option value="DO_NOT_DISTURB">Do not disturb</option>
            </select>
          </div>
        </div>
        <OfferTray
          offers={offers}
          busyOfferId={offerBusy}
          onAccept={(offer) => void respondToOffer(offer, 'offer.accept')}
          onDecline={(offer) => void respondToOffer(offer, 'offer.decline')}
        />
        {notice ? (
          <div className="m-3 flex items-start justify-between gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            <p>{notice}</p>
            <button
              type="button"
              className="text-xs font-semibold"
              onClick={() => setNotice(undefined)}
              aria-label="Dismiss notice"
            >
              Dismiss
            </button>
          </div>
        ) : null}
        {error && !selected ? (
          <p className="m-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>
        ) : null}
        {loading ? (
          <div className="grid flex-1 place-items-center">
            <LoaderCircle className="animate-spin text-moss" />
          </div>
        ) : conversations.length === 0 ? (
          <EmptyInbox />
        ) : (
          <div className="flex-1 overflow-y-auto p-2">
            {conversations.map((conversation) => (
              <button
                type="button"
                key={conversation.id}
                onClick={() => void openConversation(conversation)}
                className={`mb-1 w-full rounded-2xl p-4 text-left ${selectedId === conversation.id ? 'bg-mint' : 'hover:bg-cream'}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-semibold">
                    Visitor {conversation.id.slice(0, 8)}
                  </span>
                  <time className="shrink-0 text-[11px] text-slate-400">
                    {relativeTime(conversation.lastMessageAt ?? conversation.createdAt)}
                  </time>
                </div>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {typing[conversation.id]
                    ? 'Visitor is typing…'
                    : (conversation.lastMessagePreview ?? 'Conversation started')}
                </p>
                {conversation.departmentName ? (
                  <p className="mt-1 truncate text-[10px] font-medium uppercase tracking-wide text-slate-400">
                    {conversation.departmentName}
                  </p>
                ) : null}
                <div className="mt-2 flex items-center justify-between">
                  <span className="rounded-full bg-white/70 px-2 py-1 text-[10px] font-semibold text-moss">
                    {conversation.status === 'QUEUED' && conversation.queuePosition
                      ? `Queued #${conversation.queuePosition}`
                      : formatStatus(conversation.status)}
                  </span>
                  {waitFlags(conversation).map((flag) => (
                    <span
                      key={flag}
                      className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-800"
                    >
                      {flag}
                    </span>
                  ))}
                  {conversation.unreadCount > 0 ? (
                    <span className="grid min-w-5 place-items-center rounded-full bg-moss px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {conversation.unreadCount}
                    </span>
                  ) : (
                    <span className="text-[10px] capitalize text-slate-400">
                      {conversation.priority.toLowerCase()}
                    </span>
                  )}
                </div>
              </button>
            ))}
            {nextCursor ? (
              <Button
                variant="ghost"
                className="mt-2 w-full"
                onClick={() => void loadConversations(nextCursor, true)}
              >
                Load more
              </Button>
            ) : null}
          </div>
        )}
      </section>

      <section
        className={`${selected ? 'flex' : 'hidden xl:flex'} min-h-[680px] min-w-0 flex-col`}
        aria-label="Selected conversation"
      >
        {!selected ? (
          <ChooseConversation />
        ) : (
          <>
            <div className="flex gap-1 overflow-x-auto border-b border-line bg-cream/60 px-3 pt-2">
              {Object.values(threads).map((thread) => (
                <button
                  type="button"
                  key={thread.conversation.id}
                  onClick={() => switchThread(thread.conversation.id)}
                  className={`shrink-0 rounded-t-xl px-3 py-2 text-xs font-medium ${selectedId === thread.conversation.id ? 'bg-white text-ink' : 'text-slate-500 hover:bg-white/60'}`}
                >
                  Visitor {thread.conversation.id.slice(0, 5)}
                </button>
              ))}
            </div>
            <header className="flex items-center gap-3 border-b border-line px-4 py-4 lg:px-6">
              <button
                type="button"
                className="rounded-xl p-2 hover:bg-cream xl:hidden"
                aria-label="Back to inbox"
                onClick={() => setSelectedId(undefined)}
              >
                <ChevronLeft size={19} />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  Visitor {selected.conversation.id.slice(0, 8)}
                </p>
                <p className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Circle
                    size={7}
                    fill="currentColor"
                    className={
                      visitorPresence[selected.conversation.id] === 'ONLINE'
                        ? 'text-emerald-500'
                        : 'text-slate-300'
                    }
                  />
                  {visitorPresence[selected.conversation.id] === 'ONLINE'
                    ? 'Customer online'
                    : 'Customer disconnected'}{' '}
                  · {formatStatus(selected.conversation.status)}
                </p>
              </div>
              {selected.conversation.status === 'RESOLVED' ? (
                <Button
                  variant="ghost"
                  className="h-9 gap-2 px-3 text-xs"
                  disabled={operationBusy}
                  onClick={() => void reopenConversation()}
                >
                  <RotateCcw size={14} /> Reopen
                </Button>
              ) : ['ASSIGNED', 'ACTIVE', 'WAITING_FOR_CUSTOMER', 'WAITING_FOR_AGENT'].includes(
                  selected.conversation.status,
                ) ? (
                <Button
                  variant="ghost"
                  className="h-9 gap-2 px-3 text-xs"
                  disabled={operationBusy}
                  onClick={() => void resolveConversation()}
                >
                  <CheckCircle2 size={14} /> Resolve
                </Button>
              ) : null}
              <span className="rounded-full bg-cream px-3 py-1.5 text-xs text-slate-500">
                #{selected.conversation.id.slice(-6)}
              </span>
            </header>
            {selectedRecovery ? (
              <div className="mx-5 mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {recoveryMessage(selectedRecovery)}
              </div>
            ) : null}
            {error ? (
              <div className="mx-5 mt-4 flex items-center justify-between rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
                <span>{error}</span>
                <button
                  type="button"
                  onClick={() => setError(undefined)}
                  aria-label="Dismiss error"
                >
                  &times;
                </button>
              </div>
            ) : null}
            <div ref={scrollArea} className="flex-1 overflow-y-auto bg-[#fbfcfa] p-4 lg:p-6">
              {selected.hasEarlier ? (
                <button
                  type="button"
                  disabled={threadLoading}
                  className="mx-auto mb-5 block text-xs font-semibold text-moss disabled:opacity-50"
                  onClick={() => void loadEarlier()}
                >
                  {threadLoading ? 'Loading…' : 'Load earlier messages'}
                </button>
              ) : null}
              <ol className="space-y-3">
                {selected.messages.map((message) => (
                  <ConversationMessage
                    key={message.id}
                    message={message}
                    onRetry={() => void sendMessage(message)}
                  />
                ))}
              </ol>
              {typing[selected.conversation.id] ? (
                <p className="mt-3 text-xs font-medium text-moss">Visitor is typing…</p>
              ) : null}
            </div>
            <form
              className={`border-t p-4 lg:p-5 ${noteMode ? 'border-amber-200 bg-amber-50' : 'border-line bg-white'}`}
              onSubmit={(event) => {
                event.preventDefault();
                void sendMessage();
              }}
            >
              <div className="mb-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setNoteMode((current) => !current)}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${noteMode ? 'bg-amber-200 text-amber-900' : 'bg-cream text-slate-600'}`}
                >
                  <StickyNote size={13} /> {noteMode ? 'Internal note' : 'Add note'}
                </button>
                <label className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-500">
                  <Zap size={13} />
                  <select
                    defaultValue=""
                    onChange={(event) => {
                      const response = cannedResponses.find(
                        (item) => item.id === event.target.value,
                      );
                      if (response) updateDraft(response.content);
                      event.target.value = '';
                    }}
                    className="max-w-44 bg-transparent outline-none"
                  >
                    <option value="">Quick response</option>
                    {cannedResponses
                      .filter(
                        (item) =>
                          !item.departmentId ||
                          item.departmentId === selected.conversation.departmentId,
                      )
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.shortcut ? `${item.shortcut} · ` : ''}
                          {item.title}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <div className="flex items-end gap-3">
                <input
                  ref={attachmentInputRef}
                  type="file"
                  className="hidden"
                  accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,.txt,.csv"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadAttachment(file);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="size-12 shrink-0 px-0"
                  disabled={sending || noteMode || selected.conversation.status === 'RESOLVED'}
                  onClick={() => attachmentInputRef.current?.click()}
                  aria-label="Attach a file"
                >
                  <Paperclip size={18} />
                </Button>
                <textarea
                  value={draft}
                  onChange={(event) => updateDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                  rows={2}
                  maxLength={4000}
                  placeholder={
                    noteMode
                      ? 'Write a private note…'
                      : selected.conversation.status === 'RESOLVED'
                        ? 'Reopen before replying…'
                        : 'Write a reply…'
                  }
                  aria-label={noteMode ? 'Internal note' : 'Reply'}
                  className="min-h-12 flex-1 resize-none rounded-2xl border border-line px-4 py-3 text-sm outline-none focus:border-moss focus:ring-2 focus:ring-mint"
                />
                <Button
                  type="submit"
                  disabled={
                    !draft.trim() ||
                    sending ||
                    (selected.conversation.status === 'RESOLVED' && !noteMode)
                  }
                  className="size-12 shrink-0 px-0"
                  aria-label={noteMode ? 'Save internal note' : 'Send reply'}
                >
                  {sending ? (
                    <LoaderCircle size={18} className="animate-spin" />
                  ) : noteMode ? (
                    <LockKeyhole size={18} />
                  ) : (
                    <Send size={18} />
                  )}
                </Button>
              </div>
              <p
                className={`mt-2 text-[11px] ${noteMode ? 'font-medium text-amber-700' : 'text-slate-400'}`}
              >
                {noteMode
                  ? 'Private: never shown to the visitor'
                  : 'Enter to send · Shift + Enter for a new line · Drafts are saved per conversation'}
              </p>
            </form>
          </>
        )}
      </section>

      <aside className="hidden overflow-y-auto border-l border-line bg-cream/45 p-5 xl:block">
        {selected ? (
          <>
            <p className="text-xs font-semibold uppercase tracking-wider text-moss">
              Conversation context
            </p>
            <dl className="mt-5 space-y-4 text-sm">
              <Context
                label="Customer"
                value={`Anonymous ${selected.conversation.id.slice(0, 8)}`}
              />
              <Context
                label="Presence"
                value={
                  visitorPresence[selected.conversation.id] === 'ONLINE' ? 'Online' : 'Offline'
                }
              />
              <Context
                label="Department"
                value={selected.conversation.departmentName ?? 'General'}
              />
              <Context
                label="Routing"
                value={
                  selected.conversation.status === 'QUEUED'
                    ? `Queue position ${selected.conversation.queuePosition ?? 'pending'}`
                    : 'Assigned'
                }
              />
              <Context label="Channel" value={formatStatus(selected.conversation.source)} />
              <Context label="Priority" value={formatStatus(selected.conversation.priority)} />
              <Context
                label="Started"
                value={new Intl.DateTimeFormat(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(selected.conversation.createdAt))}
              />
            </dl>
            <FollowUpDetails conversation={selected.conversation} />
            <IntakeAnswers conversationId={selected.conversation.id} />
            <div className="mt-6 rounded-2xl border border-line bg-white p-4">
              <div className="flex items-center gap-2">
                <Users size={16} className="text-moss" />
                <p className="text-sm font-semibold">Your workload</p>
              </div>
              <p className="mt-3 text-2xl font-bold">
                {profile?.activeChats ?? 0}{' '}
                <span className="text-sm font-normal text-slate-400">
                  / {profile?.maxConcurrentChats ?? 5}
                </span>
              </p>
              <p className="mt-1 text-xs text-slate-500">active assigned chats</p>
            </div>
            <div className="mt-4 rounded-2xl border border-line bg-white p-4">
              <div className="flex items-center gap-2">
                <ArrowRightLeft size={15} className="text-moss" />
                <p className="text-sm font-semibold">Transfer</p>
              </div>
              <select
                value={transferTarget}
                onChange={(event) => setTransferTarget(event.target.value)}
                className="mt-3 h-9 w-full rounded-lg border border-line bg-white px-2 text-xs outline-none"
              >
                <option value="">Choose destination</option>
                <optgroup label="Consultants">
                  {agents
                    .filter(
                      (agent) =>
                        agent.membershipId !== selected.conversation.assignedAgentMembershipId &&
                        agent.status === 'ACTIVE',
                    )
                    .map((agent) => (
                      <option key={agent.id} value={`agent:${agent.id}`}>
                        {agent.user.displayName} · {formatStatus(agent.presence)}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Departments">
                  {departments.map((department) => (
                    <option key={department.id} value={`department:${department.id}`}>
                      {department.name}
                    </option>
                  ))}
                </optgroup>
              </select>
              <Button
                className="mt-2 h-9 w-full gap-2 text-xs"
                disabled={!transferTarget || operationBusy}
                onClick={() => void transferConversation()}
              >
                <ArrowRightLeft size={14} /> Transfer
              </Button>
            </div>
            <div className="mt-4 rounded-2xl border border-line bg-white p-4">
              <div className="flex items-center gap-2">
                <Tags size={15} className="text-moss" />
                <p className="text-sm font-semibold">Tags</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {availableTags.length ? (
                  availableTags.map((tag) => {
                    const active = selected.conversation.tags.some((item) => item.id === tag.id);
                    return (
                      <button
                        type="button"
                        key={tag.id}
                        disabled={operationBusy}
                        onClick={() => void toggleTag(tag.id)}
                        className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${active ? 'text-white' : 'bg-white text-slate-500'}`}
                        style={{
                          borderColor: tag.color,
                          backgroundColor: active ? tag.color : undefined,
                        }}
                      >
                        {tag.name}
                      </button>
                    );
                  })
                ) : (
                  <p className="text-xs text-slate-400">No tags configured.</p>
                )}
              </div>
            </div>
          </>
        ) : null}
      </aside>
    </div>
  );
}

function ConversationMessage({
  message,
  onRetry,
}: {
  message: ReliableMessage;
  onRetry: () => void;
}) {
  if (message.messageType === 'SYSTEM_EVENT')
    return (
      <li className="flex justify-center">
        <div className="max-w-[88%] rounded-full bg-slate-100 px-4 py-2 text-center text-[11px] font-medium text-slate-500">
          {message.content}
        </div>
      </li>
    );
  if (message.messageType === 'INTERNAL_NOTE')
    return (
      <li className="flex justify-end">
        <div className="max-w-[88%] rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
            <LockKeyhole size={12} /> Internal note
          </p>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed">
            {message.content}
          </p>
          <p className="mt-1.5 text-right text-[10px] text-amber-600">
            {formatTime(message.createdAt)}
          </p>
        </div>
      </li>
    );
  const outgoing = message.senderType === 'AGENT' || message.senderType === 'INTEGRATION';
  return (
    <li className={`flex ${outgoing ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[78%] rounded-2xl px-4 py-3 ${message.failed ? 'border border-red-300 bg-red-50 text-red-900' : outgoing ? 'rounded-br-md bg-ink text-white' : 'rounded-bl-md border border-line bg-white'}`}
      >
        {message.senderType === 'INTEGRATION' && (
          <p className="mb-1 text-xs text-white/70">Integration</p>
        )}
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p>
        {message.attachments.length ? (
          <div className="mt-3 space-y-2">
            {message.attachments.map((attachment) => (
              <a
                key={attachment.id}
                href={`${API_ORIGIN}${attachment.downloadUrl}`}
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium ${outgoing ? 'bg-white/15 text-white' : 'bg-cream text-moss'}`}
              >
                <Paperclip size={14} />
                <span className="min-w-0 flex-1 truncate">{attachment.originalFileName}</span>
                <span>{formatBytes(attachment.sizeBytes)}</span>
              </a>
            ))}
          </div>
        ) : null}
        {message.failed ? (
          <div className="mt-2 text-right text-xs text-red-600">
            <span>Not sent</span>
            <button type="button" onClick={onRetry} className="ml-2 font-semibold underline">
              Retry safely
            </button>
          </div>
        ) : (
          <p
            className={`mt-1.5 text-right text-[10px] ${outgoing ? 'text-white/60' : 'text-slate-400'}`}
          >
            {message.id.startsWith('pending:') ? 'Sending…' : formatTime(message.createdAt)}
            {outgoing && !message.id.startsWith('pending:')
              ? ` · ${message.deliveryState.toLowerCase()}`
              : ''}
          </p>
        )}
      </div>
    </li>
  );
}

function Context({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="mt-1 font-medium capitalize">{value}</dd>
    </div>
  );
}
function EmptyInbox() {
  return (
    <div className="grid flex-1 place-items-center px-6 text-center">
      <div>
        <Inbox className="mx-auto text-slate-300" size={36} />
        <p className="mt-3 font-semibold">No conversations yet</p>
        <p className="mt-1 text-sm text-slate-500">New widget messages appear live.</p>
      </div>
    </div>
  );
}
function ChooseConversation() {
  return (
    <div className="grid flex-1 place-items-center px-6 text-center">
      <div>
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-mint text-moss">
          <MessageSquareText />
        </span>
        <h3 className="mt-4 font-semibold">Choose a conversation</h3>
        <p className="mt-2 text-sm text-slate-500">
          Messages, presence, and customer context will appear here.
        </p>
      </div>
    </div>
  );
}
function mergeMessages(first: ReliableMessage[], second: ReliableMessage[]): ReliableMessage[] {
  const map = new Map(first.map((message) => [message.clientMessageId, message]));
  for (const message of second) map.set(message.clientMessageId, message);
  return [...map.values()].sort((a, b) =>
    BigInt(a.sequenceNumber) < BigInt(b.sequenceNumber) ? -1 : 1,
  );
}
function mergeConversations(
  first: ConversationResponse[],
  second: ConversationResponse[],
): ConversationResponse[] {
  const map = new Map(second.map((item) => [item.id, item]));
  for (const item of first) map.set(item.id, { ...map.get(item.id), ...item });
  return [...map.values()].sort(
    (a, b) =>
      new Date(b.lastMessageAt ?? b.createdAt).getTime() -
      new Date(a.lastMessageAt ?? a.createdAt).getTime(),
  );
}
function updateReceipt(
  threads: Record<string, ThreadState>,
  receipt: MessageReceiptEvent,
): Record<string, ThreadState> {
  const thread = threads[receipt.conversationId];
  if (!thread) return threads;
  return {
    ...threads,
    [receipt.conversationId]: {
      ...thread,
      messages: thread.messages.map((message) =>
        message.id === receipt.messageId ? { ...message, deliveryState: receipt.state } : message,
      ),
    },
  };
}
function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}
function emitAck<T>(
  socket: Socket | undefined,
  event: string,
  input: unknown,
): Promise<SocketAck<T>> {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      resolve({ ok: false, error: { code: 'OFFLINE', message: 'The live inbox is reconnecting' } });
      return;
    }
    socket
      .timeout(10_000)
      .emit(event, input, (error: Error | null, response: SocketAck<T>) =>
        resolve(
          error
            ? { ok: false, error: { code: 'TIMEOUT', message: 'The request timed out' } }
            : response,
        ),
      );
  });
}
function presenceColor(state: AgentPresenceState): string {
  return state === 'ONLINE'
    ? 'text-emerald-500'
    : state === 'BUSY' || state === 'DO_NOT_DISTURB'
      ? 'text-red-500'
      : state === 'AWAY'
        ? 'text-amber-500'
        : 'text-slate-300';
}
function formatStatus(status: string): string {
  return status.toLowerCase().replaceAll('_', ' ');
}
function recoveryMessage(event: ConversationRecoveryEvent): string {
  if (event.state === 'DISCONNECTED_GRACE')
    return 'Consultant disconnected. The assignment is being held during the reconnect grace period.';
  if (event.state === 'REASSIGNING')
    return 'Grace period expired. The conversation is being reassigned.';
  return 'A recovery retry is scheduled; durable messages are safe.';
}
function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(value),
  );
}
function formatBytes(value: number): string {
  return value < 1024 * 1024
    ? `${Math.max(1, Math.ceil(value / 1024))} KB`
    : `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
function relativeTime(value: string): string {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
}
function draftKey(id: string): string {
  return `bizchat:agent-draft:${id}`;
}
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The request could not be completed';
}
function safeStorageGet(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}
function safeStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage may be unavailable. */
  }
}
function safeStorageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* Storage may be unavailable. */
  }
}
