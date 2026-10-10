import { test, expect, type Page } from '@playwright/test';
import { LOGINS, loginAs } from './support/login';
import { uniqueSuffix } from './support/ids';

test.use({ viewport: { width: 1440, height: 1000 } });

const CSRF = { 'x-requested-with': 'platform-web' };

interface Ctx {
  studioId: string;
  emsServiceTypeId: string;
}

/** Calls the API through the BFF with the signed-in session, like the web app does. */
async function api<T>(page: Page, ctx: { studioId: string }, method: string, path: string, body?: unknown): Promise<T> {
  const origin = new URL(page.url()).origin;
  const res = await page.request.fetch(`/api/bff/${path}`, {
    method,
    headers: { ...CSRF, origin, 'x-studio-id': ctx.studioId, 'content-type': 'application/json' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.ok(), `${method} ${path} -> ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function setup(page: Page): Promise<Ctx> {
  await loginAs(page, LOGINS.owner);
  const me = await page.request.get('/api/bff/auth/me', { headers: CSRF });
  const profile = (await me.json()) as { memberships: { studioId: string }[] };
  const cookies = await page.context().cookies();
  const studioId = cookies.find((c) => c.name === 'pw_studio')?.value ?? profile.memberships[0].studioId;
  const serviceTypes = await api<{ id: string; name: string }[]>(page, { studioId }, 'GET', `catalog/service-types/studio/${studioId}`);
  const ems = serviceTypes.find((s) => s.name === 'EMS 20 dk');
  expect(ems, 'seeded EMS service type').toBeTruthy();
  return { studioId, emsServiceTypeId: ems!.id };
}

/** A fresh member per test, so repeated runs against one database never trip the repeat interval by accident. */
async function createMember(page: Page, ctx: Ctx, label: string): Promise<{ id: string; lastName: string; fullName: string }> {
  const suffix = uniqueSuffix().replace(/[^a-z0-9]/gi, '');
  const lastName = `Staffbk${label}${suffix}`;
  const digits = String(Math.floor(Math.random() * 90_000_000) + 10_000_000);
  const created = await api<{ id: string }>(page, ctx, 'POST', 'members', {
    studioId: ctx.studioId,
    firstName: 'Deneme',
    lastName,
    phone: `+90533${digits}`.slice(0, 13),
  });
  return { id: created.id, lastName, fullName: `Deneme ${lastName}` };
}

/** An EMS session `dayOffset` days from now at a random working hour (local time of the test machine). */
async function createEmsSession(page: Page, ctx: Ctx, dayOffset: number, hour: number): Promise<{ id: string; title: string; start: Date }> {
  const start = new Date();
  start.setDate(start.getDate() + dayOffset);
  start.setHours(hour, Math.floor(Math.random() * 3) * 20, 0, 0);
  const end = new Date(start.getTime() + 20 * 60 * 1000);
  const title = `E2E EMS ${uniqueSuffix()}`;
  const created = await api<{ id: string }>(page, ctx, 'POST', 'schedules', {
    studioId: ctx.studioId,
    serviceTypeId: ctx.emsServiceTypeId,
    title,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    capacity: 1,
  });
  return { id: created.id, title, start };
}

/** Books a member through the API, picking the first free spot the session offers. */
async function bookViaApi(page: Page, ctx: Ctx, scheduleId: string, memberId: string): Promise<void> {
  const spots = await api<{ groups: { spots: { id: string; status: string }[] }[] }>(page, ctx, 'GET', `schedules/${scheduleId}/spots`);
  const free = spots.groups.flatMap((g) => g.spots).find((s) => s.status === 'AVAILABLE');
  expect(free, 'a free EMS device').toBeTruthy();
  await api(page, ctx, 'POST', 'schedules/book', { studioId: ctx.studioId, scheduleId, memberId, resourceIds: [free!.id], chargePackage: false });
}

function mondayOf(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** Opens the calendar on the week of the session and selects its block, which opens the side panel. */
async function openSessionPanel(page: Page, session: { title: string; start: Date }) {
  await page.goto('/calendar');
  const weeks = Math.round((mondayOf(session.start) - mondayOf(new Date())) / (7 * 24 * 60 * 60 * 1000));
  for (let i = 0; i < weeks; i += 1) await page.getByRole('button', { name: 'Sonraki' }).click();
  const block = page.getByText(session.title).first();
  await expect(block).toBeVisible();
  await block.click();
  const panel = page.locator('aside');
  await expect(panel.getByRole('heading', { name: session.title })).toBeVisible();
  return panel;
}

/**
 * Searches the member in the booking dialog and picks the first free EMS device. The seeded EMS service is
 * not covered by any seeded package, so by default the staff chooses "do not use a package" explicitly
 * (the API otherwise refuses a booking without a usable package).
 */
async function pickMemberAndSpot(page: Page, member: { lastName: string; fullName: string }, noCharge = true) {
  const dialog = page.getByRole('dialog', { name: 'Seansa üye ekle' });
  await dialog.getByPlaceholder('Ad, soyad veya telefon ara...').fill(member.lastName);
  await dialog.getByRole('button', { name: new RegExp(member.lastName) }).click();
  await expect(dialog.getByText(`Seçilen üye: ${member.fullName}`)).toBeVisible();
  await dialog.getByRole('combobox', { name: /Yer: / }).selectOption({ index: 1 });
  if (noCharge) await dialog.getByRole('combobox', { name: 'Paket' }).selectOption({ label: 'Paket kullanma (hak düşülmez)' });
  return dialog;
}

test('owner adds a member to a session from the calendar panel', async ({ page }) => {
  const ctx = await setup(page);
  const member = await createMember(page, ctx, 'Panel');
  const session = await createEmsSession(page, ctx, 3 + Math.floor(Math.random() * 6), 9 + Math.floor(Math.random() * 8));

  const panel = await openSessionPanel(page, session);
  await expect(panel.getByText('0/1')).toBeVisible();
  await panel.getByRole('button', { name: 'Üye ekle' }).click();
  const dialog = await pickMemberAndSpot(page, member);
  await dialog.getByRole('button', { name: 'Rezervasyonu yap' }).click();

  await expect(page.getByText('Rezervasyon oluşturuldu.')).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(panel.getByRole('link', { name: member.fullName })).toBeVisible();
  await expect(panel.getByText('1/1')).toBeVisible();
});

test('a booking without a usable package is refused unless the staff picks the no-charge option', async ({ page }) => {
  const ctx = await setup(page);
  const member = await createMember(page, ctx, 'NoPkg');
  const session = await createEmsSession(page, ctx, 3 + Math.floor(Math.random() * 6), 9 + Math.floor(Math.random() * 8));

  const panel = await openSessionPanel(page, session);
  await panel.getByRole('button', { name: 'Üye ekle' }).click();
  const dialog = await pickMemberAndSpot(page, member, false);
  await dialog.getByRole('button', { name: 'Rezervasyonu yap' }).click();
  await expect(dialog.getByRole('alert')).toContainText('kullanılabilir paketi yok');
  await expect(panel.getByRole('link', { name: member.fullName })).toHaveCount(0);

  await dialog.getByRole('combobox', { name: 'Paket' }).selectOption({ label: 'Paket kullanma (hak düşülmez)' });
  await dialog.getByRole('button', { name: 'Rezervasyonu yap' }).click();
  await expect(page.getByText('Rezervasyon oluşturuldu.')).toBeVisible();
  await expect(panel.getByRole('link', { name: member.fullName })).toBeVisible();
});

test('owner books a session from the member card', async ({ page }) => {
  const ctx = await setup(page);
  const member = await createMember(page, ctx, 'Card');
  const session = await createEmsSession(page, ctx, 3 + Math.floor(Math.random() * 6), 9 + Math.floor(Math.random() * 8));

  await page.goto('/members');
  await page.getByPlaceholder('Ad, soyad veya telefon ara...').fill(member.lastName);
  await page.getByRole('link', { name: member.fullName }).click();
  await page.waitForURL('**/members/**');

  await page.getByRole('button', { name: 'Rezervasyon yap' }).click();
  const dialog = page.getByRole('dialog', { name: 'Üye için rezervasyon' });
  await dialog.getByRole('button', { name: `Seç: ${session.title}` }).click();
  await expect(dialog.getByText(`Seçilen üye: ${member.fullName}`)).toBeVisible();
  await dialog.getByRole('combobox', { name: /Yer: / }).selectOption({ index: 1 });
  await dialog.getByRole('combobox', { name: 'Paket' }).selectOption({ label: 'Paket kullanma (hak düşülmez)' });
  await dialog.getByRole('button', { name: 'Rezervasyonu yap' }).click();

  await expect(page.getByText('Rezervasyon oluşturuldu.')).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('cell', { name: session.title })).toBeVisible();
});

/** Member already holds an EMS booking one day before the session, which the 2 day rule rejects. */
async function conflictingSetup(page: Page, label: string) {
  const ctx = await setup(page);
  const member = await createMember(page, ctx, label);
  const dayOffset = 3 + Math.floor(Math.random() * 5);
  const earlier = await createEmsSession(page, ctx, dayOffset, 9 + Math.floor(Math.random() * 4));
  const target = await createEmsSession(page, ctx, dayOffset + 1, 9 + Math.floor(Math.random() * 4));
  await bookViaApi(page, ctx, earlier.id, member.id);
  return { ctx, member, target };
}

test('repeat interval rule asks for confirmation and books after the staff confirms', async ({ page }) => {
  const { member, target } = await conflictingSetup(page, 'Ok');
  const panel = await openSessionPanel(page, target);
  await panel.getByRole('button', { name: 'Üye ekle' }).click();
  const dialog = await pickMemberAndSpot(page, member);
  await dialog.getByRole('button', { name: 'Rezervasyonu yap' }).click();

  const confirm = page.getByRole('dialog', { name: 'Asgari gün kuralı' });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText(/en az 2 gün kuralı ihlal ediliyor/)).toBeVisible();
  await confirm.getByRole('button', { name: 'Yine de ekle' }).click();

  await expect(page.getByText('Rezervasyon oluşturuldu.')).toBeVisible();
  await expect(panel.getByRole('link', { name: member.fullName })).toBeVisible();
});

test('declining the repeat interval confirmation leaves the member unbooked', async ({ page }) => {
  const { member, target } = await conflictingSetup(page, 'No');
  const panel = await openSessionPanel(page, target);
  await panel.getByRole('button', { name: 'Üye ekle' }).click();
  const dialog = await pickMemberAndSpot(page, member);
  await dialog.getByRole('button', { name: 'Rezervasyonu yap' }).click();

  const confirm = page.getByRole('dialog', { name: 'Asgari gün kuralı' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Vazgeç' }).click();
  await expect(confirm).toBeHidden();

  await dialog.getByRole('button', { name: 'Vazgeç' }).click();
  await expect(dialog).toBeHidden();
  await expect(panel.getByText('Henüz rezervasyon yok.')).toBeVisible();
  await expect(panel.getByRole('link', { name: member.fullName })).toHaveCount(0);
});
