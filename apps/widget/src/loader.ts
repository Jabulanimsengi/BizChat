import type {
  BusinessAvailabilityEvent,
  ConversationOperationEvent,
  ConversationRecoveryEvent,
  ConversationRoutingEvent,
  ConversationSessionResponse,
  IntakePrompt,
  MessagePage,
  MessageReceiptEvent,
  MessageResponse,
  SocketAck,
  TypingEvent,
  WidgetBootstrapResponse,
  WidgetTopic,
} from '@bizchat/types';
import { io, type Socket } from 'socket.io-client';
import { widgetStyles } from './styles';

type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
type PendingMessage = MessageResponse & { pending?: boolean; failed?: boolean };

class BizChatWidgetElement extends HTMLElement {
  private shadow?: ShadowRoot;
  private socket?: Socket;
  private abortController?: AbortController;
  private initialized = false;
  private isOpen = false;
  private identityToken?: string;
  public setIdentity(token?: string): void {
    this.identityToken = token;
  }
  public get opened(): boolean {
    return this.isOpen;
  }
  public open(): void {
    if (!this.isOpen) this.element<HTMLButtonElement>('.launcher').click();
  }
  public close(): void {
    if (this.isOpen) this.element<HTMLButtonElement>('.close').click();
  }
  private businessPublicId = '';
  private apiUrl = '';
  private widgetSessionToken = '';
  private conversationId?: string;
  private messages: PendingMessage[] = [];
  /** Quick-reply topics from bootstrap, offered before the first message. */
  private topics: WidgetTopic[] = [];
  private selectedTopic?: string;
  private intake?: IntakePrompt;
  private changingTopic = false;
  private hasEarlier = false;
  private sending = false;
  private heartbeatTimer?: number;
  private typingTimer?: number;
  private typingActive = false;
  private unreadCount = 0;
  private queueMessage =
    "All consultants are busy. You're in the queue and we'll be with you shortly.";

  public connectedCallback(): void {
    if (!this.shadow) this.buildShadowDom();
    if (this.initialized) return;
    this.initialized = true;
    this.abortController = new AbortController();
    void this.initialize();
  }

  public disconnectedCallback(): void {
    this.abortController?.abort();
    this.socket?.disconnect();
    if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer);
    if (this.typingTimer) window.clearTimeout(this.typingTimer);
    this.initialized = false;
  }

  private buildShadowDom(): void {
    const shadow = this.attachShadow({ mode: 'closed' });
    this.shadow = shadow;
    const style = document.createElement('style');
    style.nonce = this.getAttribute('style-nonce') ?? '';
    style.textContent = widgetStyles;
    const shell = document.createElement('div');
    shell.innerHTML = `<section class="panel" role="dialog" aria-label="Business chat" hidden><header class="header"><div class="header-row"><div><p class="eyebrow">Customer care</p><h2 class="title">BizChat</h2></div><button class="close" type="button" aria-label="Close chat">&times;</button></div></header><div class="status-strip"><span class="status"><span class="dot connecting" data-connection-dot></span><span data-connection>connecting</span></span><span class="status"><span class="dot" data-team-dot></span><span data-team>Team status unknown</span></span></div><div class="body" data-scroll><div class="loading" data-loading>Preparing secure chat&hellip;</div><div class="error-box" data-error hidden></div><div data-chat hidden><div class="welcome"><h3 data-greeting></h3><p>Send a message and the team can reply here.</p><label class="department-picker" data-department-picker hidden><span>Choose a department</span><select data-department aria-label="Choose a department"></select></label></div><button class="load-earlier" type="button" data-load-earlier hidden>Load earlier messages</button><ol class="messages" data-messages aria-live="polite"></ol><div class="topic-picker" data-topic-picker role="group" hidden><p data-topic-prompt></p><div class="topic-options" data-topic-options></div></div><div class="typing" data-typing hidden><span></span><span></span><span></span><em>Consultant is typing</em></div></div></div><form class="composer" data-composer><div class="composer-row"><input data-attachment type="file" hidden accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,.txt,.csv"><button class="attach" type="button" disabled aria-label="Attach a file">&#128206;</button><textarea rows="2" disabled placeholder="Write a message" aria-label="Message composer" maxlength="4000"></textarea><button class="send" type="submit" disabled aria-label="Send message">${sendIcon}</button></div><p class="composer-note" data-composer-note>Your anonymous identity is stored only for this browser.</p></form></section><button class="launcher" type="button" aria-label="Open chat"><span data-launcher-content>${chatIcon}</span><span class="unread-badge" data-unread hidden>0</span></button>`;
    shadow.append(style, shell);
    const panel = this.element<HTMLElement>('.panel');
    const launcher = this.element<HTMLButtonElement>('.launcher');
    const setOpen = (open: boolean): void => {
      this.isOpen = open;
      panel.hidden = !open;
      launcher.setAttribute('aria-label', open ? 'Close chat' : 'Open chat');
      this.element('[data-launcher-content]').innerHTML = open ? '&times;' : chatIcon;
      if (open) {
        this.unreadCount = 0;
        this.renderUnread();
        this.scrollToLatest();
        this.markRead();
      }
    };
    launcher.addEventListener('click', () => setOpen(panel.hidden));
    this.element<HTMLButtonElement>('.close').addEventListener('click', () => setOpen(false));
    this.element<HTMLFormElement>('[data-composer]').addEventListener('submit', (event) => {
      event.preventDefault();
      void this.submitMessage();
    });
    this.element<HTMLTextAreaElement>('textarea').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void this.submitMessage();
      }
    });
    this.element<HTMLTextAreaElement>('textarea').addEventListener('input', () =>
      this.handleTypingInput(),
    );
    this.element<HTMLButtonElement>('.attach').addEventListener('click', () =>
      this.element<HTMLInputElement>('[data-attachment]').click(),
    );
    this.element<HTMLInputElement>('[data-attachment]').addEventListener('change', (event) => {
      const input = event.currentTarget;
      const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
      if (file) void this.uploadAttachment(file);
    });
    this.element<HTMLButtonElement>('[data-load-earlier]').addEventListener(
      'click',
      () => void this.loadEarlier(),
    );
    this.applyColor('#155f43');
  }

  private async initialize(): Promise<void> {
    this.businessPublicId = this.getAttribute('business-id') ?? '';
    if (!this.businessPublicId) {
      this.showError('A business identifier is required');
      return;
    }
    const apiUrl = (this.getAttribute('api-url') ?? 'https://api.bizchat.example').replace(
      /\/$/,
      '',
    );
    try {
      const storageKey = `bizchat:visitor:${this.businessPublicId}`;
      const visitorToken = this.identityToken ? undefined : safeStorageGet(storageKey);
      const response = await fetch(`${apiUrl}/api/v1/widget/bootstrap`, {
        method: 'POST',
        signal: this.abortController?.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          businessPublicId: this.businessPublicId,
          ...(visitorToken ? { visitorToken } : {}),
          ...(this.identityToken ? { identityToken: this.identityToken } : {}),
        }),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => undefined)) as
          { error?: { message?: string } } | undefined;
        throw new Error(failure?.error?.message ?? 'This chat is unavailable');
      }
      const result = (await response.json()) as WidgetBootstrapResponse;
      if (!this.isConnected) return;
      this.apiUrl = apiUrl;
      this.widgetSessionToken = result.widgetSessionToken;
      if (!this.identityToken) safeStorageSet(storageKey, result.visitorToken);
      this.conversationId = this.identityToken
        ? result.conversationId
        : safeStorageGet(this.conversationStorageKey());
      this.applyBootstrap(result);
      this.connectSocket(apiUrl, result.widgetSessionToken);
      window.dispatchEvent(
        new CustomEvent('bizchat:ready', { detail: { businessPublicId: this.businessPublicId } }),
      );
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError'))
        this.showError(messageFrom(cause));
    }
  }

  private applyBootstrap(result: WidgetBootstrapResponse): void {
    this.setAttribute('position', result.config.launcherPosition);
    this.applyColor(result.config.primaryColor);
    this.element('.title').textContent = result.config.businessName;
    this.element('[data-greeting]').textContent = result.config.greeting;
    this.queueMessage = result.config.queueMessage;
    const picker = this.element<HTMLElement>('[data-department-picker]');
    const select = this.element<HTMLSelectElement>('[data-department]');
    select.replaceChildren(
      ...result.departments.map((department) => {
        const option = document.createElement('option');
        option.value = department.publicId;
        option.textContent = department.name;
        return option;
      }),
    );
    // The CDN-hosted widget may briefly run against an API that predates topics.
    this.topics = result.topics ?? [];
    // Topic buttons replace the department picker when the business has topics.
    picker.hidden =
      !result.config.departmentSelectionEnabled ||
      result.departments.length < 2 ||
      this.topics.length > 0 ||
      Boolean(this.conversationId);
    this.renderTopicPicker();
    this.element<HTMLElement>('[data-loading]').hidden = true;
    this.element<HTMLElement>('[data-chat]').hidden = false;
    this.element('.panel').setAttribute('aria-label', `${result.config.businessName} chat`);
  }

  private connectSocket(apiUrl: string, token: string): void {
    this.socket = io(`${apiUrl}/widget`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 10_000,
      randomizationFactor: 0.4,
    });
    this.socket.on('connect', () => this.setConnection('connecting'));
    this.socket.on('widget.connected', () => {
      this.setConnection('connected');
      void this.resumeConversation();
    });
    this.socket.io.on('reconnect_attempt', () => this.setConnection('reconnecting'));
    this.socket.on('disconnect', (reason) =>
      this.setConnection(reason === 'io client disconnect' ? 'disconnected' : 'reconnecting'),
    );
    this.socket.on('connect_error', () => this.setConnection('error'));
    this.socket.on('widget.error', (event: { code?: string; message?: string }) => {
      this.setConnection('error');
      if (event.code === 'WIDGET_SESSION_INVALID') {
        this.socket?.disconnect();
        if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer);
        this.setComposerNote('Refreshing your secure chat session…');
        window.setTimeout(() => void this.initialize(), 500);
        return;
      }
      this.showError(event.message ?? 'Chat session expired');
    });
    this.socket.on('message.new', (message: MessageResponse) => {
      if (message.conversationId !== this.conversationId) return;
      this.mergeMessages([message]);
      if (message.senderType !== 'VISITOR') {
        this.markDelivered(message);
        if (!this.isOpen) {
          this.unreadCount += 1;
          this.renderUnread();
        }
      }
      if (this.isOpen) this.markRead();
    });
    this.socket.on('message.receipt', (receipt: MessageReceiptEvent) => {
      const found = this.messages.find((message) => message.id === receipt.messageId);
      if (found) {
        found.deliveryState = receipt.state;
        this.renderMessages();
      }
    });
    this.socket.on('business.presence', (event: BusinessAvailabilityEvent) => {
      this.element('[data-team]').textContent =
        event.availability === 'ONLINE'
          ? `${event.onlineAgents} consultant${event.onlineAgents === 1 ? '' : 's'} online`
          : 'Team offline';
      this.element('[data-team-dot]').className =
        `dot ${event.availability === 'ONLINE' ? 'connected' : 'offline'}`;
    });
    this.socket.on('typing.changed', (event: TypingEvent) => {
      if (event.conversationId === this.conversationId && event.participantType === 'AGENT')
        this.showTyping(event);
    });
    this.socket.on('conversation.routed', (event: ConversationRoutingEvent) => {
      if (event.conversation.id !== this.conversationId) return;
      this.showRoutingState(event);
    });
    this.socket.on('conversation.updated', (event: ConversationOperationEvent) => {
      if (event.conversation.id !== this.conversationId) return;
      if (event.operation === 'RESOLVED')
        this.setComposerNote(
          'This conversation was resolved. Send a message to reopen it during the allowed window.',
        );
      else if (event.operation === 'REOPENED')
        this.setComposerNote('Conversation reopened. We are connecting you with a consultant.');
      else if (event.operation === 'TRANSFERRED')
        this.setComposerNote('Your conversation was transferred to the right team.');
      else if (event.operation === 'ABANDONED') {
        safeStorageRemove(this.conversationStorageKey());
        this.conversationId = undefined;
        this.intake = undefined;
        this.renderTopicPicker();
        this.setComposerNote('Your place in the queue expired. Send a message to start again.');
      }
    });
    this.socket.on('conversation.recovery', (event: ConversationRecoveryEvent) => {
      if (event.conversationId !== this.conversationId) return;
      if (event.state === 'DISCONNECTED_GRACE')
        this.setComposerNote(
          'Your consultant disconnected. We are holding the conversation while they reconnect.',
        );
      else if (event.state === 'RESTORED')
        this.setComposerNote('Your consultant reconnected. You can continue chatting.');
      else if (event.state === 'REASSIGNING')
        this.setComposerNote("We're reconnecting you with a consultant.");
      else
        this.setComposerNote(
          'We are still reconnecting your conversation. Your messages are safe.',
        );
    });
    this.heartbeatTimer = window.setInterval(() => {
      if (this.socket?.connected) this.socket.emit('widget.heartbeat');
    }, 15_000);
  }

  /** Where a new conversation should go: a chosen topic, or the visible department picker. */
  private startTarget(): { topicPublicId?: string; departmentPublicId?: string } {
    if (this.selectedTopic) return { topicPublicId: this.selectedTopic };
    const picker = this.element<HTMLElement>('[data-department-picker]');
    const department = this.element<HTMLSelectElement>('[data-department]').value;
    // A hidden select still reports its first option, so only a visible picker counts as a choice.
    return !picker.hidden && department ? { departmentPublicId: department } : {};
  }

  private renderTopicPicker(): void {
    const container = this.element<HTMLElement>('[data-topic-picker]');
    const prompt = this.element('[data-topic-prompt]');
    const options = this.element('[data-topic-options]');
    const button = (label: string, onClick: () => void, selected = false): HTMLButtonElement => {
      const element = document.createElement('button');
      element.type = 'button';
      element.textContent = label;
      element.className = selected ? 'topic selected' : 'topic';
      element.setAttribute('aria-pressed', String(selected));
      element.addEventListener('click', onClick);
      return element;
    };
    if (!this.conversationId && this.topics.length > 0) {
      prompt.textContent = 'What can we help with?';
      options.replaceChildren(
        ...this.topics.map((topic) =>
          button(
            topic.name,
            () => {
              this.selectedTopic =
                this.selectedTopic === topic.publicId ? undefined : topic.publicId;
              this.renderTopicPicker();
              this.element<HTMLTextAreaElement>('textarea').focus();
            },
            this.selectedTopic === topic.publicId,
          ),
        ),
      );
      container.hidden = false;
      return;
    }
    const intake = this.intake;
    if (!intake) {
      container.hidden = true;
      return;
    }
    const choices = intake.topics.filter(
      (topic) => topic.publicId !== intake.selectedTopic?.publicId,
    );
    const choose = (publicId: string | null): void => void this.chooseTopic(publicId);
    if (intake.mode === 'CONFIRM' && !this.changingTopic) {
      prompt.textContent = `We think this is about ${intake.selectedTopic?.name ?? 'your question'}.`;
      options.replaceChildren(
        button('Choose another topic', () => {
          this.changingTopic = true;
          this.renderTopicPicker();
        }),
      );
    } else {
      prompt.textContent = 'Which of these best describes your question?';
      options.replaceChildren(
        ...choices.map((topic) => button(topic.name, () => choose(topic.publicId))),
        button('Something else', () => choose(null)),
      );
    }
    container.hidden = false;
  }

  private async chooseTopic(topicPublicId: string | null): Promise<void> {
    if (!this.conversationId) return;
    const result = await this.emit<ConversationRoutingEvent>('conversation.intake.submit', {
      conversationId: this.conversationId,
      topicPublicId,
    });
    if (!result.ok) {
      this.setComposerNote(result.error.message, true);
      if (result.error.code === 'TOPIC_LOCKED') {
        this.intake = undefined;
        this.renderTopicPicker();
      }
      return;
    }
    this.intake = undefined;
    this.changingTopic = false;
    this.renderTopicPicker();
    this.showRoutingState(result.data);
  }

  private async resumeConversation(): Promise<void> {
    if (!this.conversationId || !this.socket) return;
    const recovering = Boolean(this.latestSequence());
    let afterSequence = this.latestSequence();
    for (let page = 0; page < 50; page += 1) {
      const result = await this.emit<ConversationSessionResponse>('conversation.resume', {
        conversationId: this.conversationId,
        ...(afterSequence ? { afterSequence } : {}),
        limit: 100,
      });
      if (!result.ok) {
        if (result.error.code === 'CONVERSATION_NOT_FOUND') {
          safeStorageRemove(this.conversationStorageKey());
          this.conversationId = undefined;
        } else this.setComposerNote(result.error.message, true);
        return;
      }
      this.mergeMessages(result.data.history.messages, false);
      // An unanswered topic prompt survives page reloads.
      this.intake = result.data.intake;
      this.renderTopicPicker();
      if (!recovering) {
        this.hasEarlier = result.data.history.hasMore;
        break;
      }
      const nextSequence = this.latestSequence();
      if (!result.data.history.hasMore || !nextSequence || nextSequence === afterSequence) break;
      afterSequence = nextSequence;
    }
    this.updateEarlierButton();
    this.renderMessages();
    this.scrollToLatest();
    this.markRead();
  }

  private async submitMessage(retry?: PendingMessage): Promise<void> {
    const textarea = this.element<HTMLTextAreaElement>('textarea');
    const content = (retry?.content ?? textarea.value).trim();
    if (!content || this.sending || !this.socket?.connected) return;
    this.stopTyping();
    const clientMessageId = retry?.clientMessageId ?? crypto.randomUUID();
    const optimistic = retry ?? this.optimisticMessage(clientMessageId, content);
    optimistic.failed = false;
    optimistic.pending = true;
    if (!retry) {
      this.messages.push(optimistic);
      textarea.value = '';
    }
    this.sending = true;
    this.renderMessages();
    const result = this.conversationId
      ? await this.emit<MessageResponse>('message.send', {
          conversationId: this.conversationId,
          clientMessageId,
          content,
        })
      : await this.emit<ConversationSessionResponse>('conversation.start', {
          clientMessageId,
          content,
          ...this.startTarget(),
        });
    this.sending = false;
    if (!result.ok) {
      if (result.error.code === 'REOPEN_WINDOW_EXPIRED' && this.conversationId) {
        safeStorageRemove(this.conversationStorageKey());
        this.conversationId = undefined;
        this.sending = false;
        await this.submitMessage(optimistic);
        return;
      }
      optimistic.pending = false;
      optimistic.failed = true;
      this.setComposerNote(result.error.message, true);
      this.renderMessages();
      return;
    }
    if ('conversation' in result.data) {
      this.conversationId = result.data.conversation.id;
      if (!this.identityToken) safeStorageSet(this.conversationStorageKey(), this.conversationId);
      this.updateAttachmentControl();
      this.mergeMessages(result.data.history.messages);
      this.hasEarlier = result.data.history.hasMore;
      this.updateEarlierButton();
      this.element<HTMLElement>('[data-department-picker]').hidden = true;
      this.selectedTopic = undefined;
      this.intake = result.data.intake;
      this.renderTopicPicker();
      if (this.intake?.mode === 'ASK')
        this.setComposerNote('Choose a topic below so we can connect you with the right person.');
      else
        this.showRoutingState({
          conversation: result.data.conversation,
          outcome:
            result.data.conversation.status === 'QUEUED'
              ? 'QUEUED'
              : result.data.conversation.status === 'OFFERED'
                ? 'OFFERED'
                : 'ASSIGNED',
          assignedAgentMembershipId: result.data.conversation.assignedAgentMembershipId,
          queuedAt: result.data.conversation.queuedAt,
          queuePosition: result.data.conversation.queuePosition,
        });
    } else this.mergeMessages([result.data]);
    if (!('conversation' in result.data))
      this.setComposerNote('Your anonymous identity is stored only for this browser.');
  }

  private async uploadAttachment(file: File): Promise<void> {
    if (!this.conversationId || this.sending || !this.socket?.connected) return;
    this.sending = true;
    this.updateAttachmentControl();
    const form = new FormData();
    form.set('clientMessageId', crypto.randomUUID());
    form.set('content', file.name);
    form.set('file', file);
    try {
      const response = await fetch(
        `${this.apiUrl}/api/v1/widget/conversations/${this.conversationId}/attachments`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${this.widgetSessionToken}` },
          body: form,
        },
      );
      if (!response.ok) {
        const failure = (await response.json().catch(() => undefined)) as
          { error?: { message?: string } } | undefined;
        throw new Error(failure?.error?.message ?? 'The attachment could not be uploaded');
      }
      this.mergeMessages([(await response.json()) as MessageResponse]);
    } catch (cause) {
      this.setComposerNote(messageFrom(cause), true);
    } finally {
      this.sending = false;
      this.element<HTMLInputElement>('[data-attachment]').value = '';
      this.updateAttachmentControl();
    }
  }

  private showRoutingState(event: ConversationRoutingEvent): void {
    if (event.outcome === 'QUEUED') {
      const position = event.queuePosition ? ` You are number ${event.queuePosition}.` : '';
      this.setComposerNote(`${this.queueMessage}${position}`);
    } else if (event.outcome === 'OFFERED')
      this.setComposerNote('Connecting you with a consultant…');
    else this.setComposerNote('A consultant has been assigned to your conversation.');
  }

  private async loadEarlier(): Promise<void> {
    const oldest = this.oldestSequence();
    if (!oldest || !this.conversationId) return;
    const button = this.element<HTMLButtonElement>('[data-load-earlier]');
    button.disabled = true;
    const result = await this.emit<MessagePage>('conversation.history', {
      conversationId: this.conversationId,
      beforeSequence: oldest,
      limit: 50,
    });
    button.disabled = false;
    if (!result.ok) {
      this.setComposerNote(result.error.message, true);
      return;
    }
    this.mergeMessages(result.data.messages, false);
    this.hasEarlier = result.data.hasMore;
    this.updateEarlierButton();
  }

  private mergeMessages(incoming: MessageResponse[], scroll = true): void {
    for (const message of incoming) {
      const index = this.messages.findIndex(
        (current) =>
          current.id === message.id || current.clientMessageId === message.clientMessageId,
      );
      if (index >= 0) this.messages[index] = message;
      else this.messages.push(message);
    }
    this.messages.sort((left, right) =>
      left.sequenceNumber === right.sequenceNumber
        ? 0
        : BigInt(left.sequenceNumber) < BigInt(right.sequenceNumber)
          ? -1
          : 1,
    );
    this.renderMessages();
    if (scroll) this.scrollToLatest();
  }

  private renderMessages(): void {
    const list = this.element<HTMLOListElement>('[data-messages]');
    list.replaceChildren();
    for (const message of this.messages) {
      const item = document.createElement('li');
      item.className = `message ${message.senderType === 'VISITOR' ? 'outgoing' : 'incoming'}`;
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      const content = document.createElement('p');
      content.textContent = message.content ?? '';
      bubble.append(content);
      for (const attachment of message.attachments) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'attachment';
        button.textContent = `📎 ${attachment.originalFileName} · ${formatBytes(attachment.sizeBytes)}`;
        button.addEventListener(
          'click',
          () => void this.downloadAttachment(attachment.id, attachment.originalFileName),
        );
        bubble.append(button);
      }
      const meta = document.createElement('div');
      meta.className = 'message-meta';
      meta.textContent = message.failed
        ? 'Not sent'
        : message.pending
          ? 'Sending…'
          : `${formatTime(message.createdAt)}${message.senderType === 'VISITOR' ? ` · ${message.deliveryState.toLowerCase()}` : ''}`;
      bubble.append(meta);
      if (message.failed) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'retry';
        retry.textContent = 'Retry';
        retry.addEventListener('click', () => void this.submitMessage(message));
        bubble.append(retry);
      }
      item.append(bubble);
      list.append(item);
    }
  }

  private optimisticMessage(clientMessageId: string, content: string): PendingMessage {
    return {
      id: `pending:${clientMessageId}`,
      conversationId: this.conversationId ?? '',
      clientMessageId,
      sequenceNumber: `${Date.now()}000`,
      senderType: 'VISITOR',
      messageType: 'TEXT',
      content,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deliveryState: 'SENT',
      attachments: [],
      pending: true,
    };
  }

  private markDelivered(message: MessageResponse): void {
    if (!this.conversationId) return;
    void this.emit<MessageReceiptEvent>('message.delivered', {
      conversationId: this.conversationId,
      messageId: message.id,
    });
  }

  private markRead(): void {
    const latestAgent = [...this.messages]
      .reverse()
      .find((message) => message.senderType !== 'VISITOR' && !message.pending);
    if (!this.isOpen || !this.conversationId || !latestAgent) return;
    void this.emit<MessageReceiptEvent[]>('message.read', {
      conversationId: this.conversationId,
      throughSequence: latestAgent.sequenceNumber,
    });
  }

  private handleTypingInput(): void {
    if (!this.conversationId || !this.socket?.connected) return;
    const hasContent = this.element<HTMLTextAreaElement>('textarea').value.trim().length > 0;
    if (hasContent && !this.typingActive) {
      this.typingActive = true;
      void this.emit<TypingEvent>('typing.start', { conversationId: this.conversationId });
    }
    if (this.typingTimer) window.clearTimeout(this.typingTimer);
    if (!hasContent) this.stopTyping();
    else this.typingTimer = window.setTimeout(() => this.stopTyping(), 1_500);
  }

  private stopTyping(): void {
    if (this.typingTimer) window.clearTimeout(this.typingTimer);
    if (this.typingActive && this.conversationId)
      void this.emit<TypingEvent>('typing.stop', { conversationId: this.conversationId });
    this.typingActive = false;
  }

  private showTyping(event: TypingEvent): void {
    const indicator = this.element<HTMLElement>('[data-typing]');
    indicator.hidden = !event.typing;
    if (event.typing && event.expiresAt) {
      const delay = Math.max(0, new Date(event.expiresAt).getTime() - Date.now());
      window.setTimeout(() => {
        indicator.hidden = true;
      }, delay);
      this.scrollToLatest();
    }
  }

  private renderUnread(): void {
    window.dispatchEvent(
      new CustomEvent('bizchat:unread', { detail: { count: this.unreadCount } }),
    );
    const badge = this.element<HTMLElement>('[data-unread]');
    badge.hidden = this.unreadCount === 0;
    badge.textContent = String(Math.min(this.unreadCount, 99));
  }

  private emit<T>(event: string, input: unknown): Promise<SocketAck<T>> {
    return new Promise((resolve) => {
      if (!this.socket?.connected) {
        resolve({
          ok: false,
          error: { code: 'OFFLINE', message: 'Reconnect to send your message' },
        });
        return;
      }
      this.socket
        .timeout(10_000)
        .emit(event, input, (error: Error | null, response: SocketAck<T>) => {
          resolve(
            error
              ? {
                  ok: false,
                  error: { code: 'TIMEOUT', message: 'The request timed out. Please retry.' },
                }
              : response,
          );
        });
    });
  }

  private latestSequence(): string | undefined {
    return this.messages.filter((message) => !message.pending).at(-1)?.sequenceNumber;
  }
  private oldestSequence(): string | undefined {
    return this.messages.find((message) => !message.pending)?.sequenceNumber;
  }
  private updateEarlierButton(): void {
    this.element<HTMLElement>('[data-load-earlier]').hidden = !this.hasEarlier;
  }
  private conversationStorageKey(): string {
    return `bizchat:conversation:${this.businessPublicId}`;
  }
  private scrollToLatest(): void {
    requestAnimationFrame(() => {
      const body = this.element<HTMLElement>('[data-scroll]');
      body.scrollTop = body.scrollHeight;
    });
  }

  private setConnection(state: ConnectionState): void {
    this.element('[data-connection]').textContent = state;
    this.element('[data-connection-dot]').className = `dot ${state}`;
    const enabled = state === 'connected';
    this.element<HTMLTextAreaElement>('textarea').disabled = !enabled;
    this.element<HTMLButtonElement>('.send').disabled = !enabled;
    this.updateAttachmentControl();
  }

  private updateAttachmentControl(): void {
    this.element<HTMLButtonElement>('.attach').disabled =
      !this.conversationId || !this.socket?.connected || this.sending;
  }

  private async downloadAttachment(id: string, fileName: string): Promise<void> {
    try {
      const response = await fetch(`${this.apiUrl}/api/v1/widget/attachments/${id}/download`, {
        headers: { authorization: `Bearer ${this.widgetSessionToken}` },
      });
      if (!response.ok) throw new Error('The attachment is unavailable');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      this.setComposerNote(messageFrom(cause), true);
    }
  }

  private setComposerNote(message: string, error = false): void {
    const note = this.element<HTMLElement>('[data-composer-note]');
    note.textContent = message;
    note.classList.toggle('error-text', error);
  }

  private applyColor(color: string): void {
    this.element<HTMLElement>('.header').style.background = color;
    this.element<HTMLElement>('.launcher').style.background = color;
    this.element<HTMLElement>('.send').style.background = color;
  }

  private showError(message: string): void {
    window.dispatchEvent(new CustomEvent('bizchat:error', { detail: { message } }));
    this.setConnection('error');
    const error = this.element<HTMLElement>('[data-error]');
    error.textContent = message;
    error.hidden = false;
    this.element<HTMLElement>('[data-loading]').hidden = true;
    this.element<HTMLElement>('[data-chat]').hidden = true;
  }

  private element<T extends Element = HTMLElement>(selector: string): T {
    const found = this.shadow?.querySelector<T>(selector);
    if (!found) throw new Error(`Widget element missing: ${selector}`);
    return found;
  }
}

const chatIcon =
  '<svg aria-hidden="true" width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path></svg>';
const sendIcon =
  '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m22 2-7 20-4-9-9-4Z"></path><path d="M22 2 11 13"></path></svg>';
if (!customElements.get('bizchat-widget'))
  customElements.define('bizchat-widget', BizChatWidgetElement);
const loader =
  document.currentScript ??
  document.querySelector<HTMLScriptElement>('script[data-bizchat-loader]');
const business = loader?.dataset.business;
if (business && !document.querySelector(`bizchat-widget[business-id="${CSS.escape(business)}"]`)) {
  const widget = document.createElement('bizchat-widget');
  widget.setAttribute('business-id', business);
  if (loader?.nonce) widget.setAttribute('style-nonce', loader.nonce);
  if (loader?.dataset.api) widget.setAttribute('api-url', loader.dataset.api);
  document.body.append(widget);
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(value),
  );
}
export function formatBytes(value: number): string {
  return value < 1024 * 1024
    ? `${Math.max(1, Math.ceil(value / 1024))} KB`
    : `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
function messageFrom(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'This chat is unavailable';
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
    /* Storage may be unavailable in private contexts. */
  }
}
function safeStorageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* Storage may be unavailable in private contexts. */
  }
}

export interface BizChatBrowserApi {
  open(): void;
  close(): void;
  identify(identityToken: string): void;
  logout(): void;
}
declare global {
  interface Window {
    BizChat?: BizChatBrowserApi;
  }
}
function currentWidget(): BizChatWidgetElement {
  const widget = document.querySelector<BizChatWidgetElement>('bizchat-widget');
  if (!widget) throw new Error('Install the BizChat widget before using its API');
  return widget;
}
function replaceIdentity(token?: string): void {
  const previous = currentWidget();
  const replacement = document.createElement('bizchat-widget') as BizChatWidgetElement;
  for (const name of ['business-id', 'api-url', 'style-nonce']) {
    const value = previous.getAttribute(name);
    if (value) replacement.setAttribute(name, value);
  }
  replacement.setIdentity(token);
  const businessId = previous.getAttribute('business-id') ?? '';
  safeStorageRemove(`bizchat:visitor:${businessId}`);
  safeStorageRemove(`bizchat:conversation:${businessId}`);
  const opened = previous.opened;
  previous.replaceWith(replacement);
  if (opened) replacement.open();
}
window.BizChat = {
  open: () => currentWidget().open(),
  close: () => currentWidget().close(),
  identify: (token) => {
    if (typeof token !== 'string' || token.length > 2000 || token.length < 32)
      throw new Error('Invalid identity token');
    replaceIdentity(token);
  },
  logout: () => replaceIdentity(),
};
