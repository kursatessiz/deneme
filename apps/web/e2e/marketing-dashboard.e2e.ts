import { test, expect, type Page } from '@playwright/test';
import { DEMO_PASSWORD } from './support/login';

/**
 * M3a marketing dashboard (/pazarlama, docs/PAZARLAMA_MODULU.md 3.3), driven
 * by the super admin: the page headings, the acquisition tiles, the period
 * picker and the comparison toggle. The numbers themselves are pinned by the
 * API e2e (marketing-dashboard.e2e-spec.ts) with fixed dates; this test only
 * checks that the screen renders whatever the seeded platform tenant has, so
 * it asserts structure, not values. It changes no data.
 */

test.use({ actionTimeout: 15_000 });

const SUPER_ADMIN_PHONE = '+905321000001';

async function loginAsSuperAdmin(page: Page): Promise<void> {
  await page.goto('/giris');
  const form = page.locator('form').first();
  await form.locator('input:not([type="password"])').first().fill(SUPER_ADMIN_PHONE);
  await form.locator('input[type="password"]').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/giris'));
}

test('super admin sees the marketing dashboard with its sections and tiles', async ({ page }) => {
  await loginAsSuperAdmin(page);
  await page.goto('/pazarlama');
  const main = page.getByRole('main');

  await expect(main.getByRole('heading', { name: 'Pazarlama panosu', exact: true })).toBeVisible();
  for (const name of ['Huni', 'Edinme maliyeti ve getiri', 'Deneme sonrası ücretli geçiş', 'MRR etkisi', 'Kanal ve kampanya getirisi', 'Kanal sağlığı']) {
    await expect(main.getByRole('heading', { name, exact: true })).toBeVisible();
  }

  // One tile: the acquisition cost label is unique on the page.
  await expect(main.getByText('CAC (ücretli işletme başına maliyet)', { exact: true })).toBeVisible();
  await expect(main.getByText('CPL (aday başına maliyet)', { exact: true })).toBeVisible();

  // The funnel lists its six steps, the MQL and SQL steps included.
  const funnel = main.getByRole('list', { name: 'Huni', exact: true });
  await expect(funnel.getByRole('listitem')).toHaveCount(6);
  await expect(main.getByText('MQL (pazarlama nitelikli aday)', { exact: true })).toBeVisible();
  await expect(main.getByText('SQL (satış nitelikli aday)', { exact: true })).toBeVisible();

  // Channel health.
  await expect(main.getByRole('heading', { name: 'E-posta', exact: true })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Bekleyen onaylar', exact: true })).toBeVisible();
  await expect(main.getByText('Onay akışı henüz etkin değil.', { exact: true })).toBeVisible();
});

test('the period picker and the comparison toggle reload the dashboard', async ({ page }) => {
  await loginAsSuperAdmin(page);
  await page.goto('/pazarlama');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Huni', exact: true })).toBeVisible();

  const last30 = main.getByRole('button', { name: 'Son 30 gün', exact: true });
  await expect(last30).toHaveAttribute('aria-pressed', 'true');

  const seven = page.waitForResponse((res) => res.url().includes('/api/bff/platform/marketing/dashboard') && res.status() === 200);
  await main.getByRole('button', { name: 'Son 7 gün', exact: true }).click();
  await seven;
  await expect(main.getByRole('button', { name: 'Son 7 gün', exact: true })).toHaveAttribute('aria-pressed', 'true');

  const compared = page.waitForResponse((res) => res.url().includes('compare=previous') && res.status() === 200);
  await main.getByLabel('Önceki dönemle karşılaştır').check();
  await compared;
  await expect(main.getByText(/Karşılaştırılan dönem:/)).toBeVisible();

  // A custom range shows the two date fields.
  await main.getByRole('button', { name: 'Özel aralık', exact: true }).click();
  await expect(main.getByLabel('Başlangıç')).toBeVisible();
  await expect(main.getByLabel('Bitiş')).toBeVisible();
});
