# Hata Yakalama ve Raporlama (H1)

Platform genelindeki beklenmeyen hataları (API, web, arka plan işleri) yakalar, kişisel veriyi temizleyerek saklar, gruplar, süper adminlere e-posta ile uyarır ve işletme sahibine kendi işletmesinin hatalarını sade bir görünümle gösterir. Mobil yakalama H2'dedir.

## Mimari

```
Tarayıcı (window.onerror, unhandledrejection, error.tsx / global-error.tsx)
   |  temizle + tekilleştir + toplu gönder (1 sn)
   v
Oturumlu sayfa: /api/bff/telemetry/errors (BFF)      Herkese açık sayfa: /api/telemetry/errors (ayrı, kimliksiz route)
   |                                                    |
   +------------------------+---------------------------+
                            v
API  POST /telemetry/errors  (boyut sınırı, IP ve oturum başına hız sınırı, örnekleme, tekrar temizleme)
API  global istisna filtresi (yalnızca 5xx)  |  süreç işleyicileri  |  zamanlayıcı işi hataları
                            v
ErrorCaptureService  (senkron: temizle, parmak izi, 1 sn tekilleştirme, sınırlı kuyruk; asla hata fırlatmaz)
                            v  arka planda boşaltma
ErrorSink arayüzü  ->  StorageErrorSink (Postgres)  ->  ErrorAlertsService (e-posta)
```

- **Yakalama asla isteği bozmaz**: `capture()` yalnızca bellekte işlem yapar ve kuyruğa ekler (üst sınır 500 olay; dolarsa yeni olay düşürülür ve sayılır). Yazma `setImmediate` ile arka planda yapılır, her sink çağrısı ayrı `try/catch` içindedir.
- **Sink arayüzü** (`apps/api/src/modules/error-reporting/error-sink.ts`): H1'de tek uygulama depolamadır. Sentry gibi harici bir servis ileride yeni bir sink olarak eklenir; yakalama noktaları değişmez. Yeni bağımlılık eklenmedi.
- **API 5xx**: `ErrorCaptureFilter` (APP_FILTER) yalnızca 5xx'i kaydeder, sonra Nest'in varsayılan işleyişine bırakır; yanıt gövdesi aynı kalır (`{ statusCode: 500, message: 'Internal server error' }`), yanıta yalnızca `x-error-code` başlığı eklenir. 4xx (`HttpException`) kaydedilmez. Sağlayıcı webhook'larının (ödeme, SMS, e-posta) kendi merkezi `catch`'i yoktur; beklenmeyen hataları bu filtre ile kaydedilir, ödeme rotaları kritik akış sayılır.
- **Süreç düzeyi**: `uncaughtException` ve `unhandledRejection` kaydedilir, kayıt en fazla 2 sn beklenir, ardından Node'un varsayılan sonucu korunur (hata yazdırılır, süreç 1 koduyla çıkar; konteyner yeniden başlatır). Yalnızca `main.ts` içinde kurulur, testlerde değil.
- **Arka plan işleri**: `SchedulerProcessor` her çalıştırmaya yeni bir istek kimliği verir; hata `job` kaynağıyla kaydedilir ve BullMQ'nun yeniden deneme davranışı için tekrar fırlatılır. Süper adminin elle tetiklediği `POST /admin/scheduler/run` bir HTTP isteği olduğu için 5xx filtresinden geçer.
- **Web**: `ErrorReporter` (kök layout'ta, satır içi script yok, nonce CSP altında çalışır) dinleyicileri kurar; `error.tsx` ve `global-error.tsx` dostça bir hata ekranı ve kısa hata kodu gösterir. BFF, API'ye ulaşamazsa veya API kendi kaydetmediği bir 5xx dönerse (`x-error-code` yoksa) bunu kaydeder; API'nin zaten kaydettiği 5xx ikinci kez kaydedilmez.

## Korelasyon kimliği (x-request-id)

- Web BFF her isteğe `x-request-id` ekler (tarayıcınınki geçerliyse onu, değilse yeni bir UUID) ve yanıta yansıtır.
- API `RequestIdMiddleware` gelen kimliği katı biçimde doğrular (16-64 karakter, yalnızca harf, rakam ve tire), geçersizse yenisini üretir, yanıta yazar ve `AsyncLocalStorage` ile isteğin geri kalanına taşır.
- `RequestContextLogger` (main.ts) her log satırına `[rid:<kimlik>]` ekler; mevcut `Logger` çağrıları değişmeden kimliği taşır.
- Zamanlayıcı çalıştırmaları kendi kimliğini alır. Kaydedilen her olayda `requestId` bulunur.

## Olay sözleşmesi

Tek doğruluk kaynağı `packages/shared/src/error-reporting.ts`:

| Alan | Açıklama |
|------|----------|
| `eventId` | UUID; raporlayan üretir. Aynı kimlik ikinci kez gelirse yok sayılır (tekrar gönderim güvenli). |
| `source` | `api`, `web`, `mobile`, `job`. İstemci yalnızca `web`/`mobile` gönderebilir. |
| `severity` | `fatal`, `error`, `warning` |
| `release`, `environment` | Sürüm (commit SHA etiketi) ve ortam |
| `route` | Rota kalıbı veya ekran; kimlikler `:id` ile değiştirilir, sorgu dizesi yok |
| `requestId` | Korelasyon kimliği |
| `studioId` | Yalnızca kimliği doğrulanmış bağlamdan (JWT + aktif üyelik). Gövdedeki değer atılır. |
| `userIdHash` | `sha256(tuz + kullanıcı kimliği)`; tuz `ERROR_USER_HASH_SALT`, yoksa `JWT_SECRET`'tan türetilir. Ham kimlik asla saklanmaz. |
| `type`, `message`, `stack` | En fazla 120 / 1000 / 8000 karakter |
| `breadcrumbs` | Son 20 adım: `navigation`, `click`, `request`; mesaj 200 karakter, en fazla 8 alan |
| `timestamp` | İstemci saati; 5 dakikadan ileri veya 1 günden eski ise sunucu saati kullanılır |

Toplu gönderim: istek başına en fazla 20 olay ve 64 KB.

**Parmak izi**: kaynak + hata türü + normalize mesaj (UUID, kimlik, uzun onaltılık dizeler ve sayılar yer tutucuya çevrilir) + ilk uygulama içi yığın çerçevesi (satır/sütun, origin, sorgu ve içerik özetleri çıkarılır; `node_modules` ve Node iç çerçeveleri atlanır). Böylece aynı hata sürümler arasında aynı gruba düşer ve regresyon tespit edilebilir. Grup anahtarı parmak izinin sha256 özetidir.

**Kısa hata kodu**: olay kimliğinin ilk 8 onaltılık hanesi, büyük harf (ör. `7F3A9C21`).

## Kişisel veri (PII) kuralları

`scrubPii()` hem tarayıcıda hem sunucuda çalışır (sunucu istemciden geleni yeniden temizler):

- Telefon numaraları (`+90 532 ...`, `0532...`, `(415) 555-2671`) -> `[phone]`; ISO tarihler korunur.
- Kart benzeri 13-19 haneli, Luhn'dan geçen diziler -> `[card]`
- E-posta adresleri (URL içinde olsa bile) -> `[email]`
- JWT'ler -> `[token]`; `Bearer`/`Basic` sonrası değer -> `[redacted]`
- Parola benzeri alanların değerleri (`password=`, `"password":`, `access_token=`, `api-key:`, `secret`, `pin`, `otp`, `cookie` ...) -> `[redacted]`
- 32+ karakterlik onaltılık veya 40+ karakterlik karışık base64 sırlar -> `[secret]`

Tarayıcı tarafında tıklama adımlarına alan değerleri ve bağlantı metinleri (çoğu zaman kişi adıdır) yazılmaz; yalnızca etiket öğesi, rol, düğme metni veya `aria-label` ve bağlantının kimliksiz rotası. İstek adımlarında gövde ve sorgu dizesi yoktur.

Tarayıcı ve sunucu aynı kodu kullanır ve kod doğrusal zamanlıdır: iç içe veya bitişik sınırsız niceleyicili düzenli ifade yoktur, her tarayıcı tek geçiştir. Testte 200-400 bin karakterlik saldırgan girdiler süre sınırıyla denenir (`error-reporting.spec.ts`). Not: Nest'in kendi `ExceptionsHandler` log satırı hatayı ham haliyle yazmaya devam eder (değiştirilmedi); saklanan olaylar ve e-postalar temizlenmiş metni taşır.

## Alma ucu (POST /telemetry/errors)

- Herkese açıktır (herkese açık sayfalardaki hata ekranları da raporlar); geçerli bir erişim anahtarı varsa kullanıcı, `x-studio-id` başlığındaki işletme ise yalnızca aktif üyelik (veya süper admin) doğrulanırsa eklenir.
- Boyut: 64 KB (`configureBodyParsers` yol başına ayrıştırıcı ve denetleyicide `content-length` denetimi, fazlası 413).
- Hız sınırı: IP başına 60, oturum başına (kullanıcı veya tarayıcı sekmesinin rastgele oturum kimliği) 20 istek/dakika; Redis, yoksa bellek içi pencere (`TelemetryRateLimiter`, anahtarlar sha256). Aşımda 429.
- Örnekleme: `ERROR_CLIENT_SAMPLE_RATE` (0-1, varsayılan 1).
- Tekilleştirme: aynı kaynak ve parmak izi saniyede en fazla bir kez (tarayıcıda ve sunucuda). Tarayıcı ayrıca sayfa başına en fazla 30 olay gönderir.
- Web: oturumlu sayfalar (`PROTECTED_PATHS`) BFF üzerinden CSRF başlığıyla gönderir; herkese açık sayfalar ayrı ve yalnızca POST kabul eden `/api/telemetry/errors` route'unu kullanır (aynı köken + CSRF başlığı, kimlik bilgisi iletilmez). BFF'nin `SAFE_SEGMENT` kuralı değiştirilmedi.

## Saklama

- Olaylar 30 gün saklanır; zamanlayıcı (15 dakikalık heartbeat) daha eskileri siler. Grup başına en yeni 50 olay tutulur.
- Gruplar ve işletme sayaçları kalır (tek satırlık özet; çözüldü/yok sayıldı kararları ve regresyon takibi korunur). İşletme sahibi görünümü son 30 günü gösterir.

## Durumlar ve regresyon

- `OPEN`, `RESOLVED`, `IGNORED`. Süper admin çözer (düzeltmenin yer aldığı sürümle, boşsa API'nin güncel sürümü), yok sayar, yeniden açar ve not ekler; her işlem `audit_logs`'a yazılır (`error_group.resolve|ignore|reopen|note`).
- `RESOLVED` bir grup `resolvedInRelease`'ten farklı bir sürümde yeniden görülürse otomatik olarak `OPEN` olur (`error_group.regressed`) ve regresyon uyarısı gönderilir. Aynı sürümde görülürse çözülmüş kalır.
- `IGNORED` gruplar kaydedilmeye devam eder ama uyarı üretmez.

## Uyarılar (yalnızca e-posta)

Mesajlaşma motoru üzerinden, TRANSACTIONAL şablonlarla, e-postası olan tüm aktif süper adminlere:

| Şablon | Ne zaman |
|--------|----------|
| `ERROR_NEW_GROUP` | Yeni bir grup |
| `ERROR_REGRESSION` | Çözülmüş grubun başka sürümde yeniden görülmesi |
| `ERROR_CRITICAL` | Giriş, kimlik doğrulama, ödeme, abonelik rotalarında (`auth`, `login`, `otp`, `pin`, `payments`, `billing`, `checkout` ...) herhangi bir hata |
| `ERROR_DIGEST` | Günlük özet (son özetten en az 23 saat sonra ilk heartbeat; son 24 saatte kayıt yoksa gönderilmez) |

Öncelik: regresyon > kritik akış > yeni grup. Her grup bir bekleme penceresinde (`ERROR_ALERT_COOLDOWN_MINUTES`, varsayılan 60) en fazla bir e-posta üretir: gönderim `last_alert_at` üzerinde koşullu güncelleme ile talep edilir, eşzamanlı iki yazıcı ikisi birden gönderemez. Çözüldü olarak işaretlemek bekleme penceresini sıfırlar. Her gönderim `error_group.alert_sent` denetim kaydı bırakır. `ERROR_ALERTS_ENABLED=0` uyarıları kapatır (kayıt sürer). Şablonlar tr ve en olarak `msgTpl` ad alanındadır ve global şablon olarak seed edilir.

## Görünümler

- **Süper admin** `/admin/hatalar`: kaynak, durum, sürüm, işletme filtresi; arama kutusu hata kodu (8 karakter), olay/istek kimliği veya başlık metni kabul eder. Grup detayı (`/admin/hatalar/<id>`): yığın izi, adımlar, etkilenen işletme/kullanıcı sayıları, sürüm geçmişi, son kayıtlar, işlemler. API: `GET /admin/errors`, `GET /admin/errors/:id`, `POST /admin/errors/:id/resolve|ignore|reopen`, `PATCH /admin/errors/:id/note` (`@SuperAdminOnly`).
- **İşletme sahibi** `/ayarlar/hatalar` (Ayarlar merkezinde "Hata raporları" kartı): yalnızca kendi işletmesinin son 30 gündeki grupları; güvenli mesaj (istemci hataları için işletmenin kendi son temizlenmiş mesajı; sunucu/iş hataları için genel "Sunucu tarafında beklenmeyen bir hata"), ilk/son görülme, tekrar sayısı, hata kodu, durum. Yığın izi, parmak izi ve diğer işletmelerin verisi asla dönmez. API: `GET /studios/:studioId/errors`, `@RequirePermission('errors.view')`.
- **İzin**: `errors.view` izin kataloğuna eklendi; sahip rolü tüm izinlere sahip olduğu için yeni işletmelerde otomatik gelir, mevcut sahip rollerine migration verir. Resepsiyon ve eğitmen varsayılan olarak almaz.

## Bir hatayı koduyla bulmak

1. Kullanıcı hata ekranındaki kodu iletir (ör. `Hata kodu: 7F3A9C21`); API 5xx yanıtlarında aynı kod `x-error-code` başlığındadır.
2. Süper admin `/admin/hatalar` arama kutusuna kodu yazar ve "Filtrele"ye basar (büyük/küçük harf fark etmez).
3. Grup detayında ilgili kayıt kodla listelenir; kaydın `requestId` değeriyle API ve web loglarında (`[rid:...]`) aynı isteğin satırları bulunur.
4. Kod 32 bitlik bir özet olduğundan nadiren birden fazla grup eşleşebilir; tarih ve işletmeyle ayırt edilir.

## Sürüm ve ortam

- API: `APP_RELEASE` (Zod ile doğrulanır, varsayılan `dev`). Web: sunucu ortamında `APP_RELEASE` (kök layout çalışma anında okuyup istemci raporlayıcısına verir; derleme argümanı gerekmez).
- `deploy/docker-compose.prod.yml` her iki servise `APP_RELEASE: ${RELEASE_TAG}` verir; `deploy.sh`/`nightly-deploy.sh` `RELEASE_TAG`'i `sha-<commit>` olarak ayarlar.
- Diğer ortam değişkenleri: `ERROR_USER_HASH_SALT`, `ERROR_CLIENT_SAMPLE_RATE`, `ERROR_ALERT_COOLDOWN_MINUTES`, `ERROR_ALERTS_ENABLED`.

## Testler

- Birim: `packages/shared/src/error-reporting.spec.ts` (temizleyici ve saldırgan uzun girdi süresi, parmak izi normalizasyonu, tekilleştirme, örnekleme, regresyon, bekleme penceresi, şemalar), `apps/api/src/modules/error-reporting/error-reporting.spec.ts` (yakalama servisi, kuyruk sınırı, uyarının tek kez gönderilmesi).
- API e2e: `apps/api/test/e2e/error-reporting.e2e-spec.ts`. Yalnızca `NODE_ENV=test` iken açılan `/telemetry/test/*` rotaları 5xx üretir.
- Playwright: `apps/web/e2e/error-reporting.e2e.ts` (CI'da koşar).

## Kalan işler

- **H2**: mobil (Expo) yakalama ve aynı alma ucuna gönderim; kaynak haritaları (source map) ile yığın izlerinin çözülmesi; ani artış (spike) tespiti; kullanıcı geri bildirimi.
- **H3**: Sentry (veya benzeri) sink'i, Slack/webhook uyarıları, grup birleştirme, işletme sahibine hata bildirimi, Nest `ExceptionsHandler` log satırının da temizlenmesi.
