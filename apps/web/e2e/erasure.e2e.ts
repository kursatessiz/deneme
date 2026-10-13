import { test, expect, type APIRequestContext } from '@playwright/test';
import { DEMO_PASSWORD, LOGINS, loginAs } from './support/login';
import { uniqueSuffix } from './support/ids';

/**
 * KVKK/GDPR erasure (docs/KVKK_SILME.md): a member asks from the app (API
 * call, as the mobile app does), the owner rejects the request in the web
 * list (the seeded member and their data stay), and the owner starts
 * erasure of a throwaway member from the member card after the confirmation.
 */

const API_URL = 'http://localhost:4000';

interface Session {
  token: string;
  studioId: string;
}

async function login(request: APIRequestContext, phone: string): Promise<Session> {
  const res = await request.post(`${API_URL}/auth/login`, { data: { emailOrPhone: phone, password: DEMO_PASSWORD } });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { accessToken: string; user: { memberships: { studioId: string; memberProfileId: string | null }[] } };
  const membership = body.user.memberships.find((m) => m.memberProfileId) ?? body.user.memberships[0];
  return { token: body.accessToken, studioId: membership.studioId };
}

const headers = (session: Session) => ({ authorization: `Bearer ${session.token}`, 'x-studio-id': session.studioId });

test('the owner rejects a member erasure request from the request list', async ({ page, request }) => {
  const member = await login(request, LOGINS.member);
  const asked = await request.post(`${API_URL}/me/erasure`, { headers: headers(member), data: {} });
  // A request left open by an interrupted earlier run is reused.
  expect([201, 409]).toContain(asked.status());

  await loginAs(page, LOGINS.owner);
  await page.goto('/members');
  await page.getByRole('link', { name: 'Silme talepleri' }).click();
  await page.waitForURL('**/members/silme-talepleri');
  await expect(page.getByRole('heading', { name: 'Silme talepleri', exact: true })).toBeVisible();

  const table = page.getByRole('main').getByRole('table');
  const row = table.getByRole('row').filter({ hasText: 'Üye talebi' }).first();
  await expect(row).toBeVisible();
  await expect(row.getByText('Bekliyor')).toBeVisible();
  await row.getByRole('button', { name: 'Reddet' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reddet' }).click();
  await expect(page.getByText('Talep reddedildi.')).toBeVisible();
});

test('the owner starts erasure from the member card after confirming', async ({ page, request }) => {
  const owner = await login(request, LOGINS.owner);
  const suffix = uniqueSuffix().replace(/[^a-z]/g, 'x');
  const phone = `+90539777${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
  const created = await request.post(`${API_URL}/members`, {
    headers: headers(owner),
    data: { studioId: owner.studioId, firstName: 'Silinecek', lastName: `Uye${suffix}`.slice(0, 20), phone },
  });
  expect(created.status()).toBe(201);

  await loginAs(page, LOGINS.owner);
  await page.goto('/members');
  await page.getByPlaceholder('Ad, soyad veya telefon ara...').fill(`Uye${suffix}`.slice(0, 20));
  await page.getByRole('link', { name: /Silinecek/ }).click();
  await page.waitForURL('**/members/**');

  await page.getByRole('button', { name: 'Kişisel verileri sil' }).click();
  await expect(page.getByRole('dialog')).toContainText('geri alınamaz');
  await page.getByRole('dialog').getByRole('button', { name: 'Verileri sil' }).click();
  await expect(page.getByText('Kişisel veriler anonimleştirildi.')).toBeVisible();
  await expect(page.getByText('Verileri silindi', { exact: true }).first()).toBeVisible();
});
