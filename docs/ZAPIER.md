# Zapier ve REST hook otomasyon araçları (G3c-3)

Zapier, Make, n8n ve benzeri araçlar, mevcut API anahtarı ve webhook altyapısı
üzerinden bağlanır. Yeni bir teslimat mekanizması yoktur: bir abonelik, tek
olaya bağlı sıradan bir `WebhookEndpoint` satırıdır; imzalama, yeniden deneme,
otomatik pasifleştirme ve SSRF koruması `docs/PUBLIC_API.md` bölüm 3'teki gibidir.
Zapier CLI uygulaması paketi bu depoda yoktur (Zapier hesabı gerektirir);
aşağıda Zapier Platform arayüzünde elle kurulum adımları verilmiştir.

## Kimlik doğrulama

- İşletme sahibi (`integrations.manage`) Ayarlar > Entegrasyonlar'dan bir API
  anahtarı oluşturur ve `webhooks.manage` yetki alanını (eylemler için ihtiyaç
  duyulan diğer alanları da) seçer. Anahtar bir kez gösterilir.
- Her istek `Authorization: Bearer pk_live_...` başlığı taşır. JWT veya
  `x-studio-id` kullanılmaz; anahtarın işletmesi kiracıdır.
- Anahtar başına hız sınırı `/v1/public/*` ile aynıdır (dakikada 120).

Not: yol öneki mevcut herkese açık API ile tutarlı olarak `/v1/public/...`
biçimindedir.

## Uç noktalar

| Uç nokta | Yetki alanı | Açıklama |
|---|---|---|
| `GET /v1/public/me` | geçerli anahtar | Bağlantı testi: `{ studioId, name, slug, scopes }` |
| `POST /v1/public/hooks` | `webhooks.manage` | `{ targetUrl, event }` -> `201 { id, event, targetUrl, secret, createdAt }` |
| `DELETE /v1/public/hooks/:id` | `webhooks.manage` | `200 { deleted: true }`; başka işletmenin veya olmayan `id` için `404` |
| `GET /v1/public/hooks/samples/:event` | geçerli anahtar | Olay için örnek teslimat yükü |

Abonelik kuralları:

- `targetUrl` yalnızca `https://` olabilir. Adres çözümlenir; özel, loopback,
  link-local, bulut metadata (`169.254.169.254`) ve ayrılmış IP'lere işaret
  eden adresler `400` ile reddedilir (`apps/api/src/modules/webhooks/ssrf-check.ts`,
  personel uç noktasıyla aynı kontrol; her teslimatta yeniden doğrulanır ve
  bağlantı çözümlenen IP'ye sabitlenir).
- Bir abonelik tek olayı dinler. Aynı olay için birden çok abonelik
  (Zap) açılabilir; işletme başına en fazla 100 abonelik.
- `secret` yalnızca bu yanıtta döner; teslimat imzası (`X-Signature`)
  `docs/PUBLIC_API.md` bölüm 3'te anlatılır. Zapier çoğu durumda imzayı
  doğrulamaz; doğrulamak isteyen Code adımıyla yapabilir.
- Abonelikler personelin Entegrasyonlar sayfasında da görünür ve oradan
  pasifleştirilebilir veya silinebilir (denetim kaydı `webhooks.rest_hook.*`
  API anahtarı kimliğini taşır).

## Olaylar

Katalog: `packages/shared/src/open-platform.ts` -> `WEBHOOK_EVENTS`. Her
teslimat `{ event, studioId, occurredAt, data }` zarfıdır.

| Olay | Tetikleyen | `data` alanları |
|---|---|---|
| `member.created` | Personelin üye eklemesi (`MembersService.createMember`) | `membershipId`, `firstName`, `lastName` |
| `booking.created` | Rezervasyon oluşturma | `bookingId`, `scheduleId`, `memberId` |
| `booking.cancelled` | Rezervasyon iptali | `bookingId`, `scheduleId`, `memberId`, `isLateCancellation` |
| `booking.attended` | Yoklama | `bookingId`, `scheduleId`, `memberId` |
| `payment.completed` | Ödeme tamamlandı (paket, etkinlik, perakende; misafir ve kayıtsız müşteri dahil) | `paymentId`, `memberId` (misafirde `null`), `contactId`, `amount`, `currency` |
| `payment.refunded` | İade (kısmi veya tam) | `paymentId`, `memberId`, `contactId`, `amount`, `currency`, `fullyRefunded` |
| `lead.created` | Personelin aday eklemesi veya herkese açık aday formu (yeni ya da satış hattına yeniden alınan kişi) | `contactId`, `fullName`, `phone`, `email`, `source` |
| `event.registration.created` | Etkinliğe kayıt (üye, personel veya misafir) | `registrationId`, `eventId`, `ticketTypeId`, `status`, `memberId`, `contactId`, `amountDue`, `currency` |
| `retail.sale.completed` | Mağaza hızlı satışı | `saleId`, `receiptNumber`, `total`, `currency`, `paymentId` (her yeni satışta dolu) |
| `studio.signup` (yalnızca platform kiracısı) | Süper adminin yeni işletme oluşturması | `studioId`, `name`, `slug`, `countryCode`, `ownerContactId` (platform CRM'i sahibi tanıyorsa) |
| `studio.paid` (yalnızca platform kiracısı) | İşletmenin ödemeyle veya ödeme kaydıyla etkinleşmesi | `studioId`, `name`, `planKey`, `amount`, `currency` |
| `studio.trial_expiring` (yalnızca platform kiracısı) | Deneme bitimine 7, 3 ve 1 gün kala (eşik başına bir kez) | `studioId`, `name`, `trialEndsAt`, `daysLeft` |
| `contact.lifecycle_changed` (yalnızca platform kiracısı) | Platform kiracısındaki bir kişinin yaşam döngüsü aşamasının değişmesi | `contactId`, `from`, `to`, `event` |
| `campaign.sent` (yalnızca platform kiracısı) | Platform kampanyasının gönderiminin tamamlanması | `campaignId`, `name`, `channel`, `audience`, `sent`, `skipped`, `failed` |

Platform olayları işletmenin kendi iş olayları değil platformun kendi işidir; yalnızca
platform kiracısının API anahtarıyla (`/platform/integrations` veya `/pazarlama/entegrasyonlar`'da
oluşturulan) abone olunabilir. Başka kiracının anahtarıyla abonelik `400` döner ve bu olaylar
hiçbir zaman başka kiracının aboneliğine kuyruklanmaz.

Örnek yükler `WEBHOOK_SAMPLE_DATA` kataloğundadır (tek doğruluk kaynağı,
`packages/shared/src/open-platform.ts`); `GET /v1/public/hooks/samples/:event`
aynı verileri işletme kimliğiyle ve şimdiki zamanla zarfa koyar. Örnek:

```json
{
  "event": "lead.created",
  "studioId": "0b0a...",
  "occurredAt": "2026-09-29T10:00:00.000Z",
  "data": {
    "contactId": "6d1f2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a06",
    "fullName": "Mehmet Demir",
    "phone": "+905551112233",
    "email": "mehmet@example.com",
    "source": "WEB_FORM"
  }
}
```

Tutar alanları her zaman para birimiyle birlikte gelir (`amountDue` +
`currency`, `total` + `currency`, `amount` + `currency`). `payment.completed`
ve `payment.refunded` yüklerine `memberId`, `contactId`, tutar ve para birimi
eklendi (yalnızca ekleme; mevcut alanlar aynı). Misafir veya kayıtsız müşteri
ödemesinde `memberId` `null`'dır; `contactId` ödeyen kişiyi, anonim satışta
`null` gösterir.

Kapsam dışı olay noktaları (henüz yayın yapmayanlar):

- CRM'de doğrudan "kişi oluştur" (`POST /crm/contacts`) ile `LEAD` evresinde
  açılan kişiler ve gelen mesajdan otomatik oluşan kişiler `lead.created`
  üretmez; yalnızca `/leads` uç noktaları ve herkese açık aday formu üretir.
- Çevrimiçi ödeme sağlayıcısı geri çağrısıyla onaylanan etkinlik kaydı, kayıt
  oluştuğunda değil oluşturma anında yayınlanır (`event.registration.created`
  durum alanı `PENDING_PAYMENT` olabilir).

## Eylemler (Zapier "create" adımları)

Eylemler mevcut herkese açık API'yi kullanır (`docs/PUBLIC_API.md` bölüm 2;
gelen kişi eylemleri M4c ile eklendi, aşağıda):

| Eylem | Uç nokta | Yetki alanı |
|---|---|---|
| Rezervasyon oluştur | `POST /v1/public/bookings` | `bookings.write` |
| Rezervasyon iptal et | `POST /v1/public/bookings/:bookingId/cancel` | `bookings.write` |
| Seansları bul | `GET /v1/public/schedules?from&to` | `schedules.read` |
| Şubeleri / hizmet türlerini bul | `GET /v1/public/branches`, `GET /v1/public/service-types` | `schedules.read` |
| Rezervasyonları bul | `GET /v1/public/bookings` | `bookings.read` |

Gelen kişi eylemleri (M4c, `crm.write` kapsamı, ayrıntılar `docs/PUBLIC_API.md` bölüm 2.1):

| Eylem | Uç nokta | Yetki alanı |
|---|---|---|
| Kişi oluştur veya güncelle (e-posta ya da telefonla, `Idempotency-Key` destekli) | `POST /v1/public/contacts` | `crm.write` |
| Kişiye etiket ekle | `POST /v1/public/contacts/:id/tags` | `crm.write` |
| İletişim izni kaydet (dayanak ve form sürümüyle) | `POST /v1/public/contacts/:id/consents` | `crm.write` |

Zapier, aynı adımın yeniden denenmesinde ikinci kayıt oluşmasın diye her çalıştırmada
sabit bir `Idempotency-Key` (örneğin Zap çalıştırma kimliği) göndermelidir. Üye veya
satış oluşturma için herkese açık bir uç nokta yoktur.

Make "instant trigger" için aynı REST hook uçlarını kullanır: bağlama (attach)
`POST /v1/public/hooks`, ayırma (detach) `DELETE /v1/public/hooks/:id`. n8n
"Webhook" tetikleyicisi de aynı aboneliği kullanır; imza doğrulaması
`docs/PUBLIC_API.md` bölüm 3'tedir.

## Zapier Platform arayüzünde elle kurulum

1. developer.zapier.com'da yeni bir entegrasyon oluşturun (Platform UI).
2. Authentication: "API Key" türü. Alan adı `apiKey`; "Add API Key to Header"
   ile `Authorization` başlığına `Bearer {{bundle.authData.apiKey}}` yazın.
   Test isteği: `GET https://<api-adresi>/v1/public/me`; bağlantı etiketi
   `{{bundle.inputData.name}}`.
3. Her tetikleyici için Triggers > "Create a Trigger", tür "REST Hook":
   - Subscribe: `POST https://<api-adresi>/v1/public/hooks`, gövde
     `{"targetUrl": "{{bundle.targetUrl}}", "event": "lead.created"}`;
     yanıttaki `id` abonelik kimliği olarak saklanır.
   - Unsubscribe: `DELETE https://<api-adresi>/v1/public/hooks/{{bundle.subscribeData.id}}`.
   - Perform: gelen gövdeyi `[bundle.cleanedRequest]` olarak döndürün.
   - Perform List (örnek veri): `GET https://<api-adresi>/v1/public/hooks/samples/lead.created`
     yanıtını `[response]` olarak döndürün; alan eşleme ekranında örnek
     alanlar görünür.
   - Kullanılabilir `event` değerleri: yukarıdaki tablo.
4. Eylemler için Actions > "Create an Action" ile yukarıdaki eylem tablosundaki
   uç noktaları HTTP isteği olarak tanımlayın.
5. Test edin, sonra "Invite Users" ile özel paylaşın; herkese açık yayın için
   Zapier incelemesi gerekir.

## Kod ve testler

- Uç noktalar: `apps/api/src/modules/public-api/hooks-public.controller.ts`;
  abonelik mantığı `WebhooksService.subscribeRestHook` / `unsubscribeRestHook`.
- Yayıncılar: `SchedulesService`, `MembersService`, `PaymentsService`
  (mevcut), `LeadsCompatService` (`lead.created`), `EventRegistrationsService`
  (`event.registration.created`), `RetailSalesService` (`retail.sale.completed`).
- Testler: `packages/shared/src/accounting.spec.ts` (örnek katalog, olay
  kataloğuyla eşitlik), `apps/api/test/e2e/zapier-hooks.e2e-spec.ts` (anahtar
  zorunlu, tek olaya abonelik, SSRF reddi, silme, örnekler, başka işletme
  anahtarı silemez, `lead.created` ve `retail.sale.completed` teslimat satırı).
- M4c: gelen eylemler `apps/api/src/modules/public-api/contacts-public.controller.ts`
  (`PublicContactsService`, `PublicIdempotencyService`); platform olayları
  `PlatformEventsService` (`apps/api/src/modules/webhooks/platform-events.service.ts`)
  üzerinden `CrmHooksService`, `PlatformBillingService`, `BillingJobsService`,
  `ContactsService`/`ConversionService` ve `CampaignsService` tarafından yayınlanır.
  Testler: `packages/shared/src/marketing/lead-ads.spec.ts`,
  `apps/api/src/modules/public-api/idempotency.*.spec.ts`,
  `apps/api/test/e2e/lead-ads-automation.e2e-spec.ts`.
