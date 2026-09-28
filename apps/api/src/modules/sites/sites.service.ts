import { randomBytes } from 'crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { isValidDomain, expectedDnsRecords } from '@platform/shared';
import type { SiteDTO, SiteDomainDTO, UpdateSiteInput } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { DnsVerificationService } from './dns.service';

/** Base domain tenant sites are served on as `<slug>.<SITES_DOMAIN>`. */
export function sitesBaseDomain(): string {
  return process.env.SITES_DOMAIN ?? process.env.WEB_DOMAIN ?? 'localhost';
}

/** The CNAME target a custom domain must point at (Caddy's public host). */
export function platformCnameTarget(): string {
  return sitesBaseDomain();
}

function toDomainDto(d: { id: string; domain: string; status: string; verificationToken: string; verifiedAt: Date | null }): SiteDomainDTO {
  return {
    id: d.id,
    domain: d.domain,
    status: d.status as SiteDomainDTO['status'],
    verificationToken: d.verificationToken,
    verifiedAt: d.verifiedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class SitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dns: DnsVerificationService,
  ) {}

  /** Every studio may have at most one site; it is created lazily on first access. */
  async ensureSite(studioId: string): Promise<SiteDTO> {
    const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { isPlatform: true, defaultLocale: true } });
    if (!studio) throw new NotFoundException('İşletme bulunamadı');
    let site = await this.prisma.site.findUnique({ where: { studioId }, include: { domains: true } });
    if (!site) {
      site = await this.prisma.site.create({
        data: {
          studioId,
          kind: studio.isPlatform ? 'PLATFORM' : 'TENANT',
          defaultLocale: studio.defaultLocale,
          enabledLocales: [studio.defaultLocale],
        },
        include: { domains: true },
      });
    }
    return this.toSiteDto(site);
  }

  async updateSite(studioId: string, input: UpdateSiteInput): Promise<SiteDTO> {
    const site = await this.getSiteOrThrow(studioId);
    if (input.enabledLocales && !input.enabledLocales.includes(input.defaultLocale ?? site.defaultLocale)) {
      throw new BadRequestException('Varsayılan dil, etkin diller listesinde olmalıdır');
    }
    const updated = await this.prisma.site.update({
      where: { id: site.id },
      data: {
        defaultLocale: input.defaultLocale,
        enabledLocales: input.enabledLocales,
        primaryDomain: input.primaryDomain === undefined ? undefined : input.primaryDomain,
      },
      include: { domains: true },
    });
    return this.toSiteDto(updated);
  }

  async addDomain(studioId: string, domain: string): Promise<SiteDomainDTO> {
    if (!isValidDomain(domain)) throw new BadRequestException('Geçersiz alan adı');
    const site = await this.getSiteOrThrow(studioId);
    const existing = await this.prisma.siteDomain.findUnique({ where: { domain } });
    if (existing) throw new ConflictException('Bu alan adı zaten kullanımda');
    const created = await this.prisma.siteDomain.create({
      data: { siteId: site.id, domain, verificationToken: randomBytes(20).toString('hex') },
    });
    return toDomainDto(created);
  }

  async removeDomain(studioId: string, domainId: string): Promise<void> {
    const site = await this.getSiteOrThrow(studioId);
    const domain = await this.prisma.siteDomain.findFirst({ where: { id: domainId, siteId: site.id } });
    if (!domain) throw new NotFoundException('Alan adı bulunamadı');
    await this.prisma.siteDomain.delete({ where: { id: domainId } });
  }

  dnsInstructions(domain: string, verificationToken: string) {
    return expectedDnsRecords(domain, verificationToken, platformCnameTarget());
  }

  async verifyDomain(studioId: string, domainId: string): Promise<SiteDomainDTO> {
    const site = await this.getSiteOrThrow(studioId);
    const domain = await this.prisma.siteDomain.findFirst({ where: { id: domainId, siteId: site.id } });
    if (!domain) throw new NotFoundException('Alan adı bulunamadı');
    const ok = await this.dns.verify(domain.domain, domain.verificationToken, platformCnameTarget());
    const updated = await this.prisma.siteDomain.update({
      where: { id: domainId },
      data: { status: ok ? 'VERIFIED' : 'FAILED', verifiedAt: ok ? new Date() : null },
    });
    return toDomainDto(updated);
  }

  /** Used by the public "ask" endpoint for Caddy on-demand TLS. */
  async isVerifiedActiveDomain(domain: string): Promise<boolean> {
    const row = await this.prisma.siteDomain.findFirst({
      where: { domain, status: 'VERIFIED' },
      include: { site: { include: { studio: { select: { isActive: true } } } } },
    });
    return !!row && row.site.studio.isActive;
  }

  private async getSiteOrThrow(studioId: string) {
    const site = await this.prisma.site.findUnique({ where: { studioId }, include: { domains: true } });
    if (!site) throw new NotFoundException('Bu işletme için henüz bir web sitesi yok');
    return site;
  }

  private toSiteDto(site: { id: string; kind: string; primaryDomain: string | null; defaultLocale: string; enabledLocales: string[]; domains: Array<{ id: string; domain: string; status: string; verificationToken: string; verifiedAt: Date | null }> }): SiteDTO {
    return {
      id: site.id,
      kind: site.kind as SiteDTO['kind'],
      primaryDomain: site.primaryDomain,
      defaultLocale: site.defaultLocale,
      enabledLocales: site.enabledLocales,
      domains: site.domains.map(toDomainDto),
    };
  }
}
