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
  `members.read`, `webhooks.manage`.
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
| `GET /v1/public/branches` | `schedules.read` | Aktif şubeler |
| `GET /v1/public/service-types` | `schedules.read` | Aktif hizmet türleri |
| `GET /v1/public/schedules?from&to&branchId` | `schedules.read` | Tarih aralığı en fazla 31 gün |
| `GET /v1/public/bookings?page&pageSize&branchId&scheduleId` | `bookings.read` | Sayfalı liste |
| `POST /v1/public/bookings` | `bookings.write` | `{ scheduleId, memberPhone, memberPackageId?, resourceIds? }` -- mevcut, aktif bir üye için rezervasyon oluşturur |
| `POST /v1/public/bookings/:bookingId/cancel` | `bookings.write` | `{ reason? }` |

Rezervasyon kuralları (kapasite, hak/kredi düşümü, iptal politikası) mevcut
`SchedulesService.bookSession()` / `cancelBooking()` üzerinden **aynen**
uygulanır; herkese açık API bu servisleri yeniden çağırır, kuralları tekrar
yazmaz.

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
  `member.created`, `payment.completed`, `payment.refunded`.
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

## Açık sorular / kapsam dışı

- Widget'ın gerçek zamanlı yer/kaynak seçimi (W5'teki yerleşim planı) yok;
  zaten rezervasyon oluşturmadığı için bu artık uygulanamaz.
- Widget'tan "Üyeyim" bağlantısı için bir gecikmeli derin bağlantı / mağaza
  yönlendirme sayfası (`/j/<token>` davet akışındakine benzer) henüz yok;
  uygulama yüklü değilse bağlantı sessizce hiçbir şey yapmaz.
- Çoklu API anahtarı arasında paylaşılan hız sınırı sayacı yalnızca Redis
  yapılandırıldığında replikalar arasında paylaşılır; tek örnek yerel
  geliştirmede bellek içi sayaç kullanılır.
