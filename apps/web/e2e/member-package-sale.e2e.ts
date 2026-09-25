import { test, expect } from '@playwright/test';
import { LOGINS, loginAs } from './support/login';

// Zen Reformer Pilates seed member with no special medical notes to mask.
const MEMBER_NAME = 'Cem Ozkan';

test('owner can open a member, sell a package for cash and see it in active packages', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.goto('/members');

  // The search endpoint matches firstName/lastName/phone independently, not
  // the full "first last" string, so search by last name only.
  await page.getByPlaceholder('Ad, soyad veya telefon ara...').fill('Ozkan');
  const row = page.getByRole('link', { name: MEMBER_NAME });
  await expect(row).toBeVisible();
  await row.click();
  await page.waitForURL('**/members/**');

  await page.getByRole('button', { name: 'Paket sat' }).click();
  await expect(page.getByRole('heading', { name: 'Paket sat' })).toBeVisible();

  // getByLabel would compute the label from the wrapping <label>'s full text
  // content, which includes every <option>'s text; getByRole's accessible
  // name computation excludes the control's own rendered value.
  const packageSelect = page.getByRole('combobox', { name: 'Paket', exact: true });
  const soldPackageLabel = (await packageSelect.locator('option').first().textContent())?.trim() ?? '';
  const soldPackageName = soldPackageLabel.split(' - ')[0];

  // Payment method defaults to Nakit (cash); paid amount is pre-filled from the package price.
  await page.getByRole('button', { name: 'Paketi sat' }).click();

  await expect(page.getByText('Paket satışı tamamlandı.')).toBeVisible();
  // Two "Kapat" buttons exist at this point: the Modal's icon-only close
  // (aria-label) and the result panel's own text button; click the latter.
  await page.getByText('Kapat', { exact: true }).click();

  // Re-running this test against the same seeded database sells another
  // copy of the same package definition each time, so more than one active
  // package card can carry this exact name -- assert on the first match.
  const activePackages = page.locator('h3', { hasText: 'Aktif paketler' }).locator('..');
  await expect(activePackages.getByRole('heading', { name: soldPackageName, level: 4 }).first()).toBeVisible();
});
