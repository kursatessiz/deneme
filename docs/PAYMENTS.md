# Ödemeler (W6)

Bu doküman, ödeme sağlayıcı soyutlamasını, hangi ortam değişkenlerinin gerektiğini ve işletme sahibinin sağlaması gereken bilgileri özetler.

## Sağlayıcı soyutlaması

Tüm ödeme akışları tek bir arayüz üzerinden çalışır (`apps/api/src/modules/payments/providers/payment-provider.interface.ts`):

- `createCheckout` — barındırılan/online ödeme başlatır (üye kendi kendine satın alma, veya personelin online satışı).
- `chargeStoredCard` — saklı bir kart token'ını tahsil eder (kart okutmalı satış, abonelik yenilemesi).
- `refund` — önceki bir tahsilatı kısmen veya tamamen iade eder.
- `verifyWebhook` — gelen webhook imzasını doğrular ve olayı ayrıştırır.

Üç adaptör vardır, `PAYMENT_PROVIDER` ortam değişkeniyle seçilir:

| Değer | Adaptör | Durum |
|-------|---------|-------|
| `MOCK` (varsayılan) | `MockPaymentProvider` | Tam işlevsel, deterministik, ağ çağrısı yok. Test ve geliştirme için varsayılan. |
| `IYZICO` | `IyzicoPaymentProvider` | İskelet: gerçek HTTP çağrıları henüz uygulanmadı, çağrıldığında açık bir "yapılandırılmamış" veya "henüz uygulanmadı" hatası fırlatır. İstek şekilleri kod içinde TODO yorumlarıyla belgelenmiştir. |
| `PAYTR` | `PaytrPaymentProvider` | Aynı şekilde iskelet. |

`PaymentProviderRegistry`, aktif sağlayıcıyı ve isme göre (webhook URL'sindeki `:provider` segmenti) herhangi bir sağlayıcıyı çözer, böylece stüdyonun varsayılan sağlayıcısı ne olursa olsun her yapılandırılmış sağlayıcıdan gelen bir webhook doğru adaptörle doğrulanır.

### MOCK sağlayıcı ile test

- `createCheckout` her zaman senkron olarak `COMPLETED` döner.
- `chargeStoredCard`, kart token'ı `0002` ile bitiyorsa (`MOCK_DECLINE_CARD_SUFFIX`) reddedilir; aksi halde başarılı olur. Gerçek bir PAN asla gönderilmez veya saklanmaz, yalnızca istemci tarafından üretilmiş bir token.
- `verifyWebhook`, isteğin gövdesini `x-mock-signature` başlığındaki HMAC-SHA256 imzasıyla doğrular (`MockPaymentProvider.sign(rawBody)`).

## Ortam değişkenleri (`apps/api/src/config/env.ts`)

```
PAYMENT_PROVIDER=MOCK            # MOCK | IYZICO | PAYTR
IYZICO_API_KEY=...               # PAYMENT_PROVIDER=IYZICO ise zorunlu
IYZICO_SECRET_KEY=...
IYZICO_BASE_URL=...              # opsiyonel, varsayılan iyzico canlı/test URL'si kod tarafında belirlenir
PAYTR_MERCHANT_ID=...            # PAYMENT_PROVIDER=PAYTR ise zorunlu
PAYTR_MERCHANT_KEY=...
PAYTR_MERCHANT_SALT=...
```

Zod, `PAYMENT_PROVIDER` seçilen sağlayıcının kimlik bilgileri eksikse süreci başlatmayı reddeder. Kodda hiçbir gizli bilgi (secret) yoktur.

## İşletme sahibinin sağlaması gerekenler

- **iyzico**: API Key, Secret Key, hangi ortamın kullanılacağı (test/canlı), webhook (callback) URL'sinin iyzico panelinde tanımlanması: `https://<api-domain>/payments/webhook/iyzico`.
- **PayTR**: Mağaza (merchant) ID, Merchant Key, Merchant Salt, webhook URL'sinin PayTR panelinde tanımlanması: `https://<api-domain>/payments/webhook/paytr`.
- Her iki sağlayıcı için de gerçek HTTP entegrasyonu bu sürümde uygulanmamıştır (bkz. kod içi TODO'lar); canlıya alınmadan önce bir takip PR'ında tamamlanmalıdır.

## Üye faturalandırma modeli

- `Payment` — tek seferlik bir tahsilat (nakit, kart, havale/EFT, online). `PENDING` durumu yalnızca havale/EFT ve tamamlanmamış online checkout içindir.
- `StoredCard` — üye başına saklanan kart: yalnızca sağlayıcı kart token'ı, son 4 hane, marka, son kullanma ayı/yılı. PAN veya CVV hiçbir zaman veritabanına yazılmaz.
- `MemberSubscription` — bir `PackageDefinition`'a bağlı otomatik yenilenen üyelik. `nextChargeAt` alanı hangi aboneliklerin tahsilat için hazır olduğunu belirler.
- `PaymentAttempt` — her tahsilat denemesinin kaydı (dunning günlüğü).

### Havale/EFT akışı

1. Personel `POST /payments/sell` ile `paymentMethod: BANK_TRANSFER` ve bir `bankReference` (dekont no) gönderir. `PENDING` bir `Payment` oluşur; paket henüz aktive edilmez.
2. Para hesaba geçtiğinde, `finance.manage` iznine sahip personel `POST /payments/bank-transfer/confirm` çağırır. Bu, ödemeyi `COMPLETED` yapar ve `MemberPackage`'ı aktive eder (veya mevcut paketi uzatır). Koşullu güncelleme (`updateMany` + `PENDING` şartı) aynı ödemenin iki kez onaylanmasını engeller.

### Abonelik ve taksit

- `POST /payments/subscriptions`, bir üyenin saklı kartına bağlı bir abonelik oluşturur; `installmentCount` (1-12) her yenileme tahsilatına uygulanır.
- Üye kendi aboneliğini `POST /payments/subscriptions/:id/cancel/self` ile dönem sonunda iptale ayarlayabilir (`atPeriodEnd: true`); personel `packages.sell` izniyle iptal/duraklat/devam ettir uç noktalarını kullanır.

## Dunning (gecikmiş tahsilat) tasarımı

`DunningService.runDueRenewals(now)`, `nextChargeAt <= now` olan her `ACTIVE`/`PAST_DUE` aboneliği dener:

1. Saklı kart yoksa abonelik `PAST_DUE` işaretlenir, tahsilat denenmez.
2. Tahsilat başarılıysa: dönem ileri alınır, yeni bir `MemberPackage` oluşturulur, `Payment` (`COMPLETED`) ve `PaymentAttempt` (`SUCCEEDED`) kaydedilir.
3. Tahsilat başarısızsa: bir `PaymentAttempt` (`FAILED`) kaydedilir ve ilk başarısızlıktan itibaren **1., 3. ve 7. günlerde** tekrar denenir (`DUNNING_RETRY_OFFSETS_DAYS`). 7. gündeki deneme de başarısız olursa abonelik `CANCELLED` olur ve üyeye `PACKAGE` kategorisinde bildirim gönderilir (`NotificationsService.notifyUser`, en iyi çaba/best-effort).
4. `cancelAtPeriodEnd = true` olan bir abonelik, dönemi bittiğinde tahsilat denemeden `CANCELLED` olur.

### Zamanlama notu

Bu API'de BullMQ henüz kurulmamıştır (yalnızca bir bağımlılık olarak `package.json`'da bulunur, hiçbir modülde kullanılmaz). Bu nedenle `runDueRenewals` bir BullMQ tekrarlayan (repeatable) işine bağlanmak yerine:

- Enjekte edilebilir bir servis (`DunningService`) olarak sunulur, böylece BullMQ kurulduğunda bir işlemci onu doğrudan çağırabilir.
- `POST /admin/dunning/run` uç noktası (yalnızca süper admin, `apps/api/src/modules/payments/dunning.controller.ts`) üzerinden manuel/harici olarak tetiklenebilir. Gövdede opsiyonel `{ "now": "<ISO tarih>" }` verilebilir; verilmezse sunucu saatinin şu anı kullanılır.
- Üretimde bu uç nokta, sunucudaki bir cron girdisiyle (örn. saatte bir, süper admin servis token'ıyla) çağrılmalıdır. BullMQ kurulduğunda bu servis, günlük/saatlik tekrarlayan bir işe taşınmalı ve bu uç nokta kaldırılmalı veya yalnızca manuel yeniden deneme için bırakılmalıdır.

## Uç noktalar

| Uç nokta | İzin | Açıklama |
|----------|------|----------|
| `POST /payments/sell` | `packages.sell` | Personel; nakit, kart okutmalı, havale veya online satış |
| `POST /payments/checkout/self` | self-service | Üye kendi paketini satın alır (mock/online checkout) |
| `POST /payments/bank-transfer/confirm` | `finance.manage` | Bekleyen bir havale ödemesini onaylar ve paketi aktive eder |
| `GET /payments` | `finance.view` | Tarih, şube, yöntem, durum filtreleriyle ödeme listesi |
| `GET /payments/self` | self-service | Üyenin kendi ödemeleri |
| `POST /payments/:id/refund` | `finance.manage` | Kısmi veya tam iade; ödenen tutarı aşamaz, çift iadeye karşı korumalı |
| `POST /payments/cards/self`, `GET /payments/cards/self` | self-service | Üyenin kayıtlı kartları |
| `POST /payments/subscriptions` | `packages.sell` | Abonelik oluşturma |
| `POST /payments/subscriptions/:id/{cancel,pause,resume}` | `packages.sell` | Personel abonelik yönetimi |
| `POST /payments/subscriptions/:id/cancel/self` | self-service | Üye kendi aboneliğini dönem sonunda iptal eder |
| `GET /payments/subscriptions/self` | self-service | Üyenin abonelikleri |
| `POST /payments/webhook/:provider` | yok (JWT'siz) | Sağlayıcı webhook'u; imza doğrulaması adaptör tarafından yapılır, `providerReference` ile idempotent |
| `POST /admin/dunning/run` | süper admin | Gecikmiş tahsilatları elle tetikler |

## Mobil

`apps/mobile/app/(app)/hesabim/odemelerim.tsx` — "Ödemelerim" ekranı: üyenin ödeme geçmişi ve aktif aboneliği, dönem sonunda iptal eylemi ile.

## Üretimde mock sağlayıcı

`NODE_ENV=production` iken mock sağlayıcı devre dışıdır: online ödeme, kayıtlı kartla tahsilat, iade ve mock webhook'ları reddedilir ("Online ödeme henüz yapılandırılmadı"). Böylece gerçek sağlayıcı bilgileri girilmeden canlı ortamda ücretsiz paket açılamaz. Nakit, POS ve havale kayıtları sağlayıcı gerektirmediği için çalışmaya devam eder.

İade önce veritabanında koşullu olarak ayrılır, sonra sağlayıcıya gönderilir; sağlayıcı reddederse ayrım geri alınır. Tutarlar her yerde ondalık (Decimal) olarak hesaplanır. Webhook'taki tutar beklenen ödeme tutarıyla eşleşmezse ödeme tamamlanmaz.

## Satış araçları (W9): deneme dersi, promosyon kodu, hediye kartı

Bu bölüm `apps/api/src/modules/promotions` altındaki modülü ve `PaymentsService.sellPackage` / `memberCheckout` içine nasıl entegre edildiğini özetler.

### Deneme dersi teklifleri

- `PackageDefinition.isTrial` bir paketi deneme teklifi yapar; `trialLimitPerUser` (varsayılan 1) bu paketi bir kullanıcının kaç kez satın alabileceğini belirler. Limit, kullanıcının bu stüdyodaki tüm üyelikleri (Membership) üzerinden global kullanıcı kimliğine (`User.id`) göre izlenir, tek bir `member_profile`'a göre değil.
- `GET /studios/public/:slug/trial-offers` — JWT gerektirmez, yalnızca ad, fiyat, birim sayısı ve geçerlilik süresini döndürür. Herkese açık rezervasyon/kayıt sayfası için tasarlanmıştır.
- Bir deneme paketi `POST /payments/sell` veya `POST /payments/checkout/self` ile satın alındığında, satışın işlem (transaction) bloğu içinde `redemption_counters` tablosunda tek bir `INSERT ... ON CONFLICT DO UPDATE ... WHERE count < limit` deyimiyle hem kontrol hem rezervasyon yapılır; limit doluysa satış `409 Conflict` ile reddedilir ve hiçbir kayıt oluşmaz.

### Promosyon kodları

- Model: `PromoCode` (stüdyo başına, kod her zaman büyük harfle saklanır ve `(studioId, code)` üzerinde benzersizdir), `PromoRedemption` (bir ödemeye uygulanan tek kullanım kaydı).
- Tür (`kind`): `PERCENT` (yüzde), `FIXED_AMOUNT` (sabit tutar, fiyatı aşamaz), `FREE_UNITS` (fiyata dokunmaz, oluşturulan `MemberPackage`'a ekstra birim ekler). İndirim her zaman yarım yukarı (half-up) 2 ondalık basamağa yuvarlanır ve fiyatı asla negatif yapmaz.
- Kısıtlar: `validFrom`/`validTo`, `maxRedemptions` (toplam), `perUserLimit` (varsayılan 1), `minAmount`, `applicablePackageDefinitionIds` (boş = tüm paketler), `newMembersOnly` (bu stüdyoda daha önce tamamlanmış ödemesi olmayan kullanıcı).
- Doğrulama uç noktası: `GET /promotions/promo-codes/validate/self` (üye self-servis) — kodu **kullanmadan** indirimi önizler.
- Yeniden kullanım (redemption) her zaman satış işleminin (transaction) içinde olur: toplam limit `promo_codes.redeemed_count` üzerinde koşullu `updateMany` (`redeemedCount < maxRedemptions`) ile, kullanıcı başına limit `redemption_counters` üzerindeki aynı atomik sayaçla korunur. Eşzamanlı N istekten yalnızca izin verilen kadarı başarılı olur.
- Promosyon kodu ve hediye kartı yalnızca **anlık tamamlanan** ödemelerde (nakit, kart okutmalı, veya senkron tamamlanan online checkout) kullanılabilir; havale/EFT veya sonuçlanması bekleyen (PENDING) bir online checkout ile birlikte gönderilirse `400 Bad Request` döner. Bunun nedeni, bekleyen bir ödemenin daha sonra (webhook veya personel onayıyla) tamamlanması durumunda indirim/hediye kartı rezervasyonunun satışla aynı işlem (transaction) içinde atomik olarak yapılamamasıdır.

### Hediye kartları

- Model: `GiftCard` (kod yalnızca sha256 özeti + son 4 hane olarak saklanır; gerçek kod yalnızca oluşturulduğu anda bir kez döndürülür), `GiftCardTransaction` (ISSUE/REDEEM/REFUND/ADJUST).
- Kod üretimi: karışıklığa yol açabilecek karakterler (0/O, 1/I/L) hariç tutulan bir alfabeden, kriptografik olarak rastgele 16 karakter (`apps/api/src/modules/promotions/gift-card-code.ts`).
- Personel `POST /promotions/gift-cards` (`promotions.manage`) ile kart satar; bu bir `Payment` kaydı oluşturur (nakit/kart/havale, satın alan üyeye bağlı).
- Üye (veya personel adına) paket satın alırken `giftCardCode` (ve opsiyonel `giftCardAmount`) gönderir; kartın bakiyesi `gift_cards.balance` üzerinde koşullu `updateMany` (`balance >= amount`) ile atomik olarak düşülür — eşzamanlı iki harcamadan yalnızca biri başarılı olur. Kalan tutar normal ödeme yöntemiyle (nakit, kart, online) tahsil edilir.
- Bir ödemenin hediye kartıyla karşılanan kısmı iade edildiğinde, iade tutarına orantılı pay karta geri yatırılır (`Payment.giftCardRefunded` ile takip edilir, çift iadeye karşı korumalıdır).
- Üye self-servis bakiye sorgusu: `GET /promotions/gift-cards/check?code=...` — kod, sabit zamanlı (constant-time) bir karşılaştırma yerine sha256 özetinin indeksli eşitlik sorgusuyla bulunur; dakikada aşırı deneme Redis tabanlı bir hız sınırlayıcıyla (`GiftCardRateLimitGuard`) engellenir.
- `GET /promotions/gift-cards/mine` — üyenin satın aldığı kartların listesi (mobil "Hediye kartlarım").

### İzin

- `promotions.manage` — promosyon kodu CRUD, kullanım listesi, hediye kartı satışı/listesi/iptali/düzeltmesi. Varsayılan olarak yalnızca işletme sahibinde bulunur.
- Kod/kart **kullanımı** (satış sırasında) ayrı bir izin gerektirmez; mevcut `packages.sell` iznine sahip personel (örn. resepsiyon) zaten satış uç noktalarını çağırabildiği için otomatik olarak kullanabilir.

### Uç noktalar

| Uç nokta | İzin | Açıklama |
|----------|------|----------|
| `GET /studios/public/:slug/trial-offers` | yok (JWT'siz) | Bir stüdyonun aktif deneme tekliflerini listeler |
| `POST /promotions/promo-codes`, `PUT /promotions/promo-codes/:id`, `GET /promotions/promo-codes`, `GET /promotions/promo-codes/:id` | `promotions.manage` | Promosyon kodu CRUD |
| `GET /promotions/promo-codes/:id/redemptions` | `promotions.manage` | Bir kodun kullanım geçmişi |
| `GET /promotions/promo-codes/validate/self` | self-servis | Kodu kullanmadan indirimi önizler |
| `POST /promotions/gift-cards` | `promotions.manage` | Hediye kartı satışı (Payment kaydı oluşturur), kodu bir kez döndürür |
| `GET /promotions/gift-cards`, `GET /promotions/gift-cards/:id`, `GET /promotions/gift-cards/:id/transactions` | `promotions.manage` | Hediye kartı listesi, detay, hareket dökümü |
| `POST /promotions/gift-cards/:id/cancel`, `POST /promotions/gift-cards/:id/adjust` | `promotions.manage` | İptal ve manuel bakiye düzeltmesi (ikisi de denetlenir/audited) |
| `GET /promotions/gift-cards/check` | self-servis, hız sınırlı | Üyenin kod ile bakiye sorgusu |
| `GET /promotions/gift-cards/mine` | self-servis | Üyenin satın aldığı kartlar |
| `POST /payments/sell`, `POST /payments/checkout/self` | mevcut izinler | `promoCode`, `giftCardCode`, `giftCardAmount` alanları eklendi |
