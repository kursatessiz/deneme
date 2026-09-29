import { test, expect } from '@playwright/test';
import { LOGINS, loginAs } from './support/login';

/**
 * G5d-2 bank payouts and reconciliation: /finans/odemeler. The seed holds
 * three demo payouts (mock_po_seed_a matched, _b partially matched, _c
 * pending and unmatched); the tests read them and always restore what they
 * change by hand.
 */
test('owner sees the payouts with reconciliation chips and filters them', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.goto('/finans/odemeler');
  const main = page.getByRole('main');

  await expect(main.getByRole('heading', { name: 'Banka ödemeleri', level: 2 })).toBeVisible();

  const rowA = main.getByRole('row').filter({ hasText: 'mock_po_seed_a' });
  const rowB = main.getByRole('row').filter({ hasText: 'mock_po_seed_b' });
  const rowC = main.getByRole('row').filter({ hasText: 'mock_po_seed_c' });
  await expect(rowA).toBeVisible();
  await expect(rowA.getByText('Eşleşti', { exact: true })).toBeVisible();
  await expect(rowA.getByText('Bankaya geçti')).toBeVisible();
  await expect(rowB.getByText('Kısmen eşleşti')).toBeVisible();
  await expect(rowC.getByText('Bekliyor')).toBeVisible();
  await expect(rowC.getByText('Eşleşmedi')).toBeVisible();

  await main.getByRole('combobox', { name: 'Mutabakat durumu', exact: true }).selectOption('PARTIAL');
  await expect(rowB).toBeVisible();
  await expect(rowA).toHaveCount(0);

  await main.getByRole('combobox', { name: 'Mutabakat durumu', exact: true }).selectOption('');
  await main.getByRole('combobox', { name: 'Durum', exact: true }).selectOption('PENDING');
  await expect(rowC).toBeVisible();
  await expect(rowB).toHaveCount(0);

  await main.getByRole('combobox', { name: 'Durum', exact: true }).selectOption('');
  await main.getByRole('combobox', { name: 'Sağlayıcı', exact: true }).selectOption('IYZICO');
  await expect(main.getByText('Henüz banka ödemesi yok')).toBeVisible();
});

test('owner opens a payout, reads its items and matches and unmatches an item by hand', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.goto('/finans/odemeler');
  const main = page.getByRole('main');

  await main.getByRole('button', { name: /Ayrıntı mock_po_seed_b/ }).click();
  await expect(main.getByRole('heading', { name: 'Banka ödemesi mock_po_seed_b' })).toBeVisible();
  await expect(main.getByText('Satırların toplamı bankaya geçen tutarla aynı.')).toBeVisible();

  const itemRows = main.getByRole('row').filter({ hasText: 'mock_chg_seed_' });
  await expect(itemRows).toHaveCount(2);
  const unmatchedRow = main.getByRole('row').filter({ hasText: 'mock_chg_seed_b1' });
  await expect(unmatchedRow.getByText('Eşleşmedi')).toBeVisible();
  const matchedRow = main.getByRole('row').filter({ hasText: 'mock_chg_seed_b2' });
  await expect(matchedRow.getByText('MOCK-B2')).toBeVisible();
  await expect(matchedRow.getByText('Otomatik eşleşti')).toBeVisible();

  // Manual match: pick the first candidate payment.
  await unmatchedRow.getByRole('button', { name: 'Eşleştir' }).click();
  await expect(page.getByText('Tahsilatla eşleştir')).toBeVisible();
  await page.getByRole('button', { name: 'Seç', exact: true }).first().click();
  await expect(page.getByText('Tahsilatla eşleştir')).toHaveCount(0);
  await expect(main.getByText('Elle eşleştirildi')).toBeVisible();
  await expect(main.getByText('Eşleşti', { exact: true }).first()).toBeVisible();

  // Restore: remove the match again.
  await unmatchedRow.getByRole('button', { name: 'Eşlemeyi kaldır' }).click();
  await expect(unmatchedRow.getByText('Eşleşmedi')).toBeVisible();

  await main.getByRole('button', { name: 'Listeye dön' }).click();
  await expect(main.getByRole('row').filter({ hasText: 'mock_po_seed_b' }).getByText('Kısmen eşleşti')).toBeVisible();
});

test('owner syncs now and gets the export link for the chosen content and format', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.goto('/finans/odemeler');
  const main = page.getByRole('main');

  await main.getByRole('button', { name: 'Şimdi eşitle' }).click();
  await expect(main.getByRole('status').filter({ hasText: /Eşitleme tamamlandı|Eşitlenecek bir sağlayıcı/ })).toBeVisible();

  const download = main.getByRole('link', { name: 'İndir' });
  await expect(download).toHaveAttribute('href', /\/payouts\/export\?kind=payouts&format=xlsx/);
  await main.getByRole('combobox', { name: 'İçerik', exact: true }).selectOption('items');
  await main.getByRole('combobox', { name: 'Biçim', exact: true }).selectOption('csv');
  await expect(download).toHaveAttribute('href', /kind=items&format=csv/);
});

test('reception without payouts.view cannot open the payouts page', async ({ page }) => {
  await loginAs(page, LOGINS.reception);
  await page.goto('/finans/odemeler');
  await expect(page.getByText(/yetki|izin/i).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Şimdi eşitle' })).toHaveCount(0);
});
