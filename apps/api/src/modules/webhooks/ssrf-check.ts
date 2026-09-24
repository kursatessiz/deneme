import { lookup } from 'dns/promises';
import { BadRequestException } from '@nestjs/common';
import { isPrivateOrReservedIp } from './ssrf-guard';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/**
 * Resolves `hostname` and rejects when it is not https, or any resolved
 * address is private/loopback/link-local/reserved. Returns every validated
 * address so a caller that is about to open a connection (the dispatcher)
 * can pin it to one of them instead of re-resolving the hostname a second
 * time -- re-resolving would let an attacker who controls the hostname's
 * DNS swap in a private address between this check and the actual TCP
 * connect (DNS rebinding), which a hostname-only check cannot catch no
 * matter how many times it repeats the check.
 */
export async function resolvePublicHttpsAddresses(rawUrl: string): Promise<ResolvedAddress[]> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BadRequestException('Geçersiz webhook adresi');
  }
  if (url.protocol !== 'https:') {
    throw new BadRequestException('Webhook adresi https:// ile başlamalıdır');
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    throw new BadRequestException('Webhook adresinin sunucusu çözümlenemedi');
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateOrReservedIp(a.address))) {
    throw new BadRequestException('Webhook adresi özel veya ayrılmış bir IP adresine işaret edemez');
  }
  return addresses.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
}

/** Validates a webhook URL without needing the resolved addresses back (endpoint create/update). */
export async function assertPublicHttpsHostname(rawUrl: string): Promise<void> {
  await resolvePublicHttpsAddresses(rawUrl);
}
