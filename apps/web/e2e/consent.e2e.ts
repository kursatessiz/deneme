import { expect, test, type Page, type Request } from '@playwright/test';

/**
 * G1b consent banner and visitor tracking on the public product page
 * (studio slug `platform`). The region comes from the CF-IPCountry header
 * here, as it would from Cloudflare/Caddy in production.
 */

function trackRequests(page: Page): Request[] {
  const seen: Request[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/track\/platform\/touchpoint$/.test(req.url())) seen.push(req);
  });
  return seen;
}

async function cookie(page: Page, name: string) {
  return (await page.context().cookies()).find((c) => c.name === name);
}

test.describe('consent banner', () => {
  test('EU: nothing is stored or sent before consent; accepting starts tracking', async ({ browser }) => {
    const context = await browser.newContext({ extraHTTPHeaders: { 'CF-IPCountry': 'DE' } });
    const page = await context.newPage();
    const sent = trackRequests(page);
    await page.goto('/');

    const banner = page.getByTestId('consent-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('data-consent-mode', 'opt_in');
    expect(await cookie(page, 'pw_vid')).toBeUndefined();
    expect(await cookie(page, 'pw_sid')).toBeUndefined();
    expect(sent).toHaveLength(0);

    const request = page.waitForRequest((req) => /\/track\/platform\/touchpoint$/.test(req.url()));
    await banner.getByRole('button', { name: 'Tümünü kabul et' }).click();
    const body = (await request).postDataJSON() as { consent: { analytics: boolean; advertising: boolean }; visitorId: string };
    expect(body.consent).toEqual({ analytics: true, advertising: true });
    await expect(banner).toBeHidden();
    expect((await cookie(page, 'pw_vid'))?.value).toBe(body.visitorId);
    expect((await cookie(page, 'pw_consent'))?.value).toBe('v1.a1.m1');
    await context.close();
  });

  test('EU: rejecting stores only the choice and never tracks', async ({ browser }) => {
    const context = await browser.newContext({ extraHTTPHeaders: { 'CF-IPCountry': 'FR' } });
    const page = await context.newPage();
    const sent = trackRequests(page);
    await page.goto('/');
    await page.getByTestId('consent-banner').getByRole('button', { name: 'Tümünü reddet' }).click();
    await expect(page.getByTestId('consent-banner')).toBeHidden();
    await page.reload();
    await expect(page.getByTestId('consent-banner')).toHaveCount(0);
    expect((await cookie(page, 'pw_consent'))?.value).toBe('v1.a0.m0');
    expect(await cookie(page, 'pw_vid')).toBeUndefined();
    expect(sent).toHaveLength(0);
    await context.close();
  });

  test('EU: categories can be chosen one by one', async ({ browser }) => {
    const context = await browser.newContext({ extraHTTPHeaders: { 'CF-IPCountry': 'NL' } });
    const page = await context.newPage();
    await page.goto('/');
    const banner = page.getByTestId('consent-banner');
    await banner.getByRole('button', { name: 'Tercihleri seç' }).click();
    await banner.locator('input[name="analytics"]').check();
    const request = page.waitForRequest((req) => /\/track\/platform\/touchpoint$/.test(req.url()));
    await banner.getByRole('button', { name: 'Seçimimi kaydet' }).click();
    const body = (await request).postDataJSON() as { consent: { analytics: boolean; advertising: boolean } };
    expect(body.consent).toEqual({ analytics: true, advertising: false });
    expect((await cookie(page, 'pw_consent'))?.value).toBe('v1.a1.m0');
    await context.close();
  });

  test('TR: KVKK notice with accept and reject', async ({ browser }) => {
    const context = await browser.newContext({ extraHTTPHeaders: { 'CF-IPCountry': 'TR' } });
    const page = await context.newPage();
    await page.goto('/');
    const banner = page.getByTestId('consent-banner');
    await expect(banner).toHaveAttribute('data-consent-mode', 'kvkk');
    await expect(banner).toContainText('KVKK');
    await expect(banner.getByRole('button', { name: 'Tümünü reddet' })).toBeVisible();
    expect(await cookie(page, 'pw_vid')).toBeUndefined();
    await context.close();
  });

  test('US: notice tracks right away and Global Privacy Control turns advertising off', async ({ browser }) => {
    const context = await browser.newContext({ extraHTTPHeaders: { 'CF-IPCountry': 'US' }, locale: 'en-US' });
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true });
    });
    const page = await context.newPage();
    const request = page.waitForRequest((req) => /\/track\/platform\/touchpoint$/.test(req.url()));
    await page.goto('/?utm_source=google&gclid=G-1');
    const body = (await request).postDataJSON() as { consent: { advertising: boolean }; clickIds: Record<string, string> };
    expect(body.consent.advertising).toBe(false);
    expect(body.clickIds).toEqual({});
    const banner = page.getByTestId('consent-banner');
    await expect(banner).toHaveAttribute('data-consent-mode', 'notice');
    expect(await cookie(page, 'pw_vid')).toBeDefined();
    await context.close();
  });
});
