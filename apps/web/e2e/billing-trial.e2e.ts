import { test, expect } from '@playwright/test';
import { LOGINS, loginAs } from './support/login';

/**
 * G5c-1 trial and activation (docs/DENEME_VE_ETKINLESTIRME.md). The
 * seeded "Nova Hareket Merkezi" is TRIALING with 10 days left and was
 * referred by Zen. Its owner sees the days-left banner, opens "Hesabı
 * etkinleştir", pays with the MOCK provider and the banner disappears.
 * The activation changes seed state, so the tests run serially and the
 * activation is last; CI runs the suite once per freshly seeded database.
 * Everything is scoped to <main> and matched exactly: the header carries a
 * language <select> and Next's route announcer is a role="alert".
 */

test.use({ actionTimeout: 15_000 });
test.describe.configure({ mode: 'serial' });

test('an active studio shows no trial banner and the owner sees the referral page', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  const main = page.getByRole('main');
  await expect(main.getByTestId('billing-banner')).toHaveCount(0);

  await page.goto('/tavsiye');
  await expect(main.getByRole('heading', { name: 'Tavsiye et', exact: true })).toBeVisible();
  await expect(main.getByTestId('referral-code')).toHaveText('ZENREF23');
  await expect(main.getByRole('textbox', { name: 'Tavsiye bağlantınız', exact: true })).toHaveValue(/\?pw_ref=ZENREF23$/);
  await expect(main.getByRole('button', { name: 'Kopyala', exact: true })).toBeVisible();
  await expect(main.getByRole('cell', { name: 'Nova Hareket Merkezi', exact: true })).toBeVisible();
});

test('reception has no billing page', async ({ page }) => {
  await loginAs(page, LOGINS.reception);
  await page.goto('/abonelik');
  await expect(page.getByText('Bu sayfayı görüntüleme yetkiniz yok')).toBeVisible();
});

test('the trial owner sees the days-left banner and activates the account', async ({ page }) => {
  await loginAs(page, LOGINS.trialOwner);
  const main = page.getByRole('main');
  const banner = main.getByTestId('billing-banner');
  await expect(banner.getByText(/^Deneme sürenizin bitmesine \d+ gün kaldı\.$/)).toBeVisible();

  await banner.getByRole('link', { name: 'Hesabı etkinleştir', exact: true }).click();
  await page.waitForURL('**/abonelik');
  await expect(main.getByRole('heading', { name: 'Abonelik', exact: true })).toBeVisible();
  await expect(main.getByTestId('billing-summary').getByText('Deneme', { exact: true })).toBeVisible();

  const plans = main.getByRole('group', { name: 'Plan seçin', exact: true });
  await plans.getByRole('radio').first().check();
  await main.getByRole('button', { name: 'Öde ve etkinleştir', exact: true }).click();

  await expect(main.getByRole('status').getByText('Hesabınız etkinleştirildi.', { exact: true })).toBeVisible();
  await expect(main.getByTestId('billing-summary').getByText('Etkin', { exact: true })).toBeVisible();
  await expect(main.getByTestId('billing-banner')).toHaveCount(0);
  await expect(main.getByRole('cell', { name: 'Ödendi', exact: true })).toBeVisible();
});
