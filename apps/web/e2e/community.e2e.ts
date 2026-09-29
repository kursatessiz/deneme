import { test, expect } from '@playwright/test';
import { LOGINS, loginAs } from './support/login';
import { uniqueSuffix } from './support/ids';

/**
 * G5b community (docs/TOPLULUK.md): the owner creates an access tier on
 * /ayarlar/topluluk, writes a post for that tier on /topluluk, publishes
 * it, opens the public share link, turns it off, archives the post and
 * removes the tier again. Everything created carries a unique suffix and
 * is cleaned up, so the spec can run any number of times.
 */

test.use({ actionTimeout: 15_000 });

test('the owner manages a tier, a post and its share link', async ({ page }) => {
  const suffix = uniqueSuffix();
  const tierName = `E2E katman ${suffix}`;
  const title = `E2E duyuru ${suffix}`;

  await loginAs(page, LOGINS.owner);

  // Access tier: every active member.
  await page.goto('/ayarlar/topluluk');
  let main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Topluluk erişim katmanları', exact: true })).toBeVisible();
  await main.getByRole('textbox', { name: 'Katman adı' }).fill(tierName);
  await main.getByRole('checkbox', { name: 'Tüm aktif üyeler' }).check();
  await main.getByRole('button', { name: 'Katmanı kaydet' }).click();
  const tierRow = main.getByTestId('community-tiers').getByRole('listitem').filter({ hasText: tierName });
  await expect(tierRow).toBeVisible();

  // Post for that tier.
  await page.goto('/topluluk');
  main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Topluluk', exact: true })).toBeVisible();
  await main.getByRole('button', { name: 'Yeni gönderi' }).click();
  await main.getByRole('combobox', { name: 'Tür' }).selectOption('ANNOUNCEMENT');
  await main.getByRole('textbox', { name: 'Başlık' }).fill(title);
  await main.getByRole('textbox', { name: 'Metin' }).fill('Playwright ile yazılan duyuru metni.');
  await main.getByRole('checkbox', { name: tierName }).check();
  await main.getByRole('button', { name: 'Gönderiyi kaydet' }).click();

  const item = main.getByTestId('community-posts').getByRole('listitem').filter({ hasText: title }).first();
  await expect(item).toBeVisible();
  await expect(item.getByText('Taslak', { exact: true })).toBeVisible();
  await expect(item.getByText(`Erişim: ${tierName}`, { exact: false })).toBeVisible();

  await item.getByRole('button', { name: 'Yayınla' }).click();
  await expect(item.getByText('Yayında', { exact: true })).toBeVisible();

  // Public share link: on, readable without the dashboard, then off.
  await item.getByRole('button', { name: 'Paylaşım bağlantısını aç' }).click();
  const shareBox = item.getByRole('textbox', { name: 'Paylaşım bağlantısı' });
  await expect(shareBox).toHaveValue(/\/paylasim\/[A-Za-z0-9_-]{43}$/);
  const shareUrl = await shareBox.inputValue();

  const publicPage = await page.context().newPage();
  await publicPage.goto(shareUrl);
  await expect(publicPage.getByRole('heading', { name: title })).toBeVisible();
  await publicPage.close();

  await item.getByRole('button', { name: 'Paylaşım bağlantısını kapat' }).click();
  await expect(item.getByRole('textbox', { name: 'Paylaşım bağlantısı' })).toHaveCount(0);

  // Archive, then take the tier off the post so the tier can be deleted.
  await item.getByRole('button', { name: 'Arşivle' }).click();
  await expect(item.getByText('Arşivde', { exact: true })).toBeVisible();
  await item.getByRole('button', { name: 'Düzenle' }).click();
  await main.getByRole('checkbox', { name: tierName }).uncheck();
  await main.getByRole('button', { name: 'Gönderiyi kaydet' }).click();
  await expect(item.getByText('Erişim: tüm aktif üyeler', { exact: false })).toBeVisible();

  await page.goto('/ayarlar/topluluk');
  main = page.getByRole('main');
  const row = main.getByTestId('community-tiers').getByRole('listitem').filter({ hasText: tierName });
  await row.getByRole('button', { name: 'Sil' }).click();
  await expect(main.getByTestId('community-tiers').getByRole('listitem').filter({ hasText: tierName })).toHaveCount(0);
});

test('reception reviews posts but cannot write them', async ({ page }) => {
  await loginAs(page, LOGINS.reception);
  await page.goto('/topluluk');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Topluluk', exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Yeni gönderi' })).toHaveCount(0);
  // The seeded pinned announcement is listed for staff.
  await expect(main.getByTestId('community-posts').getByText('Bayram haftası çalışma saatleri')).toBeVisible();
});
