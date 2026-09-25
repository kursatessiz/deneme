import type { Page } from '@playwright/test';

/**
 * Seeded demo logins shared by the whole suite (packages/database/prisma/seed.ts).
 * All of them use the same demo password unless SEED_DEMO_PASSWORD overrides it.
 */
export const LOGINS = {
  owner: '+905321000002',
  reception: '+905321000003',
  trainer: '+905321000004',
  member: '+905321000016',
} as const;

export const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';

/**
 * Logs in through /giris the same way a real user would (password mode),
 * and waits for the redirect to /dashboard. The login page's two text
 * inputs have no htmlFor/id pairing with their labels, so they are
 * addressed positionally within the (single, currently visible) form.
 */
export async function loginAs(page: Page, phone: string, password: string = DEMO_PASSWORD): Promise<void> {
  await page.goto('/giris');
  const form = page.locator('form').first();
  await form.locator('input:not([type="password"])').first().fill(phone);
  await form.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await page.waitForURL('**/dashboard');
}
