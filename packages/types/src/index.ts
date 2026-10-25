export const businessRoles = ['OWNER', 'ADMIN', 'SUPERVISOR', 'CONSULTANT'] as const;
export type BusinessRole = (typeof businessRoles)[number];

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
}

export interface AuthenticatedBusiness {
  id: string;
  name: string;
  slug: string;
  publicId: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'TRIAL';
  timezone: string;
  defaultLocale: string;
}

export type DomainStatus = 'PENDING' | 'VERIFIED' | 'DISABLED';

export interface BusinessDomainResponse {
  id: string;
  domain: string;
  status: DomainStatus;
  verifiedAt: string | null;
  createdAt: string;
  verification?: {
    recordName: string;
    recordType: 'TXT';
    recordValue: string;
  };
}

export interface WidgetPublicConfig {
  businessName: string;
  primaryColor: string;
  greeting: string;
  launcherPosition: 'BOTTOM_RIGHT' | 'BOTTOM_LEFT';
  departmentSelectionEnabled: boolean;
  queueMessage: string;
  offlineMessage: string;
  resolvedMessage: string;
}

export interface BusinessHourResponse {
  weekday: number;
  openingTime: string;
  closingTime: string;
  isClosed: boolean;
}

export interface BusinessHoursResponse {
  timezone: string;
  isOpenNow: boolean;
  hours: BusinessHourResponse[];
}

export type MembershipStatus = 'ACTIVE' | 'INVITED' | 'DISABLED';
export interface BusinessUserResponse {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string;
  role: BusinessRole;
  status: MembershipStatus;
  lastLoginAt: string | null;
  agentProfileId: string;
  maxConcurrentChats: number;
  routingEnabled: boolean;
  departmentIds: string[];
  skills: AgentSkillResponse[];
  createdAt: string;
}

export interface SkillResponse {
  id: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'DISABLED';
  consultantCount: number;
  createdAt: string;
  updatedAt: string;
}

/** A consultant's skill with proficiency from 1 (basic) to 5 (expert). */
export interface AgentSkillResponse {
  skillId: string;
  proficiency: number;
}

export type RoutingStrategy = 'LEAST_BUSY' | 'BEST_SKILL';
export type AssignmentMode = 'AUTO' | 'OFFER';
export interface RoutingSettingsResponse {
  routingStrategy: RoutingStrategy;
  assignmentMode: AssignmentMode;
  offerTimeoutSeconds: number;
  /** Consecutive missed offers before a consultant is set away; 0 disables. */
  missedOffersBeforeAway: number;
  exclusionSeconds: number;
  /** Classifier confidence at or above this routes without asking the visitor. */
  autoRouteThreshold: number;
  /** Below this the visitor is asked to choose a topic; in between they may change it. */
  confirmThreshold: number;
  topicPromptTimeoutSeconds: number;
  intakeFormTiming: 'AFTER_TOPIC' | 'BEFORE_CHAT';
  defaultIntakeFormId: string | null;
}

export type IntakeStatus = 'NOT_REQUIRED' | 'AWAITING_TOPIC' | 'AWAITING_FORM' | 'COMPLETE';
export type ClassificationDecision = 'ROUTE' | 'CONFIRM' | 'ASK';

export interface TopicKeyword {
  phrase: string;
  /** 1-5; defaults to 1 for a word and 2 for a phrase of several words. */
  weight?: number;
}

export interface TopicResponse {
  id: string;
  publicId: string;
  name: string;
  description: string | null;
  departmentId: string | null;
  requiredSkillId: string | null;
  requiredSkillMinProficiency: number | null;
  priority: ConversationPriority;
  keywords: TopicKeyword[];
  negativeKeywords: string[];
  examples: string[];
  showAsQuickReply: boolean;
  isDefault: boolean;
  status: 'ACTIVE' | 'DISABLED';
  sortOrder: number;
  intakeFormId: string | null;
  overflowSteps: OverflowStep[];
  maxWaitSeconds: number | null;
  createdAt: string;
  updatedAt: string;
}

/** A timed widening of who may take a queued conversation; steps apply cumulatively. */
export interface OverflowStep {
  afterSeconds: number;
  addDepartmentIds: string[];
  relaxSkill: boolean;
  anyConsultant: boolean;
}

export interface FollowUpContact {
  name: string | null;
  email: string | null;
  phone: string | null;
  note: string | null;
}

/** Sent to a waiting visitor when the topic's maximum wait passes. */
export interface ConversationWaitOptionsEvent {
  conversationId: string;
  reason: 'MAX_WAIT';
}

/** Durations in seconds over the conversations that reached the measured point. */
export interface AnalyticsDuration {
  count: number;
  medianSeconds: number | null;
  p90Seconds: number | null;
  averageSeconds: number | null;
}

export interface AnalyticsBreakdownRow {
  id: string | null;
  name: string;
  conversations: number;
  medianWaitSeconds: number | null;
}

/**
 * Reporting over conversations created in a date range (the tenant's local days). Every figure
 * refers to that cohort, so a chat created on the last day and resolved later still counts.
 */
export interface AnalyticsOverviewResponse {
  from: string;
  to: string;
  timezone: string;
  totals: {
    conversations: number;
    assigned: number;
    resolved: number;
    abandoned: number;
    followUps: number;
    overflowed: number;
  };
  daily: { date: string; created: number; resolved: number; abandoned: number }[];
  waitToAssignment: AnalyticsDuration;
  firstResponse: AnalyticsDuration;
  handleTime: AnalyticsDuration;
  offers: {
    offered: number;
    accepted: number;
    declined: number;
    expired: number;
    cancelled: number;
    acceptRate: number | null;
  };
  bySource: { source: ConversationSource; conversations: number }[];
  byTopic: AnalyticsBreakdownRow[];
  byDepartment: AnalyticsBreakdownRow[];
  classification: {
    classified: number;
    autoRouted: number;
    confirmed: number;
    asked: number;
    defaulted: number;
    /** Automatically routed or confirmed chats whose topic the visitor then changed. */
    changedByVisitor: number;
  };
}

export interface ConsultantAnalyticsRow {
  agentProfileId: string;
  displayName: string;
  assigned: number;
  resolved: number;
  firstResponse: AnalyticsDuration;
  offers: { offered: number; accepted: number; declined: number; expired: number };
}

export interface TopicTestResponse {
  decision: ClassificationDecision;
  confidence: number;
  topic: { id: string; name: string } | null;
  candidates: { topicId: string; name: string; score: number }[];
}

/** A topic a visitor can pick in the widget. */
export interface WidgetTopic {
  publicId: string;
  name: string;
}

/**
 * Sent with the conversation when the visitor should pick a topic (`ASK`, routing waits) or may
 * change the one chosen for them (`CONFIRM`, already routing).
 */
export interface IntakePrompt {
  /** TOPIC: choose a topic. FORM: complete the pre-chat form; routing waits. */
  step: 'TOPIC' | 'FORM';
  mode: 'ASK' | 'CONFIRM';
  topics: WidgetTopic[];
  selectedTopic: WidgetTopic | null;
  expiresAt: string | null;
  form?: WidgetIntakeForm;
}

export type IntakeFieldType = 'TEXT' | 'EMAIL' | 'PHONE' | 'SELECT' | 'REFERENCE';
export type IntakePrefillClaim = 'name' | 'email';

/** A pre-chat form field as configured by the business. */
export interface IntakeFormField {
  /** Stable answer key, e.g. `registration_number`. */
  key: string;
  label: string;
  type: IntakeFieldType;
  required: boolean;
  maxLength?: number;
  /** SELECT choices. */
  options?: string[];
  /** REFERENCE format: `#` digit, `A` letter, `*` letter or digit, anything else literal. */
  mask?: string;
  /** Filled from a signed customer identity claim and skipped when present. */
  prefillFrom?: IntakePrefillClaim;
}

export interface IntakeFormResponse {
  id: string;
  name: string;
  version: number;
  fields: IntakeFormField[];
  consentText: string | null;
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
  updatedAt: string;
}

/** A form as the widget shows it; prefilled fields carry their value. */
export interface WidgetIntakeForm {
  name: string;
  consentText: string | null;
  fields: (Omit<IntakeFormField, 'prefillFrom'> & { value?: string })[];
}

export interface IntakeAnswer {
  key: string;
  label: string;
  value: string;
}

/** Submitted pre-chat answers, visible to consultants handling the conversation. */
export interface ConversationIntakeResponse {
  formName: string | null;
  formVersion: number;
  answers: IntakeAnswer[];
  consentAt: string | null;
  submittedAt: string;
}

/** Result of a visitor topic or form submission: routed, or the next intake step. */
export interface IntakeSubmitResult {
  routed: ConversationRoutingEvent | null;
  intake: IntakePrompt | null;
}

/** A conversation offered to one consultant, who must accept before `expiresAt`. */
export interface ConversationOfferEvent {
  offerId: string;
  conversation: ConversationResponse;
  firstMessage: string | null;
  intake: ConversationIntakeResponse | null;
  offeredAt: string;
  expiresAt: string;
}

export interface ConversationOfferWithdrawnEvent {
  offerId: string;
  conversationId: string;
  reason: 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'CANCELLED';
}

export interface AgentNoticeEvent {
  code: 'SET_AWAY_AFTER_MISSED_OFFERS';
  message: string;
}

export interface AuditLogResponse {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  actor: { id: string; displayName: string; email: string } | null;
  requestId: string | null;
  ipAddress: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface AuditLogPage {
  logs: AuditLogResponse[];
  nextCursor: string | null;
}

export interface WidgetSettingsResponse extends WidgetPublicConfig {
  businessPublicId: string;
  enabled: boolean;
  preferPreviousConsultant: boolean;
  reopenWindowMinutes: number;
  agentDisconnectGraceSeconds: number;
}

export interface WidgetBootstrapResponse {
  conversationId?: string;
  visitorToken: string;
  widgetSessionToken: string;
  widgetSessionExpiresAt: string;
  availability: 'UNKNOWN' | 'ONLINE' | 'OFFLINE';
  config: WidgetPublicConfig;
  departments: WidgetDepartment[];
  /** Topics offered as buttons before the first message; empty when the tenant has none. */
  topics: WidgetTopic[];
  /** The form to complete before the first message (BEFORE_CHAT timing only). */
  form?: WidgetIntakeForm;
}

export interface WidgetDepartment {
  publicId: string;
  name: string;
}

export type DepartmentStatus = 'ACTIVE' | 'DISABLED';
export interface DepartmentResponse {
  id: string;
  publicId: string;
  name: string;
  description: string | null;
  status: DepartmentStatus;
  isDefault: boolean;
  agentProfileIds: string[];
  activeConversations: number;
  queuedConversations: number;
  createdAt: string;
  updatedAt: string;
}

export interface WidgetConnectedEvent {
  connectedAt: string;
  sessionExpiresAt: string;
}

export type ConversationStatus =
  | 'NEW'
  | 'QUEUED'
  | 'OFFERED'
  | 'ASSIGNED'
  | 'ACTIVE'
  | 'WAITING_FOR_CUSTOMER'
  | 'WAITING_FOR_AGENT'
  | 'RESOLVED'
  | 'CLOSED';
export type ConversationPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type ConversationSource =
  | 'INTEGRATION'
  | 'WEB_WIDGET'
  | 'WHATSAPP'
  | 'EMAIL'
  | 'FACEBOOK'
  | 'INSTAGRAM'
  | 'SMS'
  | 'MOBILE_APP';
export type MessageSenderType = 'VISITOR' | 'CUSTOMER' | 'AGENT' | 'SYSTEM' | 'INTEGRATION';
export type MessageType = 'TEXT' | 'IMAGE' | 'FILE' | 'SYSTEM_EVENT' | 'INTERNAL_NOTE';

export type AttachmentStatus = 'UPLOADING' | 'PROCESSING' | 'READY' | 'REJECTED';
export interface AttachmentResponse {
  id: string;
  messageId: string | null;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  status: AttachmentStatus;
  downloadUrl: string;
  createdAt: string;
}

export interface ConversationResponse {
  id: string;
  status: ConversationStatus;
  priority: ConversationPriority;
  source: ConversationSource;
  subject: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  assignedAgentMembershipId: string | null;
  departmentId: string | null;
  departmentName: string | null;
  topicId: string | null;
  topicName: string | null;
  intakeStatus: IntakeStatus;
  overflowLevel: number;
  maxWaitReachedAt: string | null;
  followUpRequestedAt: string | null;
  followUpContact: FollowUpContact | null;
  queuedAt: string | null;
  queuePosition: number | null;
  resolvedAt: string | null;
  reopenedAt: string | null;
  tags: TagResponse[];
  lastMessagePreview: string | null;
  unreadCount: number;
}

export type AgentPresenceState = 'ONLINE' | 'BUSY' | 'AWAY' | 'OFFLINE' | 'DO_NOT_DISTURB';
export type AgentProfileStatus = 'ACTIVE' | 'DISABLED';

export interface AgentProfileResponse {
  id: string;
  membershipId: string;
  user: { id: string; displayName: string; email: string };
  maxConcurrentChats: number;
  routingEnabled: boolean;
  status: AgentProfileStatus;
  presence: AgentPresenceState;
  activeChats: number;
  departmentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentConnectedEvent {
  connectedAt: string;
  profile: AgentProfileResponse;
  restoredConversationIds: string[];
}

export interface AgentPresenceEvent {
  agentProfileId: string;
  membershipId: string;
  displayName: string;
  state: AgentPresenceState;
  activeChats: number;
  maxConcurrentChats: number;
  changedAt: string;
}

export interface BusinessAvailabilityEvent {
  availability: 'ONLINE' | 'OFFLINE';
  onlineAgents: number;
  changedAt: string;
}

export interface ConversationRoutingEvent {
  conversation: ConversationResponse;
  outcome: 'ASSIGNED' | 'QUEUED' | 'OFFERED';
  assignedAgentMembershipId: string | null;
  queuedAt: string | null;
  queuePosition: number | null;
}

export type ConversationRecoveryState =
  'DISCONNECTED_GRACE' | 'RESTORED' | 'REASSIGNING' | 'RETRY_SCHEDULED';

export interface ConversationRecoveryEvent {
  conversationId: string;
  state: ConversationRecoveryState;
  assignedAgentMembershipId: string | null;
  graceExpiresAt: string | null;
  attempt: number;
  changedAt: string;
}

export type ConversationEventType =
  | 'CREATED'
  | 'QUEUED'
  | 'ASSIGNED'
  | 'ACCEPTED'
  | 'TRANSFERRED'
  | 'REASSIGNED'
  | 'RESOLVED'
  | 'REOPENED'
  | 'CLOSED'
  | 'AGENT_JOINED'
  | 'AGENT_LEFT'
  | 'TAGS_CHANGED'
  | 'INTERNAL_NOTE_ADDED'
  | 'OFFERED'
  | 'TOPIC_SET'
  | 'OVERFLOWED'
  | 'MAX_WAIT_REACHED'
  | 'FOLLOW_UP_REQUESTED';

export interface ConversationEventResponse {
  id: string;
  conversationId: string;
  type: ConversationEventType;
  actorType: 'BUSINESS_USER' | 'VISITOR' | 'SYSTEM' | 'INTEGRATION';
  actorId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ConversationOperationEvent {
  conversation: ConversationResponse;
  event: ConversationEventResponse;
  operation:
    | 'TRANSFERRED'
    | 'RESOLVED'
    | 'REOPENED'
    | 'TAGS_CHANGED'
    | 'ABANDONED'
    | 'OVERFLOWED'
    | 'FOLLOW_UP_REQUESTED';
  previousAssignedAgentMembershipId: string | null;
  assignedAgentMembershipId: string | null;
}

export interface TagResponse {
  id: string;
  name: string;
  color: string;
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
  updatedAt: string;
}

export interface CannedResponseResponse {
  id: string;
  departmentId: string | null;
  departmentName: string | null;
  title: string;
  content: string;
  shortcut: string | null;
  status: 'ACTIVE' | 'DISABLED';
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TypingEvent {
  conversationId: string;
  participantType: 'VISITOR' | 'AGENT';
  participantId: string;
  displayName: string | null;
  typing: boolean;
  expiresAt: string | null;
}

export interface VisitorPresenceEvent {
  conversationId: string;
  state: 'ONLINE' | 'OFFLINE';
  changedAt: string;
}

export interface MessageResponse {
  id: string;
  conversationId: string;
  clientMessageId: string;
  sequenceNumber: string;
  senderType: MessageSenderType;
  messageType: MessageType;
  content: string | null;
  createdAt: string;
  editedAt: string | null;
  deliveryState: 'SENT' | 'DELIVERED' | 'READ';
  attachments: AttachmentResponse[];
}

export interface MessagePage {
  messages: MessageResponse[];
  hasMore: boolean;
  oldestSequence: string | null;
  latestSequence: string | null;
}

export interface ConversationPage {
  conversations: ConversationResponse[];
  nextCursor: string | null;
}

export interface ConversationSessionResponse {
  conversation: ConversationResponse;
  message?: MessageResponse;
  history: MessagePage;
  intake?: IntakePrompt;
}

export type SocketAck<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

export interface MessageReceiptEvent {
  conversationId: string;
  messageId: string;
  state: 'DELIVERED' | 'READ';
  at: string;
}

export interface AuthSessionResponse {
  user: AuthenticatedUser;
  business: AuthenticatedBusiness;
  membership: { id: string; role: BusinessRole };
}

export interface ApiErrorBody {
  error: { code: string; message: string; requestId: string; details?: unknown };
}
