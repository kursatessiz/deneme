import { COMMUNITY_ERROR_CODES } from '@platform/shared';
import type { AccessTierRuleDTO, Translate } from '@platform/shared';
import { BffError } from '@/lib/session/client';

/** A community API error in the viewer's language: the stable `code` first, then the API text. */
export function communityErrorMessage(err: unknown, t: Translate): string {
  if (err instanceof BffError) {
    if (err.code && (COMMUNITY_ERROR_CODES as readonly string[]).includes(err.code)) return t(`community.error.${err.code}`);
    return err.message;
  }
  return t('community.error.generic');
}

/** One line per tier rule; package names are tenant data and are not translated. */
export function tierRuleLabel(t: Translate, rule: AccessTierRuleDTO): string {
  if (rule.kind === 'PACKAGE_DEFINITION') return t('community.tiers.rule.PACKAGE_DEFINITION', { name: rule.packageDefinitionName ?? '' });
  return t(`community.tiers.rule.${rule.kind}`);
}

/** The public share page URL for a token, on the current origin. */
export function shareUrl(token: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}/paylasim/${encodeURIComponent(token)}`;
}
