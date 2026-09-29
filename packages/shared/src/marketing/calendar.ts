import { z } from 'zod';

/**
 * Content calendar of the marketing panel (docs/PAZARLAMA_MODULU.md 3.4).
 * Items are plans: they may point at an AI studio draft or a campaign, but
 * nothing is ever sent or published from the calendar.
 */

export const CALENDAR_STATUSES = ['PLANNED', 'DRAFTED', 'APPROVED', 'SENT', 'CANCELLED'] as const;
export type CalendarStatus = (typeof CALENDAR_STATUSES)[number];

export const CALENDAR_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP', 'AD_META', 'AD_GOOGLE', 'AD_LINKEDIN', 'SOCIAL', 'BLOG', 'LANDING', 'OTHER'] as const;
export type CalendarChannel = (typeof CALENDAR_CHANNELS)[number];

const DateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih YYYY-AA-GG biçiminde olmalı')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
  }, 'Geçersiz tarih');

export const CreateContentItemSchema = z
  .object({
    title: z.string().trim().min(1, 'Başlık giriniz').max(160),
    channel: z.enum(CALENDAR_CHANNELS),
    scheduledDate: DateOnly,
    status: z.enum(CALENDAR_STATUSES).default('PLANNED'),
    draftId: z.string().uuid().nullable().optional(),
    campaignId: z.string().uuid().nullable().optional(),
    ownerUserId: z.string().uuid().nullable().optional(),
    notes: z.string().trim().max(2_000).nullable().optional(),
  })
  .strict();
export type CreateContentItemInput = z.infer<typeof CreateContentItemSchema>;

export const UpdateContentItemSchema = CreateContentItemSchema.partial().strict();
export type UpdateContentItemInput = z.infer<typeof UpdateContentItemSchema>;

export const ContentItemsQuerySchema = z
  .object({
    from: DateOnly,
    to: DateOnly,
    status: z.enum(CALENDAR_STATUSES).optional(),
    channel: z.enum(CALENDAR_CHANNELS).optional(),
  })
  .strict()
  .refine((v) => v.from <= v.to, { message: 'Başlangıç bitişten sonra olamaz', path: ['to'] })
  .refine((v) => (new Date(`${v.to}T00:00:00Z`).getTime() - new Date(`${v.from}T00:00:00Z`).getTime()) / 86_400_000 <= 92, {
    message: 'En fazla 92 günlük aralık istenebilir',
    path: ['to'],
  });
export type ContentItemsQuery = z.infer<typeof ContentItemsQuerySchema>;

export interface ContentItemDTO {
  id: string;
  title: string;
  channel: CalendarChannel;
  scheduledDate: string;
  status: CalendarStatus;
  draftId: string | null;
  campaignId: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A platform campaign shown read-only on the calendar (its own screen owns its lifecycle). */
export interface CalendarCampaignDTO {
  id: string;
  name: string;
  status: string;
  channel: string | null;
  scheduledDate: string;
}

export interface ContentCalendarViewDTO {
  items: ContentItemDTO[];
  campaigns: CalendarCampaignDTO[];
}

export interface CalendarOwnerDTO {
  id: string;
  name: string;
}

/** Calendar channel that fits a draft kind (used by "Takvime ekle" in the AI studio). */
export function calendarChannelForDraftKind(kind: string): CalendarChannel {
  switch (kind) {
    case 'EMAIL':
    case 'SUBJECT_LINES':
    case 'CTA_VARIANTS':
      return 'EMAIL';
    case 'SMS':
      return 'SMS';
    case 'WHATSAPP':
      return 'WHATSAPP';
    case 'AD_META':
      return 'AD_META';
    case 'AD_GOOGLE_RSA':
      return 'AD_GOOGLE';
    case 'AD_LINKEDIN':
      return 'AD_LINKEDIN';
    case 'LANDING_BLOCK':
    case 'SEO_OUTLINE':
      return 'LANDING';
    default:
      return 'OTHER';
  }
}

/** Whether an item's date may still be changed by moving it in the calendar (sent and cancelled items are history). */
export function isCalendarItemMovable(status: CalendarStatus): boolean {
  return status === 'PLANNED' || status === 'DRAFTED' || status === 'APPROVED';
}

/** YYYY-MM-DD of a UTC date. */
export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Days of the month grid (Monday first) that covers `year`/`month` (1-12), as YYYY-MM-DD strings; always whole weeks. */
export function monthGridDates(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(year, month - 1, 1 - offset));
  const last = new Date(Date.UTC(year, month, 0));
  const total = Math.ceil((offset + last.getUTCDate()) / 7) * 7;
  return Array.from({ length: total }, (_, i) => toDateOnly(new Date(start.getTime() + i * 86_400_000)));
}

/** The seven dates (Monday first) of the week containing `date`. */
export function weekDates(date: string): string[] {
  const d = new Date(`${date}T00:00:00.000Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  const start = d.getTime() - offset * 86_400_000;
  return Array.from({ length: 7 }, (_, i) => toDateOnly(new Date(start + i * 86_400_000)));
}
