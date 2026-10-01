import { test, expect } from '@playwright/test';

/**
 * Public event pages (`/events/<studioSlug>`, `/events/<studioSlug>/<event>`) against the seeded demo studio
 * (packages/database/prisma/seed.ts seedEvents(): a PUBLIC published workshop with a standard ticket and a
 * members-only course that must never be listed). Server-rendered, branded by the studio's public config,
 * with schema.org Event structured data. See docs/ETKINLIKLER.md and docs/SEO.md.
 */

const LIST = '/events/zen-reformer-pilates';
const WORKSHOP = 'Hafta sonu atölyesi';

test.describe('public events', () => {
  test('lists only public events and links to the detail page', async ({ page }) => {
    await page.goto(LIST);
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Zen Reformer Pilates');
    const cards = page.getByTestId('public-event-card');
    await expect(cards.filter({ hasText: WORKSHOP })).toHaveCount(1);
    await expect(page.getByText('Başlangıç kursu')).toHaveCount(0);

    await cards.filter({ hasText: WORKSHOP }).click();
    await expect(page).toHaveURL(/\/events\/zen-reformer-pilates\/hafta-sonu-atolyesi-[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(WORKSHOP);
    await expect(page.getByRole('heading', { level: 2, name: 'Biletler' })).toBeVisible();
    await expect(page.getByText('Standart bilet')).toBeVisible();
    // Members-only tickets are never part of the public view.
    await expect(page.getByText('Üye bileti')).toHaveCount(0);
  });

  test('the detail page is indexable and carries Event structured data with a zone offset', async ({ page }) => {
    await page.goto(LIST);
    await page.getByTestId('public-event-card').filter({ hasText: WORKSHOP }).click();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/events\/hafta-sonu-atolyesi-[0-9a-f-]{36}$/);
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'website');
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);

    const docs = await page.locator('script[type="application/ld+json"]').allTextContents();
    const event = docs.map((d) => JSON.parse(d) as Record<string, unknown>).find((d) => d['@type'] === 'Event');
    expect(event).toBeDefined();
    expect(event?.name).toBe(WORKSHOP);
    expect(event?.startDate).toMatch(/T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(event?.endDate).toMatch(/T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(event?.eventStatus).toBe('https://schema.org/EventScheduled');
    expect(event?.eventAttendanceMode).toBe('https://schema.org/OfflineEventAttendanceMode');
    expect(event?.location).toMatchObject({ '@type': 'Place' });
    expect(event?.organizer).toMatchObject({ '@type': 'Organization', name: 'Zen Reformer Pilates' });
    const offers = event?.offers as { price: string; priceCurrency: string }[];
    expect(offers.length).toBeGreaterThan(0);
    expect(offers[0].price).toMatch(/^\d+\.\d{2}$/);
    expect(offers[0].priceCurrency).toMatch(/^[A-Z]{3}$/);
  });

  test('names the time zone once and renders in English on request', async ({ page }) => {
    await page.goto(LIST);
    await page.getByTestId('public-event-card').filter({ hasText: WORKSHOP }).click();
    await expect(page.getByText(/Saatler .+ saat dilimindedir\./)).toHaveCount(1);

    await page.getByLabel('Dil').selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 2, name: 'Tickets' })).toBeVisible();
    await expect(page.getByText(/Times are shown in .+\./)).toHaveCount(1);
  });

  test('an unknown event or studio is a 404 and is not indexed', async ({ page }) => {
    const missingEvent = await page.goto(`${LIST}/no-such-event-00000000-0000-4000-8000-000000000000`);
    expect(missingEvent?.status()).toBe(404);
    const malformed = await page.goto(`${LIST}/not-an-event`);
    expect(malformed?.status()).toBe(404);
    const missingStudio = await page.goto('/events/no-such-studio-slug');
    expect(missingStudio?.status()).toBe(404);
  });
});
