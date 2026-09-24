import { lookup } from 'dns/promises';
import { BadRequestException } from '@nestjs/common';
import { isPrivateOrReservedIp } from './ssrf-guard';

/**
 * Resolves `hostname` and rejects when it is not https, or any resolved
 * address is private/loopback/link-local/reserved. Called both when a
 * WebhookEndpoint is created or updated (assertPublicHttpsHostname) and
 * again immediately before every delivery attempt (webhook-dispatcher.service.ts)
 * so a hostname that resolved to a public address at creation time but has
 * since been re-pointed at an internal one (DNS rebinding) is still caught.
 */
export async function assertPublicHttpsHostname(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BadRequestException('Geçersiz webhook adresi');
  }
  if (url.protocol !== 'https:') {
    throw new BadRequestException('Webhook adresi https:// ile başlamalıdır');
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    throw new BadRequestException('Webhook adresinin sunucusu çözümlenemedi');
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateOrReservedIp(a.address))) {
    throw new BadRequestException('Webhook adresi özel veya ayrılmış bir IP adresine işaret edemez');
  }
}
