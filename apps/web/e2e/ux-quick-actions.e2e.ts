import { test, expect } from '@playwright/test';
import { LOGINS, loginAs } from './support/login';

// The dashboard's quick action bar is a `role="group"` inside <main>, with
// one link per unlocked action. Scoped to `main` (not the whole page) and
// matched exactly, since the header also carries a language <select> and
// Next's route announcer renders a role="alert" element.
test.describe('Dashboard quick action bar', () => {
  test('owner sees the quick action bar with more than one action', async ({ page }) => {
    await loginAs(page, LOGINS.owner);
    const main = page.getByRole('main');
    const quickActions = main.getByRole('group', { name: 'Hızlı işlemler', exact: true });
    await expect(quickActions).toBeVisible();

    // The owner has every permission, so every action shows up.
    for (const label of ['Yeni seans', 'Yeni üye', 'Paket sat', 'Ödeme kaydet', 'Hızlı satış', 'Check-in']) {
      await expect(quickActions.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    const ownerActionCount = await quickActions.getByRole('link').count();
    expect(ownerActionCount).toBeGreaterThan(1);
  });

  test('trainer sees fewer quick actions than the owner', async ({ page }) => {
    await loginAs(page, LOGINS.trainer);
    const main = page.getByRole('main');
    const quickActions = main.getByRole('group', { name: 'Hızlı işlemler', exact: true });

    // The trainer's default role template only has attendance.manage among
    // the quick action permissions (see nav.e2e.ts), so only "check-in"
    // shows up -- fewer than the owner's five.
    await expect(quickActions.getByRole('link', { name: 'Check-in', exact: true })).toBeVisible();
    await expect(quickActions.getByRole('link', { name: 'Yeni seans', exact: true })).toHaveCount(0);
    await expect(quickActions.getByRole('link', { name: 'Paket sat', exact: true })).toHaveCount(0);
    await expect(quickActions.getByRole('link', { name: 'Hızlı satış', exact: true })).toHaveCount(0);

    const trainerActionCount = await quickActions.getByRole('link').count();
    expect(trainerActionCount).toBeLessThan(5);
  });
});
