import { test, expect } from '@playwright/test';
import { LOGINS, loginAs } from './support/login';

test('owner can switch report tabs and the CSV export comes back through the BFF', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.goto('/raporlar');

  // The default 30-day window looks only at the past, but the seed's Zen
  // sessions are scheduled a few days into the future; widen the range so
  // the occupancy table actually has rows instead of the empty state.
  const futureTo = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await page.locator('input[type="date"]').nth(1).fill(futureTo);

  // Doluluk (occupancy) tab -- its table has a "Kapasite" column.
  await expect(page.getByText('Kapasite', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Gelir' }).click();
  await expect(page.getByText('Net gelir')).toBeVisible();

  await page.getByRole('button', { name: 'Kohortlar' }).click();
  // Cohorts is the only tab without a date-range filter.
  await expect(page.getByText('Bugün', { exact: true })).toHaveCount(0);

  const href = await page.getByRole('link', { name: 'CSV indir' }).getAttribute('href');
  expect(href).toBeTruthy();

  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/csv');
});
