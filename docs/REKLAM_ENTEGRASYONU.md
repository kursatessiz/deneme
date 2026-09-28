# Reklam Entegrasyonu (G2b)

Bu belge, `docs/BUYUME_VE_GLOBAL_MIMARI.md` bölüm 3.3 (reklam platformlarına geri bildirim), 3.4 (reklam yapısı ve harcama senkronu) ve 4 (UTM ve adlandırma) maddelerinin G2b fazında nasıl uygulandığını anlatır. Bağlayıcı tasarım o belgedir; bu belge uygulamanın ayrıntısı ve sahibin kurulum rehberidir.

## 1. Özet

- Kiracılar (platform kiracısı dahil) Meta, Google Ads ve TikTok hesaplarını `AdConnection` üzerinden bağlar. Kimlik bilgileri şifreli saklanır (`CredentialCipher`), API asla geri döndürmez, yalnızca son 4 karakteri gösterilir.
- G1b'de yazılmış ama hiç tüketilmeyen `ConversionDelivery` giden kuyruğu artık gerçek bir dağıtıcı tarafından işlenir: `ConversionDeliveryDispatcherService`. Ayrı bir BullMQ kuyruğu yerine, webhook dağıtıcısıyla aynı desen kullanılır: `JobsService.runAll()`'ın 15 dakikalık kalp atışından (veya `REDIS_URL` ayarlıysa BullMQ'nun tekrarlayan işinden) çağrılan, `PENDING` ve zamanı gelmiş satırları alıp işleyen bir tarayıcı. Üretim sunucusunun 6 GB RAM / 4 vCPU sınırı ayrı bir işçi süreci için yer bırakmaz; bu zaten webhooks ve diğer arka plan işleri için kullanılan yaklaşımdır.
- Üç adaptör: Meta Conversions API, Google Ads (çevrimdışı tıklama dönüşümü veya gelişmiş dönüşüm), TikTok Events API. Hepsi aynı izin ve eşleşme kapısından geçer.
- Reklam yapısı ve günlük harcama (`AdEntity`, `AdSpendDaily`) her bağlı hesap için senkronize edilir; atıf raporu artık harcama, CPL, CAC ve ROAS gösterir.
- Atıf penceresi artık kiracı ayarıdır (`Studio.attributionWindowDays`, varsayılan 30).
- Web panelinde "Reklam bağlantıları" (`/ayarlar/reklam`, izin `ads.manage`) ve "Reklam performansı" (`/reklam-performansi`, izin `ads.view`) ekranları.

## 2. Veri modeli

| Model | Açıklama |
|---|---|
| `AdConnection` | `studioId`, platform (`META`\|`GOOGLE`\|`TIKTOK`), durum (`DISCONNECTED`\|`CONNECTED`\|`ERROR`), hesap kimliği, pixel/dataset kimliği, şifreli kimlik bilgileri, son 4 karakter, dönüşüm olayı türü başına platform dönüşüm eylemi kimliği, test modu, son senkron, son hata |
| `AdEntity` | Senkronize edilen kampanya/reklam seti/reklam: platform, seviye, harici kimlik, ad (yenilenir), durum, üst harici kimlik. Atıf her zaman harici kimlikle yapılır |
| `AdSpendDaily` | Varlık + gün başına harcama, para birimi, gösterim, tıklama |
| `Studio.attributionWindowDays` | Atıf penceresi (gün), varsayılan 30 |
| `Touchpoint.advertisingConsent` | Temas noktası kaydedilirken `consent.advertising` değeri; gönderim izninin tek kaynağı |

Migration: `20260930000000_ads_integration` (yalnızca ileri yönlü; `packages/database/prisma/migrations/`).

## 3. Bağlantı kurulumu (sahibin yapması gerekenler)

### Meta (Facebook/Instagram)

1. [Meta Business Manager](https://business.facebook.com) üzerinde bir işletme hesabı oluşturun (yoksa).
2. Events Manager'da bir Pixel oluşturun veya mevcut birini seçin; **Pixel ID**'yi not edin.
3. Aynı Pixel için Conversions API erişim anahtarı (**access token**) üretin: Events Manager -> Pixel -> Ayarlar -> Conversions API -> "Access token oluştur".
4. Domain doğrulaması yapın (Meta Business Manager -> Marka Güvenliği -> Alan Adları): olay eşleştirme kalitesini artırır.
5. Panelde `/ayarlar/reklam` -> Meta bağlantısı ekleyin: Pixel ID ve access token'ı girin. Test modunu açarsanız Events Manager'ın "Test Olayları" sekmesinde bir kod görürsünüz; bu kodu bağlantının kimlik bilgilerine `testEventCode` olarak ekleyin.
6. "Bağlantıyı test et" ile erişimi doğrulayın.
7. İlk gerçek dönüşümden sonra Events Manager'da tarayıcı (Pixel) ve sunucu (CAPI) olaylarının **aynı `event_id` ile tekilleştirildiğini** ("Event Match Quality" yüksek) doğrulayın.

### Google Ads

1. [Google Ads API geliştirici anahtarı](https://developers.google.com/google-ads/api/docs/get-started/dev-token) başvurusu yapın -- **onayı günler/haftalar sürebilir, erken başlayın**.
2. Google Cloud Console'da bir OAuth istemcisi (client ID + secret) oluşturun, Google Ads API'yi etkinleştirin.
3. OAuth Playground veya kendi betiğinizle bir **refresh token** üretin (`https://www.googleapis.com/auth/adwords` kapsamı).
4. Google Ads hesabınızda dönüşüm eylemleri oluşturun (Araçlar -> Dönüşümler): her `ConversionEventType` için bir tane (örn. `lead`, `purchase`). Eylem kimliğini not edin.
5. **Müşteri kimliği** (customer ID, tire olmadan 10 hane) ve, bir yöneticiSayfasının (MCC) altındaysanız **giriş müşteri kimliği** (login customer ID) bilgilerini toplayın.
6. Google Ads -> Araçlar -> "Google Etiketi" (veya bir dönüşüm eyleminin kurulum ayrıntıları) ekranından hesabınızın herkese açık **`AW-XXXXXXXXX`** etiket kimliğini not edin; bu bir sır değildir, sayfada zaten görünür durumda yayınlanır.
7. Panelde bağlantıyı ekleyin: client ID, client secret, refresh token, developer token, login customer ID, customer ID, `AW-XXXXXXXXX` dönüşüm kimliği.
8. Her `ConversionEventType` için dönüşüm eylemi kimliğini bağlantının "dönüşüm eylemi eşlemesi" alanına girin (API: `conversionActionIds`).
9. Google Ads -> Dönüşümler ekranında eylemlerin "Kaydediliyor" durumuna geçtiğini doğrulayın (birkaç saat sürebilir).

### TikTok

1. [TikTok Business Center](https://business.tiktok.com) üzerinde bir Pixel oluşturun, **Pixel Code**'u not edin.
2. Events API için bir erişim anahtarı (access token) üretin (Events Manager -> Pixel -> Ayarlar -> Generate Access Token).
3. Panelde bağlantıyı ekleyin: Pixel Code ve access token.
4. TikTok Events Manager -> Test Events ile gelen olayları doğrulayın.

## 4. Gönderim mantığı

### Meta Conversions API

`event_name` (`META_EVENT_NAME` eşlemesi), `event_id` = `ConversionEvent.eventId` (tarayıcı Pixel'iyle aynı, tekilleştirme için), `event_time`, `action_source: website`, `event_source_url` (atfedilen temas noktasının açılış URL'si), `user_data` (SHA-256 ile hash'lenmiş e-posta/telefon; telefon E.164 rakamlarına indirgenir, `+` yok; `external_id` kişi kimliğinin hash'i), `fbc`/`fbp` yalnızca reklam izniyle kaydedilmiş temas noktasında varsa, `custom_data.value`/`currency` tutar taşıyan olaylarda, `test_event_code` yalnızca test modunda.

### Google Ads

`gclid`/`gbraid`/`wbraid` atfedilen temas noktasında varsa **çevrimdışı tıklama dönüşümü** (`uploadClickConversions`, tıklama kimliğiyle); yoksa **gelişmiş dönüşüm** (aynı uç, hash'lenmiş e-posta/telefon `userIdentifiers` olarak). `conversion_date_time` kiracının saat diliminde `yyyy-MM-dd HH:mm:ss+HH:mm` biçiminde. `consent.ad_user_data`/`ad_personalization` her zaman `GRANTED` gönderilir çünkü gönderim zaten yalnızca reklam izni olan olaylar için yapılır (izin yoksa hiç gönderilmez, aşağıya bakın).

### TikTok Events API

`ttclid` varsa `ad.callback` alanına konur; hash'lenmiş e-posta/telefon `user` altında.

### İzin ve eşleşme

- Atfedilen temas noktası yoksa **veya** o temas noktasında `advertisingConsent` false ise: `SKIPPED_NO_CONSENT`, hiçbir şey gönderilmez, yeniden denenmez.
- İzin var ama platformun eşleşecek hiçbir kimliği yoksa (tıklama kimliği yok, e-posta/telefon yok): `SKIPPED_NO_MATCH`.
- Test trafiği (`ConversionEvent.isTest`) zaten kuyruğa hiç yazılmaz (G1b `ConversionOutboxService`); bağlantının `isTestMode` bayrağı gerçek olayları platformun kendi test moduyla işaretler (yalnızca Meta `test_event_code`).

### Yeniden deneme

`CONVERSION_RETRY_DELAYS_SECONDS` = [60, 300, 1800, 7200, 21600] saniye, aynı satır tekrar kullanılır (idempotent). Son denemeden sonra `FAILED` (ölü mektup) kalır ve panelde görünür; yeniden gönderim şu an yalnızca veri tabanından elle tetiklenir (bir sonraki fazda "yeniden gönder" düğmesi eklenebilir).

## 5. Reklam yapısı ve harcama senkronu

`AdSpendSyncService` her bağlı hesap için Meta Insights (`level=campaign|adset|ad`, `time_range`), Google Ads GAQL (`campaign`/`ad_group`/`ad_group_ad`, `metrics.cost_micros`) ve TikTok'un entegre rapor ucunu (`report/integrated/get`) çağırır, sonucu `AdEntity` (ad, durum, üst kimlik) ve `AdSpendDaily` (harcama, para birimi, gösterim, tıklama) olarak upsert eder. Günde bir kez otomatik (kalp atışı içinde kendi eşiğini uygulayan throttle), `POST /studios/:studioId/ads/spend/sync` ile elle tetiklenebilir (izin `ads.manage`, hız sınırlı).

TikTok'un temel raporu şu an üst-alt ilişkisini (`parent_external_id`) döndürmüyor; bu alan TikTok satırlarında boş kalır, harcama ve isim senkronu etkilenmez.

## 6. Atıf raporu: harcama, CPL, CAC, ROAS

`GET /crm/studios/:studioId/attribution?...&groupBy=source|campaign|adset|ad` artık her satırda `spend`, `cpl`, `cac`, `roas` alanlarını da döndürür (para birimi başına).

- Eşleştirme: `campaign`/`adset`/`ad` grupları `AdSpendDaily`'nin ilgili seviyesiyle harici kimlik üzerinden eşleşir. `source` grubu, çifte saymayı önlemek için yalnızca **kampanya seviyesi** harcamayı platforma göre toplar (bir kampanyanın harcaması zaten onun reklam setlerinin/reklamlarının toplamıdır).
- **CPL** (aday başı maliyet) = harcama / o satırın `lead` dönüşüm sayısı.
- **CAC** (müşteri edinme maliyeti) = harcama / (`purchase` + `subscription_started` + `studio_paid` dönüşüm sayısı toplamı; yenilemeler -- `subscription_renewed` -- yeni müşteri kazanımı olmadığı için hariç).
- **ROAS** = gelir / harcama, yalnızca aynı para biriminde.
- Harcama veya ilgili dönüşüm yoksa alan `null` döner (bölme hatası yerine).

## 7. UTM oluşturucu ve adlandırma denetimi

Panelde `/ayarlar/reklam` altında (kiracı) ve süper admin panelinde platform kiracısı için: pazar, dil, sektör (`BusinessTypeTemplate`'ten), amaç ve ay seçilir; `buildCampaignName()` ile kampanya adı, `AD_URL_TEMPLATES`'ten platforma göre URL parametre dizgesi ve örnek açılış URL'si üretilir, kopyala düğmeleriyle. Açılış sayfası doğrulaması: sayfa motoru (G2c) henüz platform iniş sayfalarını üretmediği için bu fazda yalnızca yol biçimi doğrulanır, varlık "bilinmiyor" olarak işaretlenir; G2c tamamlandığında gerçek varlık kontrolüne bağlanacaktır.

"Adlandırma denetimi" (`GET /studios/:studioId/ads/naming-check`), senkronize edilen kampanyalardan adı `CAMPAIGN_NAME_PATTERN`'e uymayanları listeler.

## 8. Tarayıcı pikselleri

`apps/web/src/lib/tracking/pixels.ts`: `GET /public/studios/:slug/ads/pixels` (herkese açık, sır içermez, yalnızca pixel/dataset/`AW-XXXXXXXXX` kimliği) ile hangi platformların bağlı olduğu öğrenilir; Meta Pixel, Google `gtag` ve TikTok Pixel yalnızca (a) o platform için bağlantı `CONNECTED` **ve** (b) ziyaretçi reklam izni verdiyse yüklenir. Google `gtag`, Consent Mode v2 varsayılanlarını (`ad_storage`, `ad_user_data`, `ad_personalization`, `analytics_storage`) yüklenmeden önce `granted` olarak gönderir -- çağıran zaten izin onaylanmadan bu fonksiyonu hiç çağırmaz. Panelde (kimlik doğrulamalı sayfalarda) hiçbir pixel yüklenmez -- `TrackingProvider` yalnızca herkese açık sayfa ağacında kullanılır.

CSP: `apps/web/src/middleware.ts` içindeki `publicAdsCsp()`, panel (`PROTECTED_PATHS`), `/embed` ve `/api` dışındaki tüm herkese açık sayfalarda (platform sitesi, işletme siteleri, rezervasyon sayfaları, giriş) `script-src`/`connect-src` yönergelerine Meta, Google ve TikTok pixel host'larını ekler; panel sayfalarına hiç uygulanmaz. Geliştirme modunda (`next dev`) `script-src`'ye `'unsafe-eval'` eklenir.

Sunucu tarafı ve tarayıcı olaylarının aynı `eventId` ile tekilleştirilmesi (bölüm 4), yalnızca yanıtın zaten kimlik açığa çıkardığı akışlar için mümkündür. Herkese açık aday formu (`POST /public/studios/:slug/leads`) kasıtlı olarak her zaman aynı 202 yanıtını döner (hangi telefon numaralarının bilindiğinin dışarıdan sorgulanamaması için, bkz. `docs/CRM_VE_ATIF.md`); bu nedenle `eventId` şu an o yanıta eklenmiyor ve o formdan gelen Lead olayları platformların kendi zaman penceresi eşleştirmesine güvenir. Sayfa motorunun (G2c) formları kendi yanıt sözleşmesini tanımladığında aynı `eventId` mekanizmasına bağlanacaktır.

## 9. Güvenlik

- Kimlik bilgileri `CredentialCipher` (AES-256-GCM) ile şifreli saklanır, hiçbir zaman loglanmaz, API her zaman yalnızca son 4 karakteri döner.
- Giden HTTP yalnızca sabit host listesine (`AD_PLATFORM_ALLOWED_HOSTS`): `graph.facebook.com`, `googleads.googleapis.com`, `oauth2.googleapis.com`, `business-api.tiktok.com`. Tüm çağrılar `AdsHttpClient` üzerinden geçer ve bu liste dışına asla çıkamaz.
- Manuel senkron ve bağlantı testi uçları üyelik başına dakikada 10 istekle sınırlıdır (`AdsRateLimitGuard`, Redis varsa Redis, yoksa bellek içi sayaç).
- Kiracı izolasyonu: her tablo `studioId` içerir, her sorgu ve her uç (`/studios/:studioId/ads/...`) `StudioTenantGuard` + `PermissionGuard` ile korunur.
- Webhook'suz tasarım: platformlar bize hiçbir zaman çağrı yapmaz, yalnızca biz onlara göndeririz.

## 10. Nasıl test edilir

```bash
pnpm install --frozen-lockfile
pnpm turbo run build typecheck test

export DATABASE_URL=postgresql://u:pw@localhost:5432/g2b_test
cd packages/database
pnpm exec prisma migrate deploy
pnpm exec prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
pnpm db:seed

cd ../../apps/api
JWT_SECRET=... OTP_TEST_CODE=482915 NODE_ENV=test npx jest -c test/jest-e2e.config.js

cd ../web
pnpm exec playwright test --reporter=list
```

İlgili testler:

- Birim: `apps/api/src/modules/ads/delivery/hashing.spec.ts` (Meta/Google normalleştirme, bilinen SHA-256 vektörleri), `google-conversion-datetime.spec.ts` (saat dilimi biçimlendirme), `delivery-adapters.spec.ts` (üç platformun yük oluşturucuları, izin/eşleşme atlama mantığı, test modu, değer taşıyan olaylar), `conversion-delivery-dispatcher.service.spec.ts` (gönderim, yeniden deneme zamanlaması, ölü mektup, atlama nedenleri, bağlantısız kiracı), `spend-sync/spend-adapters.spec.ts` (üç platformun harcama ayrıştırıcıları), `packages/shared/src/growth/ads.spec.ts` (kimlik bilgisi doğrulama, son 4 karakter, CPL/CAC/ROAS matematiği).
- API e2e: `apps/api/test/e2e/ads.e2e-spec.ts` -- bağlantı CRUD'ı, izinler, kiracı izolasyonu, kimlik bilgilerinin asla dönmemesi, `AdsHttpClient` adaptör sınırında sahtelenerek (HTTP katmanı gerçek bir platforma hiç çıkmaz) giden kuyruğun etkinleştirilmesi, gönderim durumları, idempotency (aynı satır tekrar kullanılır, iki kez gönderilmez), atlama nedenleri, kurgulanmış bir senaryoda harcama/CPL/CAC/ROAS sayıları.
- Web e2e (Playwright): `apps/web/e2e/ads-report.e2e.ts`, `apps/web/e2e/ads-utm-builder.e2e.ts`.

Test paketleri oluşturdukları her şeyi siler; art arda iki kez geçer.

## 11. Bilinen sınırlar ve sahibe kararlar

- **TikTok yapı senkronu** üst-alt ilişkisini henüz taşımıyor (harcama doğru, hiyerarşi eksik); ayrı bir yapı ucu eklenene kadar rapor "kaynak" ve "kampanya" seviyesinde tam, "reklam seti"/"reklam" seviyesinde TikTok için üst kırılım göstermez.
- **Herkese açık form eventId eşleştirmesi**: bölüm 8'de açıklandığı gibi, anti-numaralandırma tasarımı nedeniyle mevcut aday formu `eventId` döndürmüyor; G2c'nin form sözleşmesiyle birlikte ele alınacak.
- **LinkedIn Conversions API** adaptörü henüz yok (mimaride yer ayrılmış, `CONVERSION_DELIVERY_TARGETS` içinde `LINKEDIN_CAPI` var ama adaptör bağlanmadı); ihtiyaç olduğunda eklenir.
- **CSP** bu faza kadar hiç yoktu; eklenen `script-src`/`connect-src` yalnızca herkese açık sayfalara ve yalnızca bu iki yönergeye uygulanır. Gerçek tarayıcıda (bu ortamda çalıştırılamadı) yayın öncesi doğrulanmalı.
