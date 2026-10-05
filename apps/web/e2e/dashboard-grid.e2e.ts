import { test, expect, type Page, type Response } from '@playwright/test';
import { LOGINS, loginAs } from './support/login';

/**
 * Overview card board (docs/WEB_PANEL.md, "Genel bakış kartları"): the
 * owner's default cards with real figures, adding a card from the dialog,
 * moving and resizing a card with the keyboard within its limits, the
 * layout surviving a reload, resetting to the default, and a trainer not
 * being offered the revenue card. Runs serially: every test resets the
 * signed-in membership's board first and the last owner test resets it.
 */

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1440, height: 900 } });

const CSRF = { 'x-requested-with': 'platform-web' };

interface DataResult {
  id: string;
  widget: string;
  status: string;
  data?: { kind: string; count?: number; currentAmount?: string; currency?: string };
}

/** Deletes the stored board of the signed-in membership through the BFF, then reloads the overview. */
async function resetBoard(page: Page): Promise<void> {
  const origin = new URL(page.url()).origin;
  const layout = await page.request.get('/api/bff/auth/me', { headers: CSRF });
  expect(layout.ok()).toBe(true);
  const me = (await layout.json()) as { memberships: { studioId: string }[] };
  const cookies = await page.context().cookies();
  const studioId = cookies.find((c) => c.name === 'pw_studio')?.value ?? me.memberships[0].studioId;
  const res = await page.request.fetch(`/api/bff/studios/${studioId}/dashboard/layout`, {
    method: 'DELETE',
    headers: { ...CSRF, origin, 'x-studio-id': studioId },
  });
  expect(res.status()).toBe(200);
}

function isDataResponse(res: Response): boolean {
  return res.url().includes('/dashboard/data') && res.request().method() === 'POST';
}

function isLayoutSave(res: Response): boolean {
  return res.url().includes('/dashboard/layout') && res.request().method() === 'PUT';
}

function card(page: Page, title: string) {
  return page.getByRole('main').getByRole('region', { name: title, exact: true });
}

async function openBoard(page: Page): Promise<DataResult[]> {
  // Leave the current page first so a request still in flight from it cannot be taken for the new one.
  await page.goto('about:blank');
  const data = page.waitForResponse(isDataResponse);
  await page.goto('/dashboard');
  const body = (await (await data).json()) as { results: DataResult[] };
  return body.results;
}

test('owner sees the default cards with real figures', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await resetBoard(page);
  const results = await openBoard(page);
  const main = page.getByRole('main');

  for (const title of ['Ciro', 'Aktif üye sayısı', 'Doluluk oranı', 'Bugünkü seanslar', 'Bugünün programı', 'Şubeler', 'Ciro trendi']) {
    await expect(card(page, title)).toBeVisible();
  }
  // Quick actions stay a labelled group inside their card (ux-quick-actions.e2e.ts relies on it).
  await expect(main.getByRole('group', { name: 'Hızlı işlemler', exact: true })).toBeVisible();

  const members = results.find((r) => r.widget === 'activeMembers');
  expect(members?.status).toBe('ok');
  const count = members?.data?.count ?? -1;
  expect(count).toBeGreaterThan(0);
  await expect(card(page, 'Aktif üye sayısı').getByText(new Intl.NumberFormat('tr-TR').format(count), { exact: true })).toBeVisible();

  const revenue = results.find((r) => r.widget === 'revenue');
  expect(revenue?.status).toBe('ok');
  const amount = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: revenue?.data?.currency ?? 'TRY' }).format(Number(revenue?.data?.currentAmount ?? '0'));
  await expect(card(page, 'Ciro').getByText(amount, { exact: true })).toBeVisible();
});

test('owner adds a card, moves and resizes a card with the keyboard, and the board survives a reload', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await resetBoard(page);
  await openBoard(page);
  const main = page.getByRole('main');

  // Add "Yaklaşan seanslar" from the dialog, found by search.
  await main.getByRole('button', { name: 'Kart ekle', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Kart ekle' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('searchbox', { name: 'Kart ara' }).fill('yaklaşan seans');
  const added = page.waitForResponse(isLayoutSave);
  await dialog.getByRole('button', { name: 'Yaklaşan seanslar kartını ekle', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(card(page, 'Yaklaşan seanslar')).toBeVisible();
  expect((await added).status()).toBe(200);

  // Edit mode: the revenue card is focusable and follows the keyboard.
  await main.getByRole('button', { name: 'Düzenle', exact: true }).click();
  const revenue = card(page, 'Ciro');
  await revenue.focus();
  await expect(revenue).toHaveAttribute('data-w', '3');

  for (let i = 0; i < 4; i += 1) await page.keyboard.press('Shift+ArrowRight');
  await expect(revenue).toHaveAttribute('data-w', '4');
  await expect(page.getByTestId('dashboard-announcer')).toContainText('en büyük boyutunda');
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('Shift+ArrowDown');
  await expect(revenue).toHaveAttribute('data-h', '3');

  for (let i = 0; i < 5; i += 1) await page.keyboard.press('Shift+ArrowLeft');
  await expect(revenue).toHaveAttribute('data-w', '2');
  await expect(page.getByTestId('dashboard-announcer')).toContainText('en küçük boyutunda');
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('Shift+ArrowUp');
  await expect(revenue).toHaveAttribute('data-h', '2');

  await expect(revenue).toHaveAttribute('data-x', '0');
  const moved = page.waitForResponse(isLayoutSave);
  await page.keyboard.press('ArrowRight');
  await expect(revenue).toHaveAttribute('data-x', '1');
  await expect(page.getByTestId('dashboard-announcer')).toContainText('sütun 2');
  expect((await moved).status()).toBe(200);

  await main.getByRole('button', { name: 'Bitti', exact: true }).click();

  // Reload: the stored board comes back from the server.
  await openBoard(page);
  await expect(card(page, 'Yaklaşan seanslar')).toBeVisible();
  await expect(card(page, 'Ciro')).toHaveAttribute('data-x', '1');
  await expect(card(page, 'Ciro')).toHaveAttribute('data-w', '2');
  await expect(card(page, 'Ciro')).toHaveAttribute('data-h', '2');
});

test('owner resets the board to the default', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await openBoard(page);
  const main = page.getByRole('main');
  await expect(card(page, 'Yaklaşan seanslar')).toBeVisible();

  await main.getByRole('button', { name: 'Diğer işlemler', exact: true }).click();
  await main.getByRole('button', { name: 'Varsayılana dön', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Varsayılan panoya dönülsün mü?' });
  const reset = page.waitForResponse((res) => res.url().includes('/dashboard/layout') && res.request().method() === 'DELETE');
  await confirm.getByRole('button', { name: 'Varsayılana dön', exact: true }).click();
  expect((await reset).status()).toBe(200);

  await expect(card(page, 'Yaklaşan seanslar')).toHaveCount(0);
  await expect(card(page, 'Ciro')).toHaveAttribute('data-x', '0');
  await expect(card(page, 'Ciro')).toHaveAttribute('data-w', '3');
});

test('owner removes a card with the header close button, undoes it, and a removal persists after a reload', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await resetBoard(page);
  await openBoard(page);

  const branches = card(page, 'Şubeler');
  await expect(branches).toBeVisible();
  const before = { x: await branches.getAttribute('data-x'), y: await branches.getAttribute('data-y'), w: await branches.getAttribute('data-w') };

  // The close button shows while the header is hovered, in view mode (no edit mode needed).
  const close = branches.getByRole('button', { name: 'Şubeler kartını kaldır', exact: true });
  await expect(close).toHaveCSS('opacity', '0');
  await branches.getByRole('heading', { name: 'Şubeler' }).hover();
  await expect(close).toHaveCSS('opacity', '1');
  await page.screenshot({ path: test.info().outputPath('dashboard-card-close-hover.png') });

  // Remove, then undo: the card is back at its old place and the restored board is saved.
  await close.click();
  await expect(card(page, 'Şubeler')).toHaveCount(0);
  const toast = page.getByRole('status').filter({ hasText: 'Kart kaldırıldı' });
  await expect(toast).toBeVisible();
  await expect(page.getByTestId('dashboard-announcer')).toContainText('Şubeler kaldırıldı');
  const restoredSave = page.waitForResponse(isLayoutSave);
  await toast.getByRole('button', { name: 'Geri al', exact: true }).click();
  await expect(card(page, 'Şubeler')).toBeVisible();
  await expect(card(page, 'Şubeler')).toHaveAttribute('data-x', before.x ?? '');
  await expect(card(page, 'Şubeler')).toHaveAttribute('data-y', before.y ?? '');
  await expect(card(page, 'Şubeler')).toHaveAttribute('data-w', before.w ?? '');
  expect((await restoredSave).status()).toBe(200);

  // Reload: the restored card is still there.
  await openBoard(page);
  await expect(card(page, 'Şubeler')).toBeVisible();

  // Remove without undo: the removal is stored and survives a reload.
  await card(page, 'Şubeler').getByRole('heading', { name: 'Şubeler' }).hover();
  const removedSave = page.waitForResponse(isLayoutSave);
  await card(page, 'Şubeler').getByRole('button', { name: 'Şubeler kartını kaldır', exact: true }).click();
  await expect(card(page, 'Şubeler')).toHaveCount(0);
  expect((await removedSave).status()).toBe(200);
  await openBoard(page);
  await expect(card(page, 'Ciro')).toBeVisible();
  await expect(card(page, 'Şubeler')).toHaveCount(0);

  await resetBoard(page);
});

test('a trainer is not offered the revenue card', async ({ page }) => {
  await loginAs(page, LOGINS.trainer);
  await resetBoard(page);
  await openBoard(page);
  const main = page.getByRole('main');

  await expect(card(page, 'Ciro')).toHaveCount(0);
  await expect(card(page, 'Bugünün programı')).toBeVisible();

  await main.getByRole('button', { name: 'Kart ekle', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Kart ekle' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('add-card-option').first()).toBeVisible();
  await expect(dialog.locator('[data-widget="revenue"]')).toHaveCount(0);
  await expect(dialog.locator('[data-widget="recentPayments"]')).toHaveCount(0);
  // Single-instance cards already on the board are listed but disabled.
  await expect(dialog.getByRole('button', { name: 'Bugünün programı kartını ekle', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Yaklaşan seanslar kartını ekle', exact: true })).toBeEnabled();
});
