import { test, expect } from '@playwright/test';
import { LOGINS, loginAs } from './support/login';
import { uniqueSuffix } from './support/ids';

test('owner can create a session, see it in week view and open the side panel', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.goto('/calendar');

  const title = `E2E Mat Pilates ${uniqueSuffix()}`;

  await page.getByRole('button', { name: 'Yeni seans' }).click();
  await expect(page.getByText('Yeni seans oluştur')).toBeVisible();

  // Mat Pilates has no required resource type, so the form needs no
  // resource/trainer pick and cannot conflict with any other fixture.
  await page.getByLabel('Başlık').fill(title);
  // getByLabel on a <select> computes its "label" from the wrapping
  // <label>'s full text content, which includes every <option>'s text --
  // so an exact match on just the field label never matches. getByRole's
  // accessible-name computation excludes the control's own rendered value
  // and works correctly here.
  await page.getByRole('combobox', { name: 'Hizmet türü', exact: true }).selectOption({ label: 'Mat Pilates' });
  await page.getByRole('button', { name: 'Seansı oluştur' }).click();

  await expect(page.getByText('Yeni seans oluştur')).toBeHidden();

  // Default view is week; the new session must show up without navigating.
  const block = page.getByText(title).first();
  await expect(block).toBeVisible();

  await block.click();
  const panel = page.locator('aside');
  await expect(panel.getByRole('heading', { name: title })).toBeVisible();
  await expect(panel.getByLabel('Kapat')).toBeVisible();
});
