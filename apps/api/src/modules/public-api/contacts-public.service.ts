import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Contact } from '@platform/database';
import {
  PUBLIC_API_SOURCE_CHANNEL,
  REGION_CONSENT_RULES,
  complianceRegionOf,
  countryOfPhone,
  maskPhone,
  normalizePhone,
  splitContactName,
} from '@platform/shared';
import type {
  ContactConsentChannel,
  ContactCustomFields,
  PublicAddTagsInput,
  PublicApiErrorCode,
  PublicConsentResultDTO,
  PublicContactDTO,
  PublicContactUpsertResultDTO,
  PublicRecordConsentInput,
  PublicUpsertContactInput,
} from '@platform/shared';
import { Prisma } from '@platform/database';
import { PrismaService } from '../prisma/prisma.service';
import { ContactsService, dedupeTags } from '../crm/contacts/contacts.service';
import { GrowthEventsService } from '../crm/hooks/growth-events.service';
import { ContactConsentService } from '../notifications/consent/contact-consent.service';
import { ConsentConfirmationService } from '../notifications/consent/consent-confirmation.service';

const MAX_TAGS_PER_CONTACT = 50;

function apiError(status: HttpStatus, code: PublicApiErrorCode, message: string): HttpException {
  return new HttpException({ statusCode: status, code, message }, status);
}

/**
 * Inbound actions of automation tools on the public API (M4c, scope
 * crm.write): create or update a contact, add tags, record consent. Every
 * query carries the API key's studioId, phones are masked in every
 * response, consent goes through the M3e rules (legal basis, form version,
 * double opt-in) and every write is audit logged with the key id.
 */
@Injectable()
export class PublicContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly events: GrowthEventsService,
    private readonly consents: ContactConsentService,
    private readonly confirmations: ConsentConfirmationService,
  ) {}

  // -------------------------------------------------------------------------
  // POST /v1/public/contacts
  // -------------------------------------------------------------------------

  async upsert(studioId: string, apiKeyId: string, input: PublicUpsertContactInput): Promise<PublicContactUpsertResultDTO> {
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { countryCode: true } });
    const phone = input.phone ? normalizePhone(input.phone, studio.countryCode) : null;
    if (input.phone && !phone) throw new BadRequestException('Geçersiz telefon numarası');
    const email = input.email ? input.email.toLowerCase() : null;
    // Reject bad custom fields before anything is written.
    if (input.customFields) await this.contacts.validateCustomFields(studioId, input.customFields, {});

    const name = nameOf(input, email, phone);
    const { contact, created } = await this.contacts.resolveOrCreate(studioId, {
      firstName: name.firstName,
      lastName: name.lastName,
      phone,
      email,
      locale: input.locale ?? null,
      countryCode: input.countryCode ?? null,
      lifecycleStage: 'LEAD',
      sourceChannel: PUBLIC_API_SOURCE_CHANNEL,
      sourceDetail: input.sourceDetail ?? null,
      tags: dedupeTags(input.tags ?? []),
    });

    const explicitName = Boolean(input.firstName || input.fullName);
    const data: Prisma.ContactUncheckedUpdateInput = {};
    if (!created) {
      if (explicitName) {
        data.firstName = name.firstName.slice(0, 60);
        data.lastName = name.lastName.slice(0, 60);
      }
      if (input.locale) data.locale = input.locale;
      if (input.countryCode) data.countryCode = input.countryCode;
      if (input.tags?.length) data.tags = dedupeTags([...contact.tags, ...input.tags]).slice(0, MAX_TAGS_PER_CONTACT);
    }
    if (input.isBusiness !== undefined) data.isBusiness = input.isBusiness;
    if (input.customFields) {
      data.customFields = (await this.contacts.validateCustomFields(studioId, input.customFields, (contact.customFields ?? {}) as ContactCustomFields)) as Prisma.InputJsonValue;
    }
    const finalContact = Object.keys(data).length > 0 ? await this.prisma.contact.update({ where: { id: contact.id }, data }) : contact;

    if (!created && input.tags?.length) await this.emitTagEvents(studioId, contact, finalContact.tags);
    await this.audit(studioId, apiKeyId, 'public_api.contact.upsert', contact.id, { created, fields: Object.keys(input) });
    return { created, contact: toPublicContact(finalContact) };
  }

  // -------------------------------------------------------------------------
  // POST /v1/public/contacts/:id/tags
  // -------------------------------------------------------------------------

  async addTags(studioId: string, apiKeyId: string, contactId: string, input: PublicAddTagsInput): Promise<PublicContactDTO> {
    const contact = await this.findContact(studioId, contactId);
    const tags = dedupeTags([...contact.tags, ...input.tags]);
    if (tags.length > MAX_TAGS_PER_CONTACT) throw new UnprocessableEntityException(`Bir kişide en fazla ${MAX_TAGS_PER_CONTACT} etiket olabilir`);
    const updated = await this.prisma.contact.update({ where: { id: contact.id }, data: { tags } });
    await this.emitTagEvents(studioId, contact, tags);
    await this.audit(studioId, apiKeyId, 'public_api.contact.tags_add', contact.id, { added: tags.filter((t) => !contact.tags.includes(t)) });
    return toPublicContact(updated);
  }

  // -------------------------------------------------------------------------
  // POST /v1/public/contacts/:id/consents
  // -------------------------------------------------------------------------

  async recordConsent(studioId: string, apiKeyId: string, contactId: string, input: PublicRecordConsentInput): Promise<PublicConsentResultDTO> {
    const contact = await this.findContact(studioId, contactId);
    const channels = input.channels as ContactConsentChannel[];
    const countryCode = contact.countryCode ?? input.countryCode ?? countryOfPhone(contact.phone);
    let doubleOptIn = false;

    if (!input.granted) {
      for (const channel of channels) await this.consents.revoke(studioId, contact.id, channel, 'public-api');
    } else if (input.legalBasis === 'EXISTING_CUSTOMER') {
      // Derived at send time from the customer relationship; there is nothing to record.
      throw apiError(HttpStatus.UNPROCESSABLE_ENTITY, 'CONSENT_BASIS_NOT_ALLOWED', 'EXISTING_CUSTOMER dayanağı gönderim anında türetilir ve kaydedilemez');
    } else if (input.legalBasis === 'TR_MERCHANT_EXEMPTION') {
      const policy = await this.consents.policyFor(studioId);
      const region = complianceRegionOf(countryCode);
      if (!policy?.trMerchantExemptionEnabled || !contact.isBusiness || !REGION_CONSENT_RULES[region].merchantExemption) {
        throw apiError(HttpStatus.CONFLICT, 'CONSENT_BASIS_NOT_ALLOWED', 'Tacir muafiyeti bu kişi için uygulanamaz (ayar kapalı, kişi işletme değil veya bölge uygun değil)');
      }
      await this.consents.applyMerchantExemption(studioId, contact.id);
    } else {
      for (const channel of channels) {
        const hasAddress = channel === 'EMAIL' ? Boolean(contact.email) : Boolean(contact.phone);
        if (!hasAddress) throw apiError(HttpStatus.UNPROCESSABLE_ENTITY, 'CONSENT_CHANNEL_ADDRESS_MISSING', `Kişinin ${channel} kanalı için adresi yok`);
      }
      const result = await this.confirmations.afterFormConsent(studioId, contact.id, {
        channels,
        formVersion: input.formVersion ?? null,
        countryCode,
        locale: input.locale ?? contact.locale,
      });
      doubleOptIn = result.pending;
    }

    await this.audit(studioId, apiKeyId, 'public_api.contact.consent', contact.id, {
      channels,
      granted: input.granted,
      legalBasis: input.legalBasis,
      formVersion: input.formVersion ?? null,
      doubleOptIn,
    });
    const rows = await this.consents.listForContact(studioId, contact.id);
    return {
      contactId: contact.id,
      channels: rows
        .filter((r) => channels.includes(r.channel))
        .map((r) => ({ channel: r.channel, status: r.status, legalBasis: r.legalBasis, pendingConfirmation: r.confirmationPending, suppressed: r.suppressed })),
      doubleOptIn,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async findContact(studioId: string, contactId: string): Promise<Contact> {
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, studioId, mergedIntoId: null } });
    if (!contact) throw apiError(HttpStatus.NOT_FOUND, 'CONTACT_NOT_FOUND', 'Kişi bulunamadı');
    return contact;
  }

  private async emitTagEvents(studioId: string, before: Contact, tagsNow: readonly string[]): Promise<void> {
    const known = new Set(before.tags);
    const at = new Date();
    for (const tag of tagsNow.filter((t) => !known.has(t))) {
      await this.events.emit({ studioId, contactId: before.id, event: 'tag_added', ref: `tag:${tag}:${at.toISOString()}`, occurredAt: at, variables: { tag } });
    }
  }

  private async audit(studioId: string, apiKeyId: string, action: string, entityId: string, metadata: Record<string, unknown>): Promise<void> {
    await this.prisma.auditLog.create({
      data: { studioId, userId: null, action, entityType: 'Contact', entityId, metadata: { ...metadata, apiKeyId } as Prisma.InputJsonValue },
    });
  }
}

/** First and last name from the request; a request with no name uses the local part of the e-mail or the phone, never invented text. */
function nameOf(input: PublicUpsertContactInput, email: string | null, phone: string | null): { firstName: string; lastName: string } {
  if (input.firstName) return { firstName: input.firstName, lastName: input.lastName ?? '' };
  if (input.fullName) return splitContactName(input.fullName);
  const fallback = (email ? email.split('@')[0] : phone) ?? '';
  return { firstName: fallback.slice(0, 60), lastName: input.lastName ?? '' };
}

function toPublicContact(c: Contact): PublicContactDTO {
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone ? maskPhone(c.phone) : null,
    tags: c.tags,
    lifecycleStage: c.lifecycleStage,
    createdAt: c.createdAt.toISOString(),
  };
}
