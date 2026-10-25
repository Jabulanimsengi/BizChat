import type { BusinessRole, BusinessStatus, MembershipStatus, UserStatus } from '@prisma/client';
import type { Request } from 'express';

export interface AuthContext {
  sessionId: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    status: UserStatus;
    emailVerified: boolean;
  };
  membership: { id: string; role: BusinessRole; status: MembershipStatus };
  business: {
    id: string;
    name: string;
    slug: string;
    publicId: string;
    status: BusinessStatus;
    timezone: string;
    defaultLocale: string;
  };
  /**
   * Set when the caller is an integration key using the setup API rather than a signed-in person.
   * There is then no user or membership: their IDs are empty and audit records name the key.
   */
  integrationKeyId?: string;
}

export interface AuthenticatedRequest extends Request {
  auth: AuthContext;
  requestId: string;
}

export interface RequestWithId extends Request {
  requestId: string;
}
