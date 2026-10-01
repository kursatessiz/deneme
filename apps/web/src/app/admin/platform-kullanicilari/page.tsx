'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  MessageKey,
  PlatformAccessSettingsDTO,
  PlatformMemberDTO,
  PlatformPermissionKey,
  PlatformRoleTemplateDTO,
} from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { Badge } from '@/components/common/Badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { InlineMessage, PrimaryButton, SecondaryButton, Section, SettingsHeader, TextField, Toggle } from '@/components/settings/ui';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { Select } from '@/components/ui/Select';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';

type Channel = 'SHOWN' | 'SMS' | 'WHATSAPP';

/** 'platform.marketing.view' -> 'platformPermissions.marketingView'. */
function permissionLabelKey(key: PlatformPermissionKey): MessageKey {
  const [area, action] = key.replace(/^platform\./, '').split('.');
  return `platformPermissions.${area}${action.charAt(0).toUpperCase()}${action.slice(1)}` as MessageKey;
}

const STATUS_TONE = { INVITED: 'info', ACTIVE: 'success', PASSIVE: 'neutral' } as const;

/**
 * Super admin: platform users (docs/PAZARLAMA_MODULU.md 2.6). Invite by
 * phone and full name through the regular invite flow, change the platform
 * role, deactivate/reactivate, reset two-step verification, and the 2FA
 * policy. Every action is audit logged by the API.
 */
export default function PlatformUsersPage() {
  const t = useT();
  const locale = useLocale();
  const [members, setMembers] = useState<PlatformMemberDTO[] | null>(null);
  const [roles, setRoles] = useState<PlatformRoleTemplateDTO[]>([]);
  const [settings, setSettings] = useState<PlatformAccessSettingsDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [roleDraft, setRoleDraft] = useState<Record<string, string>>({});

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [roleTemplateId, setRoleTemplateId] = useState('');
  const [channel, setChannel] = useState<Channel>('SHOWN');
  const [invite, setInvite] = useState<{ inviteUrl: string; expiresAt: string } | null>(null);

  const fmtDate = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

  const load = useCallback(() => {
    Promise.all([
      bffFetch<PlatformMemberDTO[]>('admin/platform-users'),
      bffFetch<PlatformRoleTemplateDTO[]>('admin/platform-users/role-templates'),
      bffFetch<PlatformAccessSettingsDTO>('admin/platform-users/settings'),
    ])
      .then(([m, r, s]) => {
        setMembers(m);
        setRoles(r);
        setSettings(s);
        setRoleTemplateId((current) => current || r[0]?.id || '');
      })
      .catch((err) => setError(err instanceof BffError ? err.message : t('adminPlatformUsers.loadFailed')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(load, [load]);

  async function run(action: () => Promise<unknown>) {
    setMessage(null);
    try {
      await action();
      setMessage({ text: t('adminPlatformUsers.done'), ok: true });
      load();
    } catch (err) {
      setMessage({ text: err instanceof BffError ? err.message : t('adminPlatformUsers.actionFailed'), ok: false });
    }
  }

  if (error) return <ErrorState message={error} />;
  if (!members || !settings) return <LoadingState />;

  return (
    <div className="grid gap-6">
      <SettingsHeader title={t('adminPlatformUsers.title')} description={t('adminPlatformUsers.subtitle')} />
      {message && <InlineMessage text={message.text} tone={message.ok ? 'success' : 'error'} />}

      <Section title={t('adminPlatformUsers.invite.title')} description={t('adminPlatformUsers.invite.description')}>
        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const res = await bffFetch<{ inviteUrl: string; expiresAt: string }>('admin/platform-users/invites', {
                method: 'POST',
                body: { fullName, phone, roleTemplateId, channel },
              });
              setInvite(res);
              setFullName('');
              setPhone('');
            });
          }}
        >
          <TextField label={t('adminPlatformUsers.invite.fullName')} value={fullName} onChange={setFullName} />
          <TextField label={t('adminPlatformUsers.invite.phone')} value={phone} onChange={setPhone} placeholder="+90 532 111 22 33" />
          <FieldGroup label={t('adminPlatformUsers.invite.role')}>
            <Select value={roleTemplateId} onChange={(e) => setRoleTemplateId(e.target.value)}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </FieldGroup>
          <FieldGroup label={t('adminPlatformUsers.invite.channel')}>
            <Select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
              {(['SHOWN', 'SMS', 'WHATSAPP'] as const).map((c) => (
                <option key={c} value={c}>
                  {t(`adminPlatformUsers.invite.channel.${c}`)}
                </option>
              ))}
            </Select>
          </FieldGroup>
          <div>
            <PrimaryButton type="submit" disabled={fullName.trim().length < 3 || phone.trim().length < 10 || !roleTemplateId}>
              {t('adminPlatformUsers.invite.submit')}
            </PrimaryButton>
          </div>
        </form>
        {invite && (
          <div className="grid gap-1">
            <p>{t('adminPlatformUsers.invite.created', { date: fmtDate(invite.expiresAt) })}</p>
            <p className="ui-caption">{t('adminPlatformUsers.invite.link')}</p>
            <code className="ui-panel ui-mono block p-2 break-all">{invite.inviteUrl}</code>
          </div>
        )}
      </Section>

      <Section title={t('adminPlatformUsers.title')}>
        {members.length === 0 ? (
          <EmptyState title={t('adminPlatformUsers.empty')} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  {(['name', 'phone', 'role', 'status', 'mfa', 'actions'] as const).map((c) => (
                    <Th key={c}>{t(`adminPlatformUsers.col.${c}`)}</Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                {members.map((m) => (
                  <Tr key={m.id} className="align-top">
                    <Td className="ui-strong">{m.fullName}</Td>
                    <Td className="ui-mono">{m.phoneMasked}</Td>
                    <Td>
                      <div className="flex gap-2 items-center">
                        <Select
                          aria-label={`${t('adminPlatformUsers.col.role')} ${m.fullName}`}
                          value={roleDraft[m.userId] ?? m.roleTemplateId}
                          onChange={(e) => setRoleDraft({ ...roleDraft, [m.userId]: e.target.value })}
                          className="w-auto"
                        >
                          {roles.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </Select>
                        {roleDraft[m.userId] && roleDraft[m.userId] !== m.roleTemplateId && (
                          <SecondaryButton
                            onClick={() =>
                              run(() => bffFetch(`admin/platform-users/${m.userId}/role`, { method: 'PUT', body: { roleTemplateId: roleDraft[m.userId] } }))
                            }
                          >
                            {t('adminPlatformUsers.action.saveRole')}
                          </SecondaryButton>
                        )}
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={STATUS_TONE[m.status]}>{t(`adminPlatformUsers.status.${m.status}`)}</Badge>
                    </Td>
                    <Td>
                      <Badge tone={m.mfaEnabled ? 'success' : 'warning'}>{m.mfaEnabled ? t('twoFactor.status.on') : t('twoFactor.status.off')}</Badge>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-2">
                        {m.status === 'PASSIVE' ? (
                          <SecondaryButton onClick={() => run(() => bffFetch(`admin/platform-users/${m.userId}/reactivate`, { method: 'POST' }))}>
                            {t('adminPlatformUsers.action.reactivate')}
                          </SecondaryButton>
                        ) : (
                          <SecondaryButton
                            danger
                            onClick={() =>
                              window.confirm(t('adminPlatformUsers.confirm.deactivate', { name: m.fullName })) &&
                              run(() => bffFetch(`admin/platform-users/${m.userId}/deactivate`, { method: 'POST' }))
                            }
                          >
                            {t('adminPlatformUsers.action.deactivate')}
                          </SecondaryButton>
                        )}
                        {m.mfaEnabled && (
                          <SecondaryButton
                            onClick={() =>
                              window.confirm(t('adminPlatformUsers.confirm.resetMfa', { name: m.fullName })) &&
                              run(() => bffFetch(`admin/platform-users/${m.userId}/mfa/reset`, { method: 'POST' }))
                            }
                          >
                            {t('adminPlatformUsers.action.resetMfa')}
                          </SecondaryButton>
                        )}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </Section>

      <Section title={t('adminPlatformUsers.role.title')}>
        {roles.map((r) => (
          <div key={r.id} className="grid gap-1">
            <div className="flex items-center gap-2">
              <span className="ui-strong">{r.name}</span>
              {r.isSystem && <Badge>{t('adminPlatformUsers.role.system')}</Badge>}
            </div>
            <p className="ui-caption">
              {t('adminPlatformUsers.role.permissions')}: {r.permissions.map((p) => t(permissionLabelKey(p))).join(', ')}
            </p>
          </div>
        ))}
      </Section>

      <Section title={t('adminPlatformUsers.settings.title')} description={t('adminPlatformUsers.settings.require2faHint')}>
        <Toggle
          label={t('adminPlatformUsers.settings.require2fa')}
          checked={settings.require2faForPlatformRoles}
          onChange={(v) => run(() => bffFetch('admin/platform-users/settings', { method: 'PUT', body: { require2faForPlatformRoles: v } }))}
        />
      </Section>
    </div>
  );
}
