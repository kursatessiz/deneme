import { test, expect } from '@playwright/test';
import { LOGINS, loginAs } from './support/login';
import { uniqueSuffix } from './support/ids';

/**
 * G3a loyalty (docs/SADAKAT.md): the owner manages earn rules and rewards
 * on /ayarlar/sadakat, then adjusts a member's points and redeems a
 * seeded reward on the member card. Everything created is named with a
 * unique suffix and deleted again; the member card test only adds points
 * before spending some, so the spec can run any number of times against
 * the seeded Zen program (enabled, with the "Havlu hediyesi" gift reward).
 */

test.use({ actionTimeout: 15_000 });

// Zen Reformer Pilates seed member (also used by member-package-sale.e2e.ts).
const MEMBER_NAME = 'Cem Ozkan';

test('the owner adds and removes an earn rule and a reward', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.goto('/ayarlar');
  const main = page.getByRole('main');
  await main.getByRole('link', { name: /Sadakat programı/ }).click();
  await page.waitForURL('**/ayarlar/sadakat');
  await expect(main.getByRole('heading', { name: 'Sadakat programı', exact: true })).toBeVisible();
  await expect(main.getByRole('switch', { name: 'Sadakat programı açık' })).toHaveAttribute('aria-checked', 'true');

  // Earn rule: attendance, unique name.
  const ruleName = `E2E kural ${uniqueSuffix()}`;
  await main.locator('#loyalty-rule-kind').selectOption('ATTENDANCE');
  await main.getByLabel('Kural adı').fill(ruleName);
  await main.getByLabel('Puan', { exact: true }).fill('7');
  await main.getByRole('button', { name: 'Kuralı ekle' }).click();
  const rule = main.getByTestId('loyalty-rules').getByRole('listitem').filter({ hasText: ruleName });
  await expect(rule).toBeVisible();
  await expect(rule.getByText('Seansa katılım - 7 puan')).toBeVisible();
  await rule.getByRole('button', { name: 'Sil' }).click();
  await expect(main.getByTestId('loyalty-rules').getByRole('listitem').filter({ hasText: ruleName })).toHaveCount(0);

  // Reward: a gift nobody has redeemed yet is deleted outright.
  const rewardName = `E2E hediye ${uniqueSuffix()}`;
  await main.locator('#loyalty-reward-type').selectOption('GIFT');
  await main.getByLabel('Ödül adı').fill(rewardName);
  await main.getByLabel('Puan bedeli').fill('25');
  await main.getByRole('button', { name: 'Ödülü ekle' }).click();
  const reward = main.getByTestId('loyalty-rewards').getByRole('listitem').filter({ hasText: rewardName });
  await expect(reward).toBeVisible();
  await expect(reward.getByText('25 puan')).toBeVisible();
  await reward.getByRole('button', { name: 'Sil' }).click();
  await expect(main.getByTestId('loyalty-rewards').getByRole('listitem').filter({ hasText: rewardName })).toHaveCount(0);
});

test('the owner adjusts points and redeems a reward on the member card', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.goto('/members');
  await page.getByPlaceholder('Ad, soyad veya telefon ara...').fill('Ozkan');
  const row = page.getByRole('link', { name: MEMBER_NAME });
  await expect(row).toBeVisible();
  await row.click();
  await page.waitForURL('**/members/**');

  const main = page.getByRole('main');
  const panel = main.getByTestId('loyalty-panel');
  await expect(panel.getByRole('heading', { name: 'Sadakat puanı' })).toBeVisible();

  const note = `E2E puan ${uniqueSuffix()}`;
  await panel.locator('#loyalty-adjust-points').fill('150');
  await panel.locator('#loyalty-adjust-note').fill(note);
  await panel.getByRole('button', { name: 'Puanı kaydet' }).click();
  // Next's route announcer also has role=alert/status; match the text, not the role alone.
  await expect(panel.getByText('Puan hareketi kaydedildi.')).toBeVisible();
  await expect(panel.getByTestId('loyalty-history').getByText(note, { exact: false })).toBeVisible();

  const rewardSelect = panel.locator('#loyalty-redeem-reward');
  const giftValue = await rewardSelect.locator('option', { hasText: 'Havlu hediyesi' }).first().getAttribute('value');
  expect(giftValue).toBeTruthy();
  await rewardSelect.selectOption(giftValue as string);
  await panel.getByRole('button', { name: 'Ödülü kullan' }).click();
  await expect(panel.getByText('Ödül kullanıldı: Havlu hediyesi.')).toBeVisible();
  await expect(panel.getByTestId('loyalty-history').getByText('Ödül kullanımı - Havlu hediyesi').first()).toBeVisible();
});

test('a trainer cannot open the loyalty settings', async ({ page }) => {
  await loginAs(page, LOGINS.trainer);
  await page.goto('/ayarlar/sadakat');
  await expect(page.getByRole('main').getByText('Bu sayfayı görüntüleme yetkiniz yok')).toBeVisible();
});
