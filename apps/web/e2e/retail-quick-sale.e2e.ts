import { test, expect } from '@playwright/test';
import { LOGINS, loginAs } from './support/login';

/**
 * G3c-2 quick sale (docs/PERAKENDE.md): reception opens the quick sale from
 * the dashboard's quick action bar, finds a seeded product, takes a cash
 * payment and opens the printable receipt. The sold product is the seeded
 * "Havlu kiralama" add-on, whose stock is not tracked, so the spec can run
 * any number of times against the seeded Zen store without running out.
 * Everything is scoped to <main> and matched exactly: the header carries a
 * language <select> and Next's route announcer is a role="alert".
 */

test.use({ actionTimeout: 15_000 });

const PRODUCT = 'Havlu kiralama';

test('reception sells an add-on from the quick sale screen and opens the receipt', async ({ page }) => {
  await loginAs(page, LOGINS.reception);
  const main = page.getByRole('main');

  const quickActions = main.getByRole('group', { name: 'Hızlı işlemler', exact: true });
  await quickActions.getByRole('link', { name: 'Hızlı satış', exact: true }).click();
  await page.waitForURL('**/magaza/satis');
  await expect(main.getByRole('heading', { name: 'Hızlı satış', exact: true })).toBeVisible();

  await main.getByLabel('Ürün ara veya barkod okut', { exact: true }).fill(PRODUCT);
  await main.getByRole('button', { name: `Ekle ${PRODUCT}`, exact: true }).click();
  const cart = main.getByRole('complementary', { name: 'Sepet', exact: true });
  await expect(cart.getByTestId('pos-cart').getByText(PRODUCT, { exact: true })).toBeVisible();
  await cart.getByRole('button', { name: `Artır ${PRODUCT}`, exact: true }).click();
  await expect(cart.getByTestId('pos-totals').getByText('Toplam', { exact: true })).toBeVisible();

  await cart.getByRole('radio', { name: 'Nakit', exact: true }).check();
  await cart.getByRole('button', { name: 'Ödemeyi al', exact: true }).click();
  await expect(cart.getByText(/^Satış tamamlandı: S\d{6}$/)).toBeVisible();
  await expect(cart.getByText('Sepet boş.', { exact: true })).toBeVisible();

  await cart.getByRole('link', { name: 'Fişi göster', exact: true }).click();
  await page.waitForURL('**/magaza/satislar/**');
  const receipt = main.getByRole('article', { name: 'Satış fişi', exact: true });
  await expect(receipt.getByRole('heading', { name: 'Satış fişi', exact: true })).toBeVisible();
  await expect(receipt.getByText(PRODUCT, { exact: true })).toBeVisible();
  await expect(receipt.getByText('Tamamlandı', { exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Yazdır', exact: true })).toBeVisible();
  // Reception has retail.view and retail.sell but not retail.refund.
  await expect(main.getByRole('button', { name: 'İade et', exact: true })).toHaveCount(0);
});

test('the owner sees the store with products and sales tabs', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.goto('/magaza');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Mağaza', exact: true })).toBeVisible();
  await expect(main.getByTestId('retail-products').getByText(PRODUCT, { exact: true })).toBeVisible();
  await main.getByRole('button', { name: 'Satışlar', exact: true }).click();
  await expect(main.getByTestId('retail-sales')).toBeVisible();
});

test('a trainer cannot open the quick sale screen', async ({ page }) => {
  await loginAs(page, LOGINS.trainer);
  await page.goto('/magaza/satis');
  await expect(page.getByRole('main').getByText('Bu sayfayı görüntüleme yetkiniz yok')).toBeVisible();
});
