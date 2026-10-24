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
export interface RoutingSettingsResponse {
  routingStrategy: RoutingStrategy;
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
  outcome: 'ASSIGNED' | 'QUEUED';
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
  | 'INTERNAL_NOTE_ADDED';

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
  operation: 'TRANSFERRED' | 'RESOLVED' | 'REOPENED' | 'TAGS_CHANGED' | 'ABANDONED';
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
