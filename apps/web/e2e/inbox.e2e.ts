import { test, expect, type APIRequestContext } from '@playwright/test';
import { DEMO_PASSWORD, LOGINS, loginAs } from './support/login';
import { uniqueSuffix } from './support/ids';

/**
 * G1c inbox (docs/MESAJLASMA.md, "Gelen kutusu"): a member writes from the
 * app (API call, as the mobile app does), reception reads and answers it
 * in the web inbox, the member sees the answer, and reception closes the
 * conversation so the next run starts a fresh one.
 */

const API_URL = 'http://localhost:4000';

interface Session {
  token: string;
  studioId: string;
}

async function memberSession(request: APIRequestContext): Promise<Session> {
  const res = await request.post(`${API_URL}/auth/login`, { data: { emailOrPhone: LOGINS.member, password: DEMO_PASSWORD } });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as {
    accessToken: string;
    user: { memberships: { studioId: string; memberProfileId: string | null }[] };
  };
  const membership = body.user.memberships.find((m) => m.memberProfileId);
  if (!membership) throw new Error('the seeded member has no member profile');
  return { token: body.accessToken, studioId: membership.studioId };
}

function authHeaders(session: Session) {
  return { authorization: `Bearer ${session.token}`, 'x-studio-id': session.studioId };
}

test('a member message reaches the reception inbox and the reply reaches the member', async ({ page, request }) => {
  const member = await memberSession(request);
  const question = `E2E soru ${uniqueSuffix()}`;
  const answer = `E2E cevap ${uniqueSuffix()}`;

  const sent = await request.post(`${API_URL}/studios/${member.studioId}/messaging/self/chat`, {
    headers: authHeaders(member),
    data: { body: question },
  });
  expect(sent.status()).toBe(201);

  await loginAs(page, LOGINS.reception);
  await page.locator('nav').getByText('Gelen Kutusu', { exact: true }).click();
  await page.waitForURL('**/gelen-kutusu');
  await expect(page.getByRole('heading', { name: 'Gelen kutusu', exact: true })).toBeVisible();

  const conversation = page.getByRole('list', { name: 'Konuşmalar' }).getByRole('button').filter({ hasText: question });
  await expect(conversation).toBeVisible();
  await conversation.click();

  // The member's message is in the thread; opening it clears the unread count.
  await expect(page.getByRole('list').filter({ hasText: question }).last()).toBeVisible();
  await page.getByLabel('Cevap', { exact: true }).fill(answer);
  await page.getByRole('button', { name: 'Gönder', exact: true }).click();
  await expect(page.getByText(answer, { exact: true }).first()).toBeVisible();

  // The reply shows in the thread before the API has finished writing it,
  // so poll the member's view instead of reading it once.
  await expect
    .poll(
      async () => {
        const chat = await request.get(`${API_URL}/studios/${member.studioId}/messaging/self/chat`, { headers: authHeaders(member) });
        const messages = ((await chat.json()) as { messages: { direction: string; body: string }[] }).messages;
        const last = messages[messages.length - 1];
        return last ? `${last.direction}:${last.body}` : null;
      },
      { timeout: 15_000 },
    )
    .toBe(`OUT:${answer}`);

  // Cleanup: close the conversation (the member's next message opens a new one).
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Yeniden aç', exact: true })).toBeVisible();
});

test('a trainer has no inbox: no navigation entry and the page shows the 403 view', async ({ page }) => {
  await loginAs(page, LOGINS.trainer);
  await expect(page.locator('nav').getByText('Gelen Kutusu', { exact: true })).toHaveCount(0);
  await page.goto('/gelen-kutusu');
  await expect(page.getByText('Bu sayfayı görüntüleme yetkiniz yok')).toBeVisible();
});
