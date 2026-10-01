# Açık platform (W18): API anahtarları, herkese açık API ve webhook'lar

Bu belge; üçüncü taraf entegrasyonların kullandığı API anahtarlı herkese açık
REST API'yi, giden webhook'ları ve web sitesine gömülebilir rezervasyon
widget'ını özetler.

## 1. API anahtarları

Personel, `integrations.manage` iznine sahipse (sahip her zaman sahiptir)
işletme paneli veya mobil "Hesabım > Entegrasyonlar" ekranından anahtar
oluşturur.

- Biçim: `pk_live_<8 karakter önek>_<32 karakter gizli kısım>`.
- Yalnızca önekle tuzlanmış scrypt özeti (`secretHash`) veritabanında saklanır; düz metin
  yalnızca oluşturma anında bir kez döner (`plaintext` alanı). Anahtar
  kaybedilirse yeniden oluşturmak gerekir; mevcut anahtar tekrar gösterilemez.
- Karşılaştırma sabit zamanlıdır (`crypto.timingSafeEqual`), zamanlama
  saldırılarına karşı.
- Yetki alanları (`scopes`), tek doğruluk kaynağı olarak
  `packages/shared/src/open-platform.ts` içindeki `API_KEY_SCOPES`
  kataloğundan seçilir: `schedules.read`, `bookings.read`, `bookings.write`,
  `members.read`, `webhooks.manage`, `crm.write` (M4c: kişi oluşturma, etiket
  ve iletişim izni kaydı).
- `expiresAt` isteğe bağlıdır; süresi dolan veya iptal edilen (`revokedAt`)
  anahtar `401 Unauthorized` döner.

### Personel uç noktaları (JWT + `x-studio-id`, `integrations.manage`)

| Uç nokta | Açıklama |
|---|---|
| `POST /integrations/api-keys` | Yeni anahtar oluşturur, `plaintext` yalnızca bu yanıtta döner |
| `GET /integrations/api-keys` | Anahtarları listeler (gizli kısım hiçbir zaman dönmez) |
| `DELETE /integrations/api-keys/:id` | Anahtarı iptal eder (`revokedAt` set edilir, satır silinmez) |

## 2. Herkese açık API (`/v1/public/*`)

Kimlik doğrulama: `Authorization: Bearer pk_live_...`. JWT veya
`x-studio-id` **kullanılmaz**; anahtarın bağlı olduğu işletme, kiracı
bağlamı olur (ayrı bir `ApiKeyGuard`, `JwtAuthGuard`/`StudioTenantGuard`'dan
tamamen bağımsız). Her uç nokta bir veya birden çok yetki alanı ister; eksik
yetki alanı `403 Forbidden` (anahtarın kendisi geçerliyse), geçersiz/iptal/
süresi dolmuş anahtar `401 Unauthorized` döner.

Anahtar başına hız sınırı: dakikada 120 istek (Redis varsa paylaşılan
sayaç, yoksa tek örnek bellek içi sayaç), aşımda `429 Too Many Requests`.

| Uç nokta | Yetki alanı | Açıklama |
|---|---|---|
| `GET /v1/public/branches` | `schedules.read` | Aktif şubeler; `timezone` etkin saat dilimidir (şubenin kendisi, yoksa işletmeninki) |
| `GET /v1/public/service-types` | `schedules.read` | Aktif hizmet türleri |
| `GET /v1/public/schedules?from&to&branchId` | `schedules.read` | Tarih aralığı en fazla 31 gün |
| `GET /v1/public/bookings?page&pageSize&branchId&scheduleId` | `bookings.read` | Sayfalı liste |
| `POST /v1/public/bookings` | `bookings.write` | `{ scheduleId, memberPhone, memberPackageId?, resourceIds? }` -- mevcut, aktif bir üye için rezervasyon oluşturur |
| `POST /v1/public/bookings/:bookingId/cancel` | `bookings.write` | `{ reason? }` |
| `GET /v1/public/me` | (yalnızca geçerli anahtar) | Bağlantı testi: işletme adı ve anahtarın yetki alanları (`docs/ZAPIER.md`) |
| `POST /v1/public/hooks` | `webhooks.manage` | REST hook aboneliği: `{ targetUrl, event }` (`docs/ZAPIER.md`) |
| `DELETE /v1/public/hooks/:id` | `webhooks.manage` | Aboneliği siler |
| `GET /v1/public/hooks/samples/:event` | (yalnızca geçerli anahtar) | Olay için örnek teslimat yükü |
| `POST /v1/public/contacts` | `crm.write` | Kişiyi e-posta veya telefonla oluşturur ya da günceller (bölüm 2.1) |
| `POST /v1/public/contacts/:id/tags` | `crm.write` | Etiket ekler |
| `POST /v1/public/contacts/:id/consents` | `crm.write` | Ticari iletişim izni kaydeder veya geri alır |

Rezervasyon kuralları (kapasite, hak/kredi düşümü, iptal politikası) mevcut
`SchedulesService.bookSession()` / `cancelBooking()` üzerinden **aynen**
uygulanır; herkese açık API bu servisleri yeniden çağırır, kuralları tekrar
yazmaz.

### 2.1 Gelen eylemler: kişi, etiket, izin (M4c, `crm.write`)

Zapier, Make ve n8n gibi araçların CRM'e yazması içindir. Aynı API anahtarı
kimlik doğrulaması ve aynı anahtar başına hız sınırı (dakikada 120) geçerlidir.
Her sorgu anahtarın işletmesiyle sınırlıdır; başka işletmenin kişisi `404`
(`CONTACT_NOT_FOUND`) döner. Telefon numarası yanıtta her zaman maskelidir.

**`POST /v1/public/contacts`**: kişiyi oluşturur (`201`) veya aynı e-posta ya da
telefona sahip mevcut kişiyi günceller (`200`).

```json
{
  "email": "grace@example.com",
  "phone": "+4915112345678",
  "fullName": "Grace Hopper",
  "locale": "en",
  "countryCode": "DE",
  "isBusiness": false,
  "tags": ["vip", "zapier"],
  "customFields": { "company": "Acme" },
  "sourceDetail": "Typeform spring"
}
```

E-posta veya telefondan biri zorunludur. `firstName`/`lastName` yerine
`fullName` verilebilir (son sözcük soyadı olur); ad hiç verilmezse e-postanın
yerel kısmı kullanılır. Telefon E.164 veya işletmenin ülkesindeki ulusal
biçimdir. `customFields` işletmenin tanımlı özel alanlarına karşı doğrulanır
(tanımsız alan `400`). Güncellemede yalnızca gönderilen alanlar değişir; e-posta
ve telefon eşleştirme için kullanılır, ezilmez. Kişi satış hattına girmez, `lead`
dönüşümü veya `lead.created` üretmez; kaynak kanal `API` olarak işaretlenir.

```json
{ "created": true, "contact": { "id": "6d1f...", "firstName": "Grace", "lastName": "Hopper", "email": "grace@example.com", "phone": "+49 *** *** ** 78", "tags": ["vip", "zapier"], "lifecycleStage": "LEAD", "createdAt": "2026-10-27T10:00:00.000Z" } }
```

**`Idempotency-Key`** (isteğe bağlı başlık, 8-128 karakter, harf/rakam/`. _ : -`):
istek 24 saat boyunca saklanır.

| Durum | Sonuç |
|---|---|
| Aynı anahtar, aynı yöntem + yol + gövde | Saklanan yanıt aynen (durum kodu dahil) ve `Idempotent-Replayed: true` başlığı; ikinci bir kişi oluşmaz |
| Aynı anahtar, farklı istek | `422`, `code: IDEMPOTENCY_KEY_REUSED` |
| Aynı anahtarlı ilk istek hâlâ sürüyor | `409`, `code: IDEMPOTENCY_IN_PROGRESS` |
| İlk istek hata verdi | Anahtar serbest kalır, düzeltilmiş istek aynı anahtarla gönderilebilir |
| Biçimi geçersiz anahtar | `400` |
| 24 saat geçti | Kayıt silinir, anahtar yeniden kullanılabilir |

Anahtar işletme başınadır; başka işletmenin aynı adlı anahtarı ayrıdır. Başlık
verilmezse aynı gövde her seferinde bir güncelleme olur (kişi zaten tekildir).

**`POST /v1/public/contacts/:id/tags`**: `{ "tags": ["customer"] }` (1-20 etiket;
küçük harfe çevrilir, boşluklar sadeleşir, geçersiz etiket `400`). Kişi başına en
fazla 50 etiket; aşımda `422`. Yanıt kişidir.

**`POST /v1/public/contacts/:id/consents`**: ticari iletişim iznini M3e kurallarıyla
kaydeder (`docs/PAZARLAMA_MODULU.md` 6.4):

```json
{ "channels": ["EMAIL", "SMS"], "granted": true, "legalBasis": "CONSENT", "formVersion": "typeform-spring-v3", "countryCode": "DE", "locale": "en" }
```

- `channels`: `EMAIL`, `SMS`, `WHATSAPP`; kişinin o kanal için adresi yoksa `422`
  (`CONSENT_CHANNEL_ADDRESS_MISSING`).
- `legalBasis` (varsayılan `CONSENT`): `CONSENT` için `formVersion` zorunludur (kişinin
  gördüğü metnin sürümü kanıt olarak saklanır). Kişinin ülkesi (kayıtlı ülke, yoksa
  istekteki `countryCode`, yoksa telefonun ülkesi) işletmenin çift onay bölgelerindeyse
  izin `pendingConfirmation: true` ile bekler ve kişiye onay e-postası gider; bağlantı
  tıklanana kadar ticari kitleye girmez. `TR_MERCHANT_EXEMPTION` yalnızca "işletme"
  işaretli TR kişisinde ve işletmenin tacir muafiyeti ayarı açıkken kaydedilir, aksi
  halde `409` (`CONSENT_BASIS_NOT_ALLOWED`). `EXISTING_CUSTOMER` gönderim anında
  müşteri ilişkisinden türetilir ve kaydedilemez (`422`, aynı kod).
- `granted: false` izni geri alır (her zaman geçerlidir; abonelikten çıkmış bir adresin
  bastırma kaydı korunur ve `suppressed: true` görünür).
- Çift onay politikası işletmenin `marketing_settings` satırındadır; satırı olmayan
  işletmede (platform kiracısı dışındaki varsayılan) çift onay uygulanmaz, davranış
  M3e öncesiyle aynıdır.

```json
{ "contactId": "6d1f...", "doubleOptIn": true, "channels": [ { "channel": "EMAIL", "status": "GRANTED", "legalBasis": "CONSENT", "pendingConfirmation": true, "suppressed": false } ] }
```

Her yazma `AuditLog`'a (`public_api.contact.upsert`, `public_api.contact.tags_add`,
`public_api.contact.consent`) anahtar kimliğiyle yazılır.

### Telefon numarası maskeleme

`GET /v1/public/bookings` yanıtındaki `member.phone` alanı, anahtarın
`members.read` yetki alanı **yoksa** maskelenir (`+90 *** *** ** 67`), varsa
tam numara döner. Maskeleme `packages/shared/src/open-platform.ts` içindeki
`maskPhone()` ile yapılır.

### Swagger

Geliştirme ortamında `/api/docs` altında "Public API" ve "Integrations"
grupları altında listelenir (`NODE_ENV=production` dışında etkin).

## 3. Webhook'lar

Personel (`integrations.manage`), `POST /integrations/webhooks` ile bir uç
nokta tanımlar: `{ url, events, isActive? }`.

- `url` yalnızca `https://` olabilir; oluşturma **ve** her teslimat anında
  (DNS çözümlemesinden sonra) özel/loopback/link-local/ayrılmış bir IP'ye
  işaret edip etmediği kontrol edilir (SSRF ve DNS rebinding önlemi, bkz.
  `apps/api/src/modules/webhooks/ssrf-guard.ts` ve `ssrf-check.ts`). IPv4
  özel aralıkları, `169.254.169.254` bulut metadata adresi, IPv6 loopback/
  link-local/unique-local (`fc00::/7`) ve IPv4-mapped IPv6 (`::ffff:...`)
  adresleri reddedilir.
- Olaylar (`packages/shared/src/open-platform.ts` -> `WEBHOOK_EVENTS`):
  `booking.created`, `booking.cancelled`, `booking.attended`,
  `member.created`, `payment.completed`, `payment.refunded`; G3c-3 ile
  `lead.created`, `event.registration.created`, `retail.sale.completed`
  eklendi (yük örnekleri ve Zapier bağlantısı: `docs/ZAPIER.md`). M4c ile
  platform olayları eklendi: `studio.signup`, `studio.paid`,
  `studio.trial_expiring`, `contact.lifecycle_changed`, `campaign.sent`. Bunlar
  yalnızca platform kiracısının (`Studio.isPlatform`) abonelikleri için yayınlanır;
  başka bir kiracının bu olaylara aboneliği `400` ile reddedilir.
- Gizli anahtar (`secret`) yalnızca oluşturma ve `rotate-secret` anında bir
  kez döner.

### Personel uç noktaları (JWT + `x-studio-id`, `integrations.manage`)

| Uç nokta | Açıklama |
|---|---|
| `POST /integrations/webhooks` | Oluşturur, `secret` bu yanıtta bir kez döner |
| `GET /integrations/webhooks` | Listeler (gizli anahtar dönmez) |
| `PUT /integrations/webhooks/:id` | Günceller (`url`, `events`, `isActive`) |
| `DELETE /integrations/webhooks/:id` | Siler |
| `POST /integrations/webhooks/:id/rotate-secret` | Yeni bir gizli anahtar üretir, eskisini geçersiz kılar |
| `GET /integrations/webhooks/:id/deliveries?page&pageSize` | Teslimat geçmişi |
| `POST /integrations/webhooks/:id/deliveries/:deliveryId/redeliver` | Teslimatı tekrar kuyruğa alır |
| `POST /integrations/webhooks/:id/test-event` | `{ event }` -- gerçek bir işlem olmadan test teslimatı oluşturur |

### İmza doğrulama

Her teslimat isteği `X-Signature: t=<unix saniye>,v1=<hex hmac-sha256>`
başlığını taşır; imza `${t}.${gövde}` üzerinden hesaplanır
(`apps/api/src/modules/webhooks/webhook-signature.ts`). TypeScript ile
doğrulama örneği:

```typescript
import { createHmac, timingSafeEqual } from 'crypto';

function verifyWebhookSignature(secret: string, rawBody: string, header: string, maxAgeSeconds = 300): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > maxAgeSeconds) return false; // replay protection

  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(v1, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Önemli: `rawBody`, JSON.parse edilmeden önceki ham istek gövdesi olmalıdır
(sunucu tarafında ayrıştırılmış ve yeniden serileştirilmiş bir gövde farklı
bayt dizisi üretebilir ve doğrulamayı bozar).

### Yeniden deneme politikası

Teslimat 5 saniye zaman aşımı ile denenir, yönlendirme (redirect) takip
edilmez, yanıt gövdesinin yalnızca ilk 500 karakteri kaydedilir. Başarısız
bir teslimat üstel geri çekilme ile en fazla 6 deneme sonuna kadar tekrar
dener (`packages/shared/src/open-platform.ts` -> `WEBHOOK_RETRY_DELAYS_SECONDS`):

| Deneme | Bir önceki denemeden sonraki bekleme |
|---|---|
| 1 | anında |
| 2 | 30 saniye |
| 3 | 2 dakika |
| 4 | 10 dakika |
| 5 | 30 dakika |
| 6 | 1 saat |

6. denemeden sonra hâlâ başarısızsa teslimat `ABANDONED` işaretlenir. Bir uç
nokta arka arkaya 20 başarısız teslimatın ardından otomatik olarak pasif
hale getirilir (`isActive=false`); personel `PUT` ile tekrar etkinleştirene
kadar yeni teslimat denemez.

Teslimat, mevcut 15 dakikalık zamanlayıcı nabzına eklenmiştir
(`JobsService.runAll()`, bkz. `docs/AUTOMATIONS.md`): `REDIS_URL`
tanımlıysa BullMQ'nun tekrarlanan işi üzerinden, tanımlı değilse (yerel
geliştirme, testler) aynı `POST /admin/scheduler/run` uç noktasıyla veya
`JobsService.runAll()` çağrısıyla çalışır. Yani bir olayın ilk teslim
denemesi, sonraki zamanlayıcı nabzına kadar (üretimde en fazla 15 dakika)
gecikebilir; anlık bir teslimat garantisi verilmez.

### DNS rebinding korumasi: çözümlenen IP adresi bağlanılan adrestir

Bir hostname'in oluşturma anında (ve her teslimattan hemen önce) genel bir
IP'ye çözümlendiğini doğrulamak tek başına yeterli değildir: saldırganın
kontrolündeki bir DNS sunucusu, doğrulama sorgusuna genel bir IP, hemen
ardından gerçek bağlantı sırasında yapılacak ayrı bir çözümlemeye özel bir
IP döndürebilir (DNS rebinding). Bu nedenle `WebhookDispatcherService`,
`resolvePublicHttpsAddresses()` ile doğrulanan adresi bağlantı için
**sabitler** (pin): Node'un `https.request()` çağrısına özel bir `lookup`
fonksiyonu verilir ve bu fonksiyon, hostname ne olursa olsun her zaman aynı,
önceden doğrulanmış IP adresini döndürür -- istek gövdesi hostname'i ikinci
kez çözümlemez. TLS sertifika doğrulaması yine de gerçek hostname'e karşı
yapılır (Node varsayılan olarak `servername`'i `hostname`'den alır);
yalnızca soketin bağlandığı adres sabitlenir. Birim testi:
`apps/api/src/modules/webhooks/webhook-dispatcher.service.spec.ts`.

## 4. Gömülebilir rezervasyon widget'ı

### Widget neden doğrudan rezervasyon yapmaz

İlk sürümde widget, üye telefon numarasıyla eşleştirerek rezervasyon
oluşturan/iptal eden kimliksiz bir uç nokta çağırıyordu; bir güvenlik
incelemesi bunun ciddi bir açık olduğunu ortaya çıkardı: **herhangi biri**,
bir üyenin telefon numarasını bilerek (veya deneyerek) o üye adına
rezervasyon oluşturabilir, mevcut rezervasyonları iptal edebilir ve bir
numaranın üye olup olmadığını (hangi hatanın döndüğüne bakarak) sınayabilirdi.
IP başına hız sınırı bunu *yavaşlatır*, ama kimlik doğrulamanın yerini
tutmaz -- üçüncü taraf bir web sitesine gömülen bir sayfanın, ziyaretçinin
gerçekten o üye olduğunu doğrulayacak hiçbir yolu yoktur (JWT oturumu,
`x-studio-id` veya bir API anahtarı burada kullanılamaz; hepsi ya gizli
tutulamaz ya da "ben buyum" iddiasını doğrulamaz).

Bu nedenle widget'ın rezervasyon adımı, doğrudan bir yazma uç noktası yerine
iki yola ayrılır:

1. **"Üyeyim"**: seçilen seans için mobil uygulamanın kendi seans ekranını
   (`apps/mobile/app/(app)/seans/[scheduleId].tsx`) Expo şema derin
   bağlantısıyla (`app.json` -> `"scheme": "platform"`) açar:
   `platform://seans/<scheduleId>`. Rezervasyon yalnızca orada, üye zaten
   oturum açmışken gerçekleşir. Uygulama yüklü değilse bağlantı hiçbir şey
   yapmaz; CLAUDE.md'de anlatılan `/j/<token>` gecikmeli evrensel bağlantısı
   davet akışına özgüdür ve bu widget için henüz bir mağaza yönlendirme
   sayfası (app-store fallback) yoktur -- bilinen bir eksiklik olarak burada
   not edilmiştir.
2. **"İlk kez geliyorum"**: mevcut, kimliksiz genel potansiyel müşteri
   (lead) formunu kullanır: `POST /public/studios/:slug/leads`
   (`PublicLeadFormSchema`, bkz. `apps/api/src/modules/leads`). Seçilen
   seans, bu şemanın desteklediği bir alan olmadığı için serbest metin
   `interest` alanına yazılır (`Lead.sourceDetail`); form onay (consent)
   kutusu ve bot yakalama (honeypot) alanı zaten bu uç noktanın parçasıdır.
   Bu uç nokta de her durumda sabit `202` döner, böylece widget de bir
   telefon numarasının kayıtlı olup olmadığını sınamak için kullanılamaz.

Widget'ın kendi okuma uç noktaları -- `/public/studios/:slug/embed/config`,
`.../branches`, `.../service-types`, `.../schedules` -- kimliksiz ve IP
başına dakikada 30 istekle sınırlıdır, ama **hiçbir yazma işlemi
içermez** ve hiçbir zaman üye, katılımcı veya rezervasyon verisi döndürmez
(bkz. `PublicApiService.listSchedules` içindeki alan listesi ve
`apps/api/test/e2e/public-api.e2e-spec.ts` "embed widget" bloğu). `/v1/public/*`'ın
API-anahtarlı üçüncü taraf entegrasyon API'sinden kasıtlı olarak ayrıdır.

Saat dilimi: `.../config` işletmenin `timezone` alanını, `.../branches` her şube için etkin `timezone` değerini (şubenin kendi dilimi, yoksa işletmeninki; asla null değildir) verir. Herkese açık rezervasyon sayfası ve widget, bir seansın tarih ve saatini ziyaretçinin değil seansın şubesinin saat diliminde biçimler (`Intl.DateTimeFormat` + `timeZone`, `apps/web/src/lib/zoned-time.ts`) ve gün grubu başına kısa dilim adını (`timeZoneName: 'short'`) gösterir; böylece yurt dışındaki bir ziyaretçi yanılmaz.

Sayfa: `apps/web/src/app/embed/[studioSlug]/page.tsx`, işletmenin
`resolveTheme()`/`themeCssVariables()` ile hesaplanan temasını (logo, ana
renk, gradyan) kullanır; başka hiçbir şey temalandırılmaz.

`/embed/*` rotaları için `Content-Security-Policy: frame-ancestors ...`
başlığı `apps/web/src/middleware.ts` tarafından, işletmenin
`embedAllowedOrigins` ayarına göre dinamik olarak ayarlanır (ayar boşsa
`frame-ancestors *`). Diğer tüm rotalar bu middleware'den etkilenmez, mevcut
başlıklarını korur. İzinli kökenler
`PUT /studios/:studioId/embed-settings` (`integrations.manage`) ile
yönetilir.

### Site sahibinin ekleyeceği kod

```html
<div data-platform-embed="stüdyonuzun-slug-değeri"></div>
<script src="https://<uygulama-alan-adı>/embed.js"></script>
```

`apps/web/public/embed.js` bağımlılıksız, derlemesiz bir script'tir: bir
iframe ekler ve host sayfaya `postMessage` ile yükseklik bilgisi göndererek
otomatik yeniden boyutlandırma yapar (yalnızca widget'ın kendi kökeninden
gelen mesajlar kabul edilir).

## 5. Test

- Birim testleri: `apps/api/src/modules/api-keys/api-key.util.spec.ts`
  (anahtar üretimi/ayrıştırma/hash), `apps/api/src/modules/webhooks/webhook-signature.spec.ts`
  (imza), `apps/api/src/modules/webhooks/ssrf-guard.spec.ts` (IPv4/IPv6 özel
  aralık tespiti), `apps/api/src/modules/webhooks/webhook-backoff.spec.ts`
  (geri çekilme takvimi), `apps/api/src/modules/webhooks/webhook-dispatcher.service.spec.ts`
  (sabitlenmiş IP adresine bağlanıldığının, hostname ne olursa olsun
  doğrulanması -- DNS rebinding koruması).
- Uçtan uca: `apps/api/test/e2e/public-api.e2e-spec.ts` -- anahtar
  oluşturma/iptal/süre dolumu, yetki alanı zorlaması, kiracı izolasyonu,
  tarih aralığı sınırı, `/v1/public/*` rezervasyon oluşturma/iptal (API
  anahtarıyla), telefon maskeleme, webhook SSRF reddi, olay teslimat satırı,
  imza doğrulama, test olayı, personel izin reddi; ayrıca embed widget'ının
  okuma uç noktalarının üye verisi döndürmediği ve kaldırılan rezervasyon
  yazma uç noktalarının artık `404` döndüğü, potansiyel müşteri formu
  üzerinden gönderimin çalıştığı.

## 6. Herkese açık site ve blog uçları (sayfa motoru, S2b)

Anahtarsız, kimliksiz okuma uçları; web uygulamasının sunucu tarafı render'ı ve besleme okuyucuları içindir. İşletme, sayfa motorunun diğer herkese açık uçlarıyla aynı kuralla çözümlenir: `slug`'ı eşleşen, aktif ve sitesi olan bir işletme; aksi her durumda `404`. Yalnızca `PUBLISHED` yazılar döner.

| Uç nokta | Açıklama |
|---|---|
| `GET /public/sites/:studioSlug/articles?locale&page&pageSize&tag` | Yayınlanmış yazılar, yeniden eskiye; `pageSize` en fazla 50 (varsayılan 12). Yanıt: `items` (başlık, özet, kapak, yazar, yayın ve güncelleme zamanı, okuma süresi, etiketler), `total`, `page`, `pageSize`, `site` (tür, ad, yayıncı, logo, diller, tema), `tag` (filtre varsa), `publishedLocales`. Bilinmeyen etiket veya sitenin etkin olmayan ve yazısı da olmayan dili `404` |
| `GET /public/sites/:studioSlug/articles/:articleSlug?locale` | Tek yazı: özet alanlarına ek olarak `body` (düz metin + işaretleme alt kümesi, `docs/SAYFA_MOTORU.md` bölüm 11), SEO alanları, `alternates` (yayınlanmış dil varyantları). Taslak, arşiv veya bilinmeyen `404` |
| `GET /public/sites/:studioSlug/article-tags?locale` | O dilde en az bir yayınlanmış yazısı olan etiketler: `slug`, `label`, `count` |
| `GET /public/sites/:studioSlug/feed/:locale` | RSS 2.0 (`application/rss+xml; charset=utf-8`), en yeni 30 yazı, sitenin varsayılan origin'iyle bağlantılar; `Cache-Control: public, max-age=300`, süreç içi 5 dakikalık önbellek, IP başına dakikada 60 istek (`429`) |
| `GET /public/sites/:studioSlug/sitemap-entries` | Mevcut yanıta geriye uyumlu `articles` alanı eklendi: `{ articleId, locale, slug, updatedAt }` listesi |

Liste, ayrıntı ve etiket uçları sayfa uçları gibi hız sınırı taşımaz (çağıran web sunucusudur ve yanıtları 300 saniye önbellekler); doğrudan dış istemcilere açık olan RSS uç noktası sınırlıdır.

## Açık sorular / kapsam dışı

- Widget'ın gerçek zamanlı yer/kaynak seçimi (W5'teki yerleşim planı) yok;
  zaten rezervasyon oluşturmadığı için bu artık uygulanamaz.
- Widget'tan "Üyeyim" bağlantısı için bir gecikmeli derin bağlantı / mağaza
  yönlendirme sayfası (`/j/<token>` davet akışındakine benzer) henüz yok;
  uygulama yüklü değilse bağlantı sessizce hiçbir şey yapmaz.
- Çoklu API anahtarı arasında paylaşılan hız sınırı sayacı yalnızca Redis
  yapılandırıldığında replikalar arasında paylaşılır; tek örnek yerel
  geliştirmede bellek içi sayaç kullanılır.
