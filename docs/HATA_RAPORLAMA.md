# Hata Yakalama ve Raporlama (H1, H2, H3)

Platform genelindeki beklenmeyen hataları (API, web, mobil, arka plan işleri) yakalar, kişisel veriyi temizleyerek saklar, gruplar, süper adminlere e-posta ile uyarır ve işletme sahibine kendi işletmesinin hatalarını sade bir görünümle gösterir. H2 mobil yakalamayı (çevrimdışı kuyruk), kaynak haritası (source map) yüklemeyi ve yığın izlerinin sunucuda çözülmesini ekler.

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
                                                          ->  error_alerts  ->  uyarı hedefleri (imzalı webhook, Slack), işletme sahibi
Heartbeat (15 dk)  ->  ErrorSpikeService (ani artış)  ->  error_alerts  ->  aynı dağıtım
```

- **Yakalama asla isteği bozmaz**: `capture()` yalnızca bellekte işlem yapar ve kuyruğa ekler (üst sınır 500 olay; dolarsa yeni olay düşürülür ve sayılır). Yazma `setImmediate` ile arka planda yapılır, her sink çağrısı ayrı `try/catch` içindedir.
- **Sink arayüzü** (`apps/api/src/modules/error-reporting/error-sink.ts`): tek uygulama depolamadır. Sentry gibi harici bir servis yeni bir sink olarak eklenir; yakalama noktaları değişmez. Yeni bağımlılık eklenmedi. Uyarı hedefleri ayrı bir arayüzdür (`AlertSink`, aşağıdaki H3 bölümü).
- **API 5xx**: `ErrorCaptureFilter` (APP_FILTER) yalnızca 5xx'i kaydeder, sonra Nest'in varsayılan işleyişine bırakır; yanıt gövdesi aynı kalır (`{ statusCode: 500, message: 'Internal server error' }`), yanıta yalnızca `x-error-code` başlığı eklenir. 4xx (`HttpException`) kaydedilmez. Sağlayıcı webhook'larının (ödeme, SMS, e-posta) kendi merkezi `catch`'i yoktur; beklenmeyen hataları bu filtre ile kaydedilir, ödeme rotaları kritik akış sayılır.
- **Süreç düzeyi**: `uncaughtException` ve `unhandledRejection` kaydedilir, kayıt en fazla 2 sn beklenir, ardından Node'un varsayılan sonucu korunur (hata yazdırılır, süreç 1 koduyla çıkar; konteyner yeniden başlatır). Yalnızca `main.ts` içinde kurulur, testlerde değil.
- **Arka plan işleri**: `SchedulerProcessor` her çalıştırmaya yeni bir istek kimliği verir; hata `job` kaynağıyla kaydedilir ve BullMQ'nun yeniden deneme davranışı için tekrar fırlatılır. Süper adminin elle tetiklediği `POST /admin/scheduler/run` bir HTTP isteği olduğu için 5xx filtresinden geçer.
- **Web**: `ErrorReporter` (kök layout'ta, satır içi script yok, nonce CSP altında çalışır) dinleyicileri kurar; `error.tsx` ve `global-error.tsx` dostça bir hata ekranı ve kısa hata kodu gösterir. BFF, API'ye ulaşamazsa veya API kendi kaydetmediği bir 5xx dönerse (`x-error-code` yoksa) bunu kaydeder; API'nin zaten kaydettiği 5xx ikinci kez kaydedilmez.

## Mobil yakalama (H2)

Kod `apps/mobile/src/errors/` altındadır; mantık (`reporterCore.ts`, `queue.ts`, `breadcrumbs.ts`) React Native'den bağımsızdır ve düz Node altında test edilir, `runtime.ts` gerçek bağımlılıkları bağlar.

- **Hata ekranı**: `ErrorBoundary` (kök, sağlayıcıların dışında) ve Expo Router'ın `ErrorBoundary` dışa aktarımı aynı `ErrorFallback` ekranını gösterir: `mErrors` metinleri, 8 karakterlik hata kodu (web ile aynı türetme: olay kimliğinin ilk 8 onaltılık hanesi, büyük harf), "Tekrar dene". Ekran sağlayıcılar çökmüş olsa bile çalışsın diye temayı `resolveTheme()` ile, metinleri paketli katalogdan doğrudan alır. Aynı hata nesnesi için tek olay yazılır ve aynı kod gösterilir.
- **Küresel yakalama**: `ErrorUtils.setGlobalHandler` (yakalanmamış JS hataları; ölümcül hata en fazla 500 ms diske yazılmayı bekledikten sonra platformun kendi işleyicisine devredilir) ve yakalanmamış Promise reddi (Hermes `enablePromiseRejectionTracker`; geliştirme modunda React Native'in kendi izleyicisi/LogBox kalır, JSC'de reddedilen Promise'ler yakalanmaz).
- **Adımlar (breadcrumb)**: son 20 adım. Gezinme (Expo Router `usePathname`, kimlikler `:id`), `PrimaryButton` dokunuşları (yalnızca düğme etiketi, alan değeri asla) ve `apiRequest` istekleri (yöntem, sorgusuz ve kimliksiz rota, durum kodu; gövde ve başlık asla; ağ hatasında durum `0`; telemetri ucunun kendisi yazılmaz).
- **Temizleme**: mesaj, yığın, `extra` ve adımlar paylaşılan `scrubPii`/`scrubRecord`'dan geçer (web ve sunucuyla aynı kod), sunucu yine yeniden temizler.
- **Sürüm ve ortam**: `release` = `mobileRelease(uygulama sürümü, EAS Update kimliği)`: `1.4.0` veya bir güncellemeden gelen paketlerde `1.4.0-<update-id>` (`Constants.manifest2.id`). `environment` = EAS profilinin `APP_VARIANT` değeri (`preprod`, `production`; `app.config.ts` `extra.appVariant` olarak verir), yoksa geliştirmede `development`, aksi halde `production`.
- **Çevrimdışı kuyruk**: her olay önce `AsyncStorage`'a yazılır (`platform.errors.queue`), sonra gönderilir. Sınır **50 olay** (aşılırsa en eski silinir); tekrar gönderime karşı olay kimliği tekildir. Gönderim en eskiden başlayarak **20 olay ve 64 KB** sınırlarına uyan gruplarla `POST /telemetry/errors`'a yapılır (`apiRequest`; oturum açıksa kimlikli ve `x-studio-id` ile, değilse kimliksiz). Yalnızca API'nin kabul ettiği olaylar kuyruktan silinir: ağ yok, 429 veya 5xx ise grup kalır ve gönderim durur; 400/413/422 ise grup geçersiz sayılıp silinir (sonsuz döngü olmasın).
- **Ne zaman boşaltılır**: uygulama açılışında, uygulama öne geldiğinde (`AppState` `active`), bir hatadan 1 sn sonra ve kuyruk doluyken 30 sn'den başlayıp 5 dakikaya kadar katlanan aralıkla yeniden deneme. Bağlantının dönüşü için yeni bir bağımlılık (NetInfo) eklenmedi; yeniden deneme sayacı bu işi görür.
- **Sınırlar ve örnekleme**: oturum (uygulama süreci) başına en fazla 30 olay, saniyede bir tekilleştirme, oturum kimliği (`sessionId`) hız sınırı içindir. API halka açık bir örnekleme yapılandırması sunmadığından istemci örnekleme oranı 1'dir; oran sunucuda `ERROR_CLIENT_SAMPLE_RATE` ile uygulanır.

## Kaynak haritaları ve yığın izi çözümleme (H2)

Küçültülmüş (minified) yığın izleri okunamaz; API, ilgili sürümün yüklenmiş kaynak haritalarıyla `web` ve `mobile` olaylarının yığınını çözer. **Ham yığın `error_events.stack`'te, çözülmüş yığın `error_events.symbolicated_stack`'te saklanır**; `/admin/hatalar/[id]` çözülmüş olanı gösterir, ham olan "Ham yığın izi" altında durur.

**Yükleme ucu** `POST /admin/errors/sourcemaps` (gövde: `{ release, platform: 'web'|'mobile', path, map }`):
- Kullanıcı oturumu değil, `SOURCEMAP_UPLOAD_TOKEN` gerekir (`x-sourcemap-token` veya `Authorization: Bearer`): CI'nin süper admin girişi yoktur ve belirteç platform sahibinin sırrıdır. Belirteç tanımlı değilse uç kapalıdır (403). Belirteç, büyük gövde okunmadan önce `configureBodyParsers` içinde denetlenir; süper admin JWT'si tek başına yetmez.
- Sınırlar: tek harita 10 MB, istek 24 MB (413), sürüm ve platform başına en fazla 2000 harita (409), gövde `version: 3` bir harita olmalı ve `sections` (indeksli harita) içermemeli, `path` normalize edilir (`..`, ters eğik çizgi, denetim karakteri reddedilir), sürüm `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`.
- Depolama: `SOURCEMAP_DIR/<platform>/<sürüm>/<sha256(path)>.map` (ilk satır bundle yolu, gerisi harita). Üretimde `sourcemaps_data` adlı Docker volume'u (`/var/lib/app/sourcemaps`, `node` kullanıcısına ait); ayarlanmazsa API çalışma dizini altında `.sourcemaps` (paylaşılan geçici dizin kullanılmaz). Aynı yola yeniden yükleme haritayı değiştirir.
- **Saklama 30 gün**: 15 dakikalık heartbeat (`ErrorReportingJobsService`) dosya yaşına göre eskileri ve boşalan sürüm klasörlerini siler (`sourcemapsPurged`, `POST /admin/scheduler/run` yanıtında `errorReporting` altında).

**Çözümleme** (`symbolication.service.ts`, `sourcemap-decoder.ts`): workspace'te `source-map` bağımlılığı olmadığından küçük bir okuyucu yazıldı (yeni bağımlılık yok): base64 VLQ çözücü, v3 `mappings` taraması (bir arama dizeyi tek geçişte tarar, dizin kurmaz; bellek yükü yok) ve V8, Hermes (`at fn (address at index.android.bundle:1:2345)`) ve Firefox/Safari (`fn@url:1:2`) çerçeve biçimlerinin yeniden yazılması. Kaynak yolları `webpack://ad/./src/x.tsx` -> `src/x.tsx` olarak sadeleşir; haritada ad varsa işlev adı da orijinal olur.
- Çerçevenin URL'si (kaynak, sorgu ve parça çıkarılır, yüzde kodlaması çözülür: `%28dashboard%29` -> `(dashboard)`) en uzundan en kısaya yol sonekleriyle aranır (`_next/static/chunks/a.js`, `static/chunks/a.js`, ..., `a.js`; en fazla 8). Böylece web'de tam yol, cihazda yalnızca dosya adı yeterlidir.
- Olay yazılırken çalışır (`StorageErrorSink`): bilinmeyen sürüm, haritasız çerçeve, bozuk harita veya diğer her hata çözümlemeyi sessizce atlar, olay ham yığınla kaydedilir. Çözülmüş yığın varsa **parmak izi ve `topFrame` çözülmüş yığından** türetilir; bu sayede derleme başına değişen bundle adları ayrı gruplara yol açmaz. Çözümleme yalnızca haritalar olaydan önce yüklenmişse çalışır (bu yüzden CI haritaları dağıtımdan önce yükler); sonradan yüklenen harita eski olayları çözmez.
- Yük sınırı: bir yığında en fazla 100 çerçeve ve 6 farklı dosya çözülür.

**Web hattı**
1. `next.config.ts` `productionBrowserSourceMaps: true`.
2. `deploy/docker/web.Dockerfile`: build sonrası `.next/static/**/*.map` `/sourcemaps` klasörüne **taşınır** (sunulan imajda harita yoktur); `web-sourcemaps` adlı `FROM scratch` aşaması yalnızca bu haritaları içerir.
3. `release.yml` `publish` (yalnızca `web`): aşama `ghcr.io/<repo>/web-sourcemaps:sha-<commit>` imajı olarak push edilir (terfi ve yeniden dağıtımlar da haritaya ulaşsın diye) ve `web-sourcemaps-sha-<commit>` adlı Actions artifact'ı olarak 30 gün saklanır.
4. `release.yml` `deploy`: hedef ortamın `SOURCEMAP_UPLOAD_TOKEN` secret'ı ve `PUBLIC_API_URL` değişkeni varsa imaj çekilir, haritalar `deploy/scripts/upload-sourcemaps.mjs` ile `_next/static/` önekiyle API'ye yüklenir, ardından dağıtım yapılır. Adım `continue-on-error`'dır: eksik harita yalnızca yığın izini bozar, dağıtımı durdurmaz. Secret veya değişken yoksa bildirimle atlanır.
5. Tarayıcı raporlayıcı yığını olduğu gibi gönderir (URL, satır, sütun içerir; temizleyici bunları bozmaz, testle sabitlendi). `error` olayında `Error` nesnesi yoksa (çapraz köken, metin fırlatma) `filename:lineno:colno` bir çerçeve olarak yığına eklenir. `release` `APP_RELEASE`'dir (`sha-<commit>`), yükleme anahtarıyla aynıdır. CSP değişmedi.

**Mobil hat** (ayrıntı ve sahibin yapacakları `docs/MOBILE_APP.md` "Hata raporlama ve kaynak haritaları")
- `apps/mobile/scripts/upload-sourcemaps.mjs`: `expo export --source-maps` çıktısındaki `.map` dosyalarını `release = <sürüm>[-<update id>]`, `platform = mobile`, yol = dosya adı olarak yükler. Düz Node (`.mjs`): depoda `ts-node`/`tsx` yok, Node 22 doğrudan çalıştırır. Genel yükleyici `deploy/scripts/upload-sourcemaps.mjs`'dir (4 paralel istek, geçici hatada 3 deneme, 4xx'te yeniden deneme yok, 10 MB üstü haritaları atlar).

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

Tarayıcı ve sunucu aynı kodu kullanır ve kod doğrusal zamanlıdır: iç içe veya bitişik sınırsız niceleyicili düzenli ifade yoktur, her tarayıcı tek geçiştir. Testte 200-400 bin karakterlik saldırgan girdiler süre sınırıyla denenir (`error-reporting.spec.ts`). Nest'in kendi `ExceptionsHandler` log satırı da (H3) aynı temizleyiciden geçer; ayrıntı aşağıda.

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
- Diğer ortam değişkenleri: `ERROR_USER_HASH_SALT`, `ERROR_CLIENT_SAMPLE_RATE`, `ERROR_ALERT_COOLDOWN_MINUTES`, `ERROR_ALERTS_ENABLED`; H2: `SOURCEMAP_UPLOAD_TOKEN` (en az 32 karakter; boşsa yükleme kapalı), `SOURCEMAP_DIR` (compose `/var/lib/app/sourcemaps` verir).

## Testler

- Birim: `packages/shared/src/error-reporting.spec.ts` (temizleyici ve saldırgan uzun girdi süresi, parmak izi normalizasyonu, tekilleştirme, örnekleme, regresyon, bekleme penceresi, şemalar), `apps/api/src/modules/error-reporting/error-reporting.spec.ts` (yakalama servisi, kuyruk sınırı, uyarının tek kez gönderilmesi).
- API e2e: `apps/api/test/e2e/error-reporting.e2e-spec.ts`. Yalnızca `NODE_ENV=test` iken açılan `/telemetry/test/*` rotaları 5xx üretir.
- Playwright: `apps/web/e2e/error-reporting.e2e.ts` (CI'da koşar).
- H2 birim: `apps/api/src/modules/error-reporting/sourcemap-decoder.spec.ts` (VLQ bilinen değerler ve gidiş-dönüş, elle yapılmış haritada bilinen eşleme, V8/Hermes/Firefox çerçeveleri, depo, saklama temizliği), `sourcemap-token.spec.ts`, `packages/shared/src/sourcemaps.spec.ts`; mobil `apps/mobile/src/errors/*.spec.ts` (kuyruk sınırı ve sıralı boşaltma sahte depolamayla, yeniden deneme ve tek zamanlayıcı, PII temizleme, `ErrorBoundary`).
- H2 API e2e: `apps/api/test/e2e/error-sourcemaps.e2e-spec.ts` (belirteçli/belirteçsiz yükleme, boyut sınırları, doğrulama, bilinen ve bilinmeyen sürümde çözümleme, platform ayrımı, saklama temizliği).

## H3: ani artış, uyarı hedefleri, birleştirme, geri bildirim

Migration `20261029000000_error_alerts` (yalnızca genişletme: yeni tablolar ve boş bırakılabilir sütunlar). Paylaşılan sözleşme `packages/shared/src/error-alerts.ts`; her kural orada saf fonksiyondur ve `error-alerts.spec.ts` ile sınanır.

### Ani artış (spike) tespiti

- **Sayaç**: her olay, grubunun UTC'ye hizalı 15 dakikalık kovasına yazılır (`error_group_buckets`). Grup başına en son 50 olay saklandığı için (olay tablosu doğru bir taban vermez) ayrı bir sayaç tablosu kullanılır; heartbeat 48 saatten eski kovaları siler.
- **Karşılaştırma** (`ErrorSpikeService`, 15 dakikalık heartbeat adımı): son tamamlanan kova ve içinde bulunulan kova, grubun kendi önceki 24 saatlik (96 kova) tabanıyla `detectSpike()` ile karşılaştırılır. Taban ortalaması, grubun var olduğu kova sayısına bölünür (genç bir grup 96'ya seyreltilmez).
  - Pencerede `minWindowCount`'tan az kayıt varsa hiçbir zaman ani artış değildir.
  - **Yeni grup** (pencerede ilk görüldü) ve **ince taban** (24 saatte `minBaselineEvents`'ten az kayıt) yalnızca `absoluteFloor` üstünde ani artış sayılır.
  - Aksi halde eşik `max(minWindowCount, ceil(taban ortalaması x ratio))`.
- **Bekleme (cooldown)**: bir grup, son ani artış uyarısının pencere başlangıcından en az `cooldownMinutes` sonraki bir pencerede yeniden uyarılır (olay zamanı ekseninde; uzun bir olay her 15 dakikada bildirim üretmez). Aynı grup, tür ve pencere için tek satır (benzersiz anahtar). `IGNORED` ve birleştirilmiş gruplar uyarmaz. `ERROR_ALERTS_ENABLED=0` hepsini kapatır.
- **`error_alerts` satırı**: grup, tür (`SPIKE`, `NEW_GROUP`, `REGRESSION`), pencere, sayılar (pencere, taban toplamı ve ortalaması, eşik), `notifiedAt`, `acknowledgedAt`, `acknowledgedByUserId`. `NEW_GROUP` ve `REGRESSION` satırları mevcut e-posta yolundan (bekleme penceresini talep eden) geçince yazılır; regresyon tanımı H1'deki gibidir (çözülmüş grubun, çözüldüğü sürümden farklı bir sürümde yeni olay alması). `CRITICAL` yalnızca e-postadır.
- **Bildirim** (`ErrorAlertNotifier`): `ERROR_SPIKE` e-postası süper adminlere (mevcut uyarı yolu), yapılandırılmış uyarı hedefleri, kiracı sahibi bildirimi. Adımlar birbirinden yalıtılmıştır.
- **API** (`@SuperAdminOnly`): `GET /admin/errors/alerts` (tür, onay durumu, grup filtresi), `POST /admin/errors/alerts/:id/acknowledge` (ilk onay korunur, `error_alert.acknowledge` denetim kaydı). Web: `/admin/hatalar/uyarilar`.

### Ayarlar (süper admin)

`error_settings` tekil satırı (`id = platform`), `GET/PATCH /admin/errors/settings`, web `/admin/hatalar/ayarlar`. Eşikler veridir, kodda sabit değildir.

| Ayar | Varsayılan | Sınır |
|------|-----------|-------|
| `spike.enabled` | açık | |
| `spike.ratio` (taban ortalamasının katı) | 5 | 1,5 - 100 |
| `spike.minWindowCount` | 10 | 1 - 100000 |
| `spike.minBaselineEvents` (24 saat) | 20 | 0 - 1000000 |
| `spike.absoluteFloor` | 50 | 1 - 1000000 |
| `cooldownMinutes` | 60 (satır yokken `ERROR_ALERT_COOLDOWN_MINUTES`) | 5 - 1440 |
| `webhook.url`, `webhook.secret`, `webhook.enabled` | yok | url https, secret en az 16 karakter |
| `slack.url`, `slack.enabled` | yok | `https://hooks.slack.com/services/...` |

Webhook adresi, imza anahtarı ve Slack adresi `CredentialCipher` ile şifrelenir (`INTEGRATION_ENCRYPTION_KEY`; üretimde yoksa kaydedilemez); yanıtta yalnızca webhook host'u ve anahtarın son 4 hanesi döner. Denetim kaydı hangi bölümün değiştiğini yazar, değerleri asla.

### Uyarı hedefleri

`AlertSink` arayüzü (`alert-sinks/alert-sink.ts`): `kind`, `isActive()`, `deliver(notification)`. Bir alert satırı etkin her hedefe `error_alert_deliveries` satırıyla dağıtılır; hedefe giden özet (`ErrorAlertNotification`) temizlenmiş grup başlığı, kaynak, sürüm, hata kodu, sayılar ve panel bağlantısıdır: yığın, mesaj, kullanıcı verisi yoktur.

- **İmzalı webhook** (`WebhookAlertSink`): gövde `{ "event": "error.alert", "version": 1, "alert": { id, kind, groupId, title, source, release, code, windowCount, baselineMean, threshold, affectedStudioCount, occurredAt, link } }`, üst bilgi `X-Signature: t=<unix>,v1=<hmac-sha256("t.gövde")>` (genel webhook'larla aynı imza, doğrulama örneği `docs/PUBLIC_API.md`) ve `X-Platform-Event: error.alert`.
- **Slack** (`SlackAlertSink`): gelen webhook; başlık, özet, dört bilgi alanı ve panele düğme. Metinler `adminErrors.alert.*` anahtarlarındandır, başlık `&`, `<`, `>` kaçırılarak yazılır (`buildSlackAlertPayload`).
- **Dış erişim** (`AlertHttpClient`, e2e'de değiştirilen tek nokta): yalnızca https, 5 sn zaman aşımı, yönlendirme izlenmez. Slack için host izin listesi `ERROR_ALERT_SINK_ALLOWED_HOSTS` (`hooks.slack.com`, `packages/shared`) kayıtta ve her gönderimde denetlenir. Genel webhook'un sabit host'u yoktur; webhooks modülünün SSRF koruması (`resolvePublicHttpsAddresses`) kayıtta ve teslimatta çalışır, bağlantı doğrulanan adrese sabitlenir (DNS rebinding).
- **Yeniden deneme**: ilk deneme hemen; başarısızlıkta webhook geri çekilme çizelgesiyle (30 sn, 2 dk, 10 dk, 30 dk, 1 sa; toplam 6 deneme) heartbeat'te tekrarlanır, sonra `ABANDONED`. 5xx, 429, 408 ve ağ hataları tekrar denenir; diğer 4xx kesindir. Teslimat, denemeden önce koşullu güncellemeyle talep edilir (iki heartbeat aynısını göndermez). Hatalar yalnızca hedef adı ve durum kodu/hata sınıfıyla loglanır; gövde, adres, yanıt gövdesi asla yazılmaz.
- **Sentry benzeri hedef yapılmadı** (yeni bağımlılık yok). Eklemek için: (1) `ERROR_ALERT_SINKS`'e tür ekleyin, (2) `AlertSink`'i uygulayın (`isActive` kendi şifreli ayarını okur, `deliver` özeti servisin olay API'sine `AlertHttpClient` ile gönderir; sabit host'u `ERROR_ALERT_SINK_ALLOWED_HOSTS`'a yazın), (3) `ErrorReportingModule`'deki `ALERT_SINKS` fabrikasına ekleyin. Yakalama ve uyarı üretimi değişmez. Ham olay göndermek isteyen bir Sentry hedefi ayrıca `ErrorSink` (`error-sink.ts`) olarak yazılır ve `ERROR_SINKS` listesine girer.

### Grup birleştirme

`POST /admin/errors/groups/:id/merge` gövde `{ "targetId": "<uuid>" }` (`@SuperAdminOnly`). Tek işlemde: olaylar, uyarılar, ani artış kovaları (toplanır) ve işletme sayaçları hedefe taşınır; hedefin sayaçları (toplam, ilk/son görülme, son sürüm, kritik, yaklaşık kullanıcı) güncellenir; açık bir grup çözülmüş bir hedefe katılırsa hedef yeniden açılır; kaynak `merged_into_id` ile işaretlenir ve listeden düşer; kaynağın parmak izi `error_group_aliases`'a hedefin takma adı olarak yazılır. Yeni olaylarda önce takma ad, sonra grup parmak izi aranır ve birleştirme zinciri canlı gruba kadar izlenir (`resolveGroup`, `followMergeChain`); hedef sonradan birleştirilirse takma adlar da taşınır, böylece hep canlı gruba işaret eder. Kendine, zaten birleştirilmiş gruba veya birleştirilmiş hedefe birleştirme 409, bilinmeyen grup 404. Denetim: `error_group.merge`. Birleştirme geri alınamaz. Bilinen sınır: birleştirme anında yazılmakta olan bir olay kaynak grupta kalabilir (kaynak detay sayfası hâlâ açılır).

### İşletme sahibine bildirim

`error_studio_settings.owner_notify` (varsayılan kapalı; satır yok = kapalı). `GET /studios/:studioId/errors/settings` (`errors.view`), `PATCH` (`studio.settings.manage`, denetim `error_studio_settings.update`); web `/ayarlar/hatalar` üstünde bir onay kutusu. Açıksa `NEW_GROUP` ve `SPIKE` uyarısında etkilenen işletmenin sahibine (ilk aktif sahip üyeliği) yalnızca e-posta ile `ERROR_OWNER_NOTICE` gider: mesaj, yığın veya iç ayrıntı yok, yalnızca işletme adı, hata kodu ve `/ayarlar/hatalar` bağlantısı; tr ve en şablon. Grup ve işletme başına 24 saatte en fazla bir e-posta: gönderim `error_group_studios.owner_notified_at` üzerinde koşullu güncellemeyle talep edilir. `NEW_GROUP` için işletme, olayın kimlik doğrulanmış bağlamındaki işletmedir (kimliksiz olay işletme sahibine bildirim üretmez); `SPIKE` için pencere başından beri o grubu gören işletmeler.

### Kullanıcı geri bildirimi

`POST /telemetry/errors/:eventId/feedback`, gövde `{ "feedback": "...", "sessionId"?: "..." }` (en fazla 1000 karakter gelir, temizlendikten sonra en fazla 500 karakter saklanır). Kimliksiz/kimlikli kuralları, 64 KB sınırı ve IP (60) / oturum (20) hız sınırları hata toplu gönderimiyle aynıdır. Metin `scrubFeedback` ile (kontrol karakterleri, `scrubPii`) temizlenir; e-posta veya iletişim alanı yoktur. Olay bir kullanıcıya aitse (`user_id_hash`) yalnızca o kullanıcı not ekleyebilir, aksi halde ve bilinmeyen olayda aynı 404 döner (kimlikler yoklanamaz); not bir kez yazılır (ikincisi 409). `error_events.feedback` sütununda durur, süper admin olay sayfasında görünür. Web `ErrorScreen` ve mobil `ErrorFallback` isteğe bağlı "Ne yapıyordunuz?" kutusunu gösterir (500 karakter sayacı, `errors.feedback.*`, `mErrors.feedback.*`); herkese açık sayfalar `/api/telemetry/errors/[eventId]/feedback` route'unu, oturumlu sayfalar BFF'yi kullanır. Mobilde olay henüz sunucuya ulaşmadıysa (çevrimdışı kuyruk) not 404 alır ve "iletilemedi" görünür; not isteğe bağlı olduğundan kuyruğa alınmaz.

### Yığın bağlamı (`sourcesContent`)

Kayıtlı harita `sourcesContent` taşıyorsa, çözülen ilk 3 uygulama çerçevesi (node_modules dışı) için özgün satırın bir üstü, kendisi ve bir altı `error_events.symbolicated_context` (JSON) sütununa yazılır: `{ location, startLine, lines, focus }`. Satırlar 200 karaktere kesilir ve `scrubPii`'den geçer. Ham yığın (`stack`) ve çözülmüş yığın metni değişmez. Süper admin olay sayfası bağlamı tek aralıklı (monospace) blokta, hedef satır `>` ile işaretli gösterir. Harita önbelleği (6 harita) artık `sourcesContent`'i de bellekte tutar; 10 MB harita sınırıyla en kötü durum yaklaşık 60 MB'tır.

### Nest `ExceptionsHandler` log satırı

Nest'in varsayılan filtresi yakalanmamış istisnayı `ExceptionsHandler` bağlamında ham mesaj ve yığınla loglar. `RequestContextLogger.error` bu bağlamdaki satırları `scrubPii`'den geçirir (mesaj 1000, yığın 8000 karaktere kesilir; ayrıştırıcı hataları gövde parçası alıntılayabildiği için) ve yalnızca bu bağlam etkilenir. Saklanan olaylar ve e-postalar zaten temizlenmiş metni taşır.

### JSC ve yakalanmayan Promise reddi

Expo varsayılan olarak Hermes kullanır; Hermes'te `enablePromiseRejectionTracker` ile yakalanır. JSC'de bu izleyici yoktur ve yeni bağımlılık eklenmediği için yakalanmayan Promise reddi bilinçli bir sınır olarak bırakıldı; JSC'ye geçilirse önce bu sınır yeniden değerlendirilmelidir. Geliştirme modunda React Native'in kendi izleyicisi (LogBox) kalır.

### Testler

- Birim: `packages/shared/src/error-alerts.spec.ts` (ani artış matematiği ve kenar durumları, birleştirme zinciri, Slack ve webhook gövdesi, izin listesi, geri bildirim temizleme, bağlam çıkarma), `apps/api/src/modules/error-reporting/error-alerts.spec.ts` (ExceptionsHandler log temizleme, takma ad çözümleme, sink imzası ve host denetimi), `sourcemap-decoder.spec.ts` (bağlam), mobil `feedback.spec.ts`.
- API e2e: `apps/api/test/e2e/error-alerts.e2e-spec.ts` (bekleme içinde tek, sonra yine ani artış uyarısı; regresyon; birleştirme ve takma ad; imzalı webhook ve 5xx'te yeniden deneme ve vazgeçme; sahibe günde bir e-posta ve yalnızca onaylıysa; geri bildirim, hız sınırı ve temizleme; bağlam satırları). Playwright: `apps/web/e2e/error-alerts.e2e.ts` (yalnızca tip denetimi).

## Kalan işler

- **H1, H2, H3 yapıldı.** H3: ani artış tespiti, imzalı webhook ve Slack uyarı hedefleri (`AlertSink` arayüzü), grup birleştirme, işletme sahibine isteğe bağlı bildirim, kullanıcı geri bildirimi, yığında `sourcesContent` bağlamı, `ExceptionsHandler` log temizleme.
- **Bilinçli olarak yapılmayanlar**: Sentry benzeri hedef (bağımlılık; `AlertSink` ile eklenir, bkz. yukarı), JSC'de yakalanmayan Promise reddi (yukarıdaki not), mobil Hermes haritasının EAS Build çıktısından otomatik yüklenmesi (şimdilik `--dist` ile elle) ve mobil için CI'da otomatik yükleme (EAS sırrı gerektirir, sahip kararı).
- **Sahip kararı bekleyenler**: uyarı hedeflerinin gerçek Slack/webhook adreslerinin girilmesi (`/admin/hatalar/ayarlar`); ani artış eşiklerinin gerçek trafikle gözden geçirilmesi (varsayılanlar: 5 kat, en az 10 kayıt, yeni grup için 50).
