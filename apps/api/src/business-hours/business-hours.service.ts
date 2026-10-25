import { Injectable } from '@nestjs/common';
import type { BusinessHoursResponse } from '@bizchat/types';
import type { UpdateBusinessHoursInput } from '@bizchat/validation';
import { AuditService, auditActor } from '../audit/audit.service';
import type { AuthContext } from '../common/http.types';
import { PrismaService } from '../database/prisma.service';

const DEFAULT_HOURS = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  openingTime: '09:00',
  closingTime: '17:00',
  isClosed: weekday === 0 || weekday === 6,
}));

@Injectable()
export class BusinessHoursService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  public async get(businessId: string, timezone: string): Promise<BusinessHoursResponse> {
    const hours = await this.prisma.businessHour.findMany({
      where: { businessId },
      orderBy: { weekday: 'asc' },
    });
    const serialized =
      hours.length === 7
        ? hours.map((hour) => ({
            weekday: hour.weekday,
            openingTime: this.toTime(hour.openingMinute),
            closingTime: this.toTime(hour.closingMinute),
            isClosed: hour.isClosed,
          }))
        : DEFAULT_HOURS;
    return {
      timezone,
      isOpenNow: hours.length === 0 || this.isOpen(hours, timezone),
      hours: serialized,
    };
  }

  public async update(
    auth: AuthContext,
    input: UpdateBusinessHoursInput,
    requestId: string,
    ipAddress?: string,
  ): Promise<BusinessHoursResponse> {
    await this.prisma.$transaction(
      input.hours.map((hour) =>
        this.prisma.businessHour.upsert({
          where: { businessId_weekday: { businessId: auth.business.id, weekday: hour.weekday } },
          update: {
            openingMinute: this.toMinute(hour.openingTime),
            closingMinute: this.toMinute(hour.closingTime),
            isClosed: hour.isClosed,
          },
          create: {
            businessId: auth.business.id,
            weekday: hour.weekday,
            openingMinute: this.toMinute(hour.openingTime),
            closingMinute: this.toMinute(hour.closingTime),
            isClosed: hour.isClosed,
          },
        }),
      ),
    );
    await this.audit.record({
      businessId: auth.business.id,
      ...auditActor(auth),
      action: 'business.hours_updated',
      targetType: 'Business',
      targetId: auth.business.id,
      requestId,
      ipAddress,
      metadata: { hours: input.hours },
    });
    return this.get(auth.business.id, auth.business.timezone);
  }

  /** Whether the tenant is open now in its own timezone; a tenant without hours is always open. */
  public async isOpenNow(businessId: string): Promise<boolean> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { timezone: true },
    });
    return business ? this.isBusinessOpen(businessId, business.timezone) : false;
  }

  public async isBusinessOpen(businessId: string, timezone: string): Promise<boolean> {
    const hours = await this.prisma.businessHour.findMany({ where: { businessId } });
    return hours.length === 0 || this.isOpen(hours, timezone);
  }

  private isOpen(
    hours: { weekday: number; openingMinute: number; closingMinute: number; isClosed: boolean }[],
    timezone: string,
  ): boolean {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    const weekdays: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const weekday = weekdays[parts.find(({ type }) => type === 'weekday')?.value ?? 'Sun'] ?? 0;
    const minute =
      Number(parts.find(({ type }) => type === 'hour')?.value ?? 0) * 60 +
      Number(parts.find(({ type }) => type === 'minute')?.value ?? 0);
    const today = hours.find((hour) => hour.weekday === weekday);
    if (today && !today.isClosed) {
      if (
        today.openingMinute < today.closingMinute &&
        minute >= today.openingMinute &&
        minute < today.closingMinute
      )
        return true;
      if (today.openingMinute > today.closingMinute && minute >= today.openingMinute) return true;
    }
    const previous = hours.find((hour) => hour.weekday === (weekday + 6) % 7);
    return Boolean(
      previous &&
      !previous.isClosed &&
      previous.openingMinute > previous.closingMinute &&
      minute < previous.closingMinute,
    );
  }

  private toMinute(value: string): number {
    const segments = value.split(':').map(Number);
    return (segments[0] ?? 0) * 60 + (segments[1] ?? 0);
  }
  private toTime(value: number): string {
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  }
}
