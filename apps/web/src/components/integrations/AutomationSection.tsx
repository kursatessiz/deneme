'use client';

import type { IntegrationHubDTO, MessageKey } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import { Badge } from '@/components/common/Badge';
import { Section } from '@/components/settings/ui';
import { HubTable } from './HubTable';

/** Event names contain a dot; message keys use an underscore in its place. */
const eventKey = (event: string): MessageKey => `automationHub.event.${event.replace('.', '_')}` as MessageKey;

/**
 * Automation block (M4c): the platform events an automation tool can
 * subscribe to and how many active subscriptions each has, plus the number
 * of API keys allowed to write contacts. Subscriptions themselves are the
 * webhook rows listed above; nothing secret appears here.
 */
export function AutomationSection({ data }: { data: IntegrationHubDTO }) {
  const t = useT();
  return (
    <Section title={t('automationHub.title')} description={t('automationHub.description')}>
      <HubTable head={[t('automationHub.events'), '', t('automationHub.subscriptions')]}>
        {data.automation.platformEvents.map((e) => (
          <tr key={e.event} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
            <td className="py-2 pr-3 font-mono text-xs">{e.event}</td>
            <td className="py-2 pr-3 text-sm">{t(eventKey(e.event))}</td>
            <td className="py-2">
              <Badge tone={e.activeSubscriptions > 0 ? 'success' : 'neutral'}>{e.activeSubscriptions}</Badge>
            </td>
          </tr>
        ))}
      </HubTable>
      <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        {t('automationHub.crmWriteKeys', { count: data.automation.crmWriteKeyCount })}
      </p>
    </Section>
  );
}
