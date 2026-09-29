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
| `payment.completed` | Ödeme tamamlandı (paket, etkinlik, perakende) | `paymentId` |
| `payment.refunded` | İade (kısmi veya tam) | `paymentId`, `amount`, `fullyRefunded` |
| `lead.created` | Personelin aday eklemesi veya herkese açık aday formu (yeni ya da satış hattına yeniden alınan kişi) | `contactId`, `fullName`, `phone`, `email`, `source` |
| `event.registration.created` | Etkinliğe kayıt (üye, personel veya misafir) | `registrationId`, `eventId`, `ticketTypeId`, `status`, `memberId`, `contactId`, `amountDue`, `currency` |
| `retail.sale.completed` | Mağaza hızlı satışı | `saleId`, `receiptNumber`, `total`, `currency`, `paymentId` (ödeme kaydı yoksa `null`) |

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
`currency`, `total` + `currency`). `payment.completed` ve `payment.refunded`
yalnızca kimlik ve iade tutarını taşır; tutar ve para birimi için ödeme
uç noktasından okuyun (mevcut yük sözleşmesi bozulmadı).

Kapsam dışı olay noktaları (henüz yayın yapmayanlar):

- CRM'de doğrudan "kişi oluştur" (`POST /crm/contacts`) ile `LEAD` evresinde
  açılan kişiler ve gelen mesajdan otomatik oluşan kişiler `lead.created`
  üretmez; yalnızca `/leads` uç noktaları ve herkese açık aday formu üretir.
- Çevrimiçi ödeme sağlayıcısı geri çağrısıyla onaylanan etkinlik kaydı, kayıt
  oluştuğunda değil oluşturma anında yayınlanır (`event.registration.created`
  durum alanı `PENDING_PAYMENT` olabilir).

## Eylemler (Zapier "create" adımları)

Eylemler için yeni uç nokta yoktur; mevcut herkese açık API kullanılır
(`docs/PUBLIC_API.md` bölüm 2):

| Eylem | Uç nokta | Yetki alanı |
|---|---|---|
| Rezervasyon oluştur | `POST /v1/public/bookings` | `bookings.write` |
| Rezervasyon iptal et | `POST /v1/public/bookings/:bookingId/cancel` | `bookings.write` |
| Seansları bul | `GET /v1/public/schedules?from&to` | `schedules.read` |
| Şubeleri / hizmet türlerini bul | `GET /v1/public/branches`, `GET /v1/public/service-types` | `schedules.read` |
| Rezervasyonları bul | `GET /v1/public/bookings` | `bookings.read` |

Üye, aday veya satış oluşturma için herkese açık bir uç nokta bulunmaz;
aday eylemi için herkese açık aday formu (`POST /public/studios/:slug/leads`,
`docs/LEADS.md`) kullanılabilir.

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
