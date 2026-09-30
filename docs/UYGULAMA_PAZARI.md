# Uygulama Pazarı (Ek Modüller) ve Ek Modül Faturalaması (G5c-2)

Bu belge, platformun işletmelere plana ek olarak sattığı modülleri (add-on) anlatır: süper adminin yönettiği katalog, işletmenin denemesi, satın alması ve iptali, ek modülün özellik bayrağını açması, dönemsel yenileme ve tahsilat hatasında yeniden deneme. Bağlayıcı tasarım `docs/BUYUME_VE_GLOBAL_MIMARI.md` bölüm 3.11 ve 6'dır; faturalama altyapısı `docs/DENEME_VE_ETKINLESTIRME.md` belgesindedir.

Buradaki "müşteri" işletmenin kendisidir (kiracı); kiracının üyeleriyle ilgili hiçbir şey bu modülde değildir.

## 1. Veri modeli

Migration: `20261030000000_add_on_marketplace` (yalnızca genişletme; hiçbir sütun silinmez veya yeniden adlandırılmaz).

| Tablo | Anlamı |
|---|---|
| `add_ons` | Katalog (platform verisi, kiracıya ait değil). `key` benzersiz; `name` ve `description` dil başına JSON (`{ "tr": "...", "en": "..." }`, tr ve en zorunlu, başka diller isteğe bağlı); tanıtım videosu bağlantısı (https); ekran görüntüsü bağlantıları (JSON dizisi, en fazla 8); açtığı özellik bayrağı anahtarı (`feature_flag_key`); deneme süresi (gün, 0-90); `is_published`; `sort_order` |
| `add_on_prices` | Ek modülün platform faturalama para birimi başına fiyatı (`PLATFORM_BILLING_CURRENCIES`): aylık ve yıllık tutar (`Decimal(10,2)`). (add_on_id, currency) benzersiz; CHECK kısıtları para birimi listesini ve pozitif tutarı korur |
| `studio_add_ons` | İşletmenin denemesi veya aboneliği: (studio_id, add_on_id) benzersiz (bu yüzden deneme ek modül başına işletme başına bir kez). `status`: `TRIALING`, `ACTIVE`, `CANCELLED`, `EXPIRED`; `billing_interval` (`MONTH`/`YEAR`); `trial_started_at`, `trial_ends_at`, `activated_at`, `cancelled_at`, `current_period_end`; `price_snapshot` (JSON: para birimi, aylık, yıllık, seçilen dönem ve dönem tutarı); `trial_reminder_sent_at`; `renewal_failures` ve `next_renewal_attempt_at` (tahsilat hatasında yeniden deneme) |
| `platform_billing_payments` | Yeni isteğe bağlı `studio_add_on_id`; `plan_id` artık boş olabilir (ek modül ödemesinin planı yoktur). CHECK kısıtı: plan veya ek modül aboneliğinden biri dolu olmalıdır |

`plan_id` sütununun NOT NULL kısıtının gevşetilmesi genişletme sayılır: eski sürüm plan ödemeleri yazmaya devam eder. Yalnızca eski sürümün ek modül ödemesi satırını `plan.key` ile okuması kırılırdı; eski sürüm bu satırları hiç üretmez.

## 2. Kataloğun süper admin tarafından yönetimi

`/admin/uygulama-pazari` (web) ve `SuperAdminOnly` uç noktalar. Her yazma `AuditLog`'a yazılır (`studio_id` boş):

| Uç nokta | İşlev | Denetim eylemi |
|---|---|---|
| `GET /admin/add-ons` | Liste; fiyatlar ve `tenantCount` (erişimi olan işletme sayısı) | |
| `POST /admin/add-ons` | Oluştur (her zaman taslak; anahtar benzersiz, `409 ADD_ON_KEY_EXISTS`) | `add_on.create` |
| `PATCH /admin/add-ons/:id` | Alanları güncelle (anahtar değişmez); yayınlama | `add_on.update` |
| `PUT /admin/add-ons/:id/prices` | Tam fiyat kümesi (listede olmayan para birimi silinir, orada satılmaz) | `add_on.prices` |
| `GET /admin/add-ons/revenue` | Tamamlanmış ek modül ödemeleri, para birimi başına ayrı | |

- **Yayınlama kapısı:** en az bir para biriminde fiyat yoksa yayınlanamaz (`400 ADD_ON_PUBLISH_NEEDS_PRICE`); yayındaki bir ek modülün son fiyatı silinemez (`409`), önce yayından kaldırılır.
- Doğrulama Zod ile paylaşılan şemalardadır (`CreateAddOnSchema`, `UpdateAddOnSchema`, `SetAddOnPricesSchema`): tr ve en metni zorunlu, https bağlantısı, iki ondalık basamak, pozitif tutar.
- **Dil geri düşüşü:** `localizedText(text, locale)`: tam dil kodu, dil kısmı, `en`, `tr`, sonra ilk dolu değer.
- Web: liste (durum, açtığı bayrak, deneme, para birimi başına fiyat, işletme sayısı), düzenleyici (tr/en ad ve açıklama, video, ekran görüntüleri, bayrak anahtarı, deneme, sıra, para birimi başına aylık ve yıllık fiyat), yayınla/kaldır, "Uygulama geliri" bloğu (para birimi başına, hiçbir zaman birleştirilmez).

## 3. İşletme tarafı

`/studios/:studioId/...`, `StudioScoped` ve `billing.manage` (yalnızca sahip, `OWNER_ONLY_PERMISSIONS`):

| Uç nokta | İşlev |
|---|---|
| `GET /add-ons` | Katalog ve işletmenin durumu: `AVAILABLE`, `TRIALING` (kalan gün), `ACTIVE`, `CANCELLED`, `EXPIRED`; işletmenin **faturalama para birimindeki** fiyat (`studioBillingCurrency`). O para biriminde fiyat yoksa kart görünür ama satın alınamaz: `purchasable: false`, `purchaseBlockedReason: "NO_PRICE_IN_CURRENCY"`, `price: null`. Yayında olmayan ek modül yalnızca işletmenin satırı varsa görünür |
| `POST /add-ons/:key/start-trial` | Ücretsiz deneme; ek modül başına bir kez (`409 ADD_ON_TRIAL_USED`). Fiyatı olmayan para biriminde `400 ADD_ON_PRICE_UNAVAILABLE`; deneme süresi 0 ise `400 ADD_ON_TRIAL_UNAVAILABLE` |
| `POST /add-ons/:key/activate` `{ interval: 'MONTH' \| 'YEAR' }` | Satın alma: platform faturalama yolundan (bölüm 5) tahsilat. Deneme, ödeme tamamlanınca `ACTIVE` olur |
| `POST /add-ons/:key/cancel` | İptal; dönem sonuna (deneme ise deneme bitişine) kadar kullanılabilir |
| `GET /features` | İşletmenin etkin özellik bayrakları ve kapalı olup bir yayındaki ek modülün açacağı bayraklar (`unlockableBy`). `@SelfService()`: işletmenin her üyesi okuyabilir, faturalama verisi içermez |

- **Kısıtlı mod:** `BillingWriteGuard` `billing.manage` yazmalarını geçirir; ek modül denemesi ve satın alma servis içinde ayrıca kontrol edilir: RESTRICTED/CANCELLED işletme deneme başlatamaz ve satın alamaz (`403 BILLING_RESTRICTED`); önce hesabı etkinleştirir. İptal ve okuma her zaman açıktır. Platform kiracısı ek modül almaz.
- Fiyat, satın alma anında `price_snapshot` olarak kilitlenir; katalogdaki sonraki fiyat değişikliği çalışan aboneliği etkilemez (yenileme anlık görüntü tutarını çeker).
- Başarısız ilk satın alma, deneme kullanılmamışsa denemeyi açık bırakır (`EXPIRED` yer tutucu satır, `trial_started_at` boş).
- İptal edilmiş ama erişimi süren bir ek modül tekrar etkinleştirilirse yeni dönem mevcut erişimin bittiği yerden başlar.

## 4. Özellik bayrağı çözümü

`FeatureFlagsService.isFeatureEnabled` tek doğruluk kaynağı olarak kalır ve yeni `resolveFeatureForStudio` (`billing/add-ons/effective-feature.ts`) üzerinden çözer; saf kural `resolveEffectiveFeature` (shared):

1. Açık **TENANT** satırı kazanır (kapatıyorsa da: süper adminin kill switch'i).
2. Yoksa, işletmenin şu anda **erişimi olan** bir `studio_add_ons` satırı varsa bayrak açıktır: `ACTIVE`; `TRIALING` ve deneme bitişi gelmemiş; `CANCELLED` ve `current_period_end` gelmemiş. `EXPIRED` asla.
3. Yoksa **BUSINESS_TYPE**, sonra **GLOBAL**; hiçbir satır yoksa kapalı.

Ek modül bir bayrağı yalnızca açabilir, başka bir kapsamın açtığı bayrağı kapatmaz. Çözüm satırların tarihlerine bakar; bu yüzden süre dolduğunda modül, kalp atışı çalışmasını beklemeden hemen kapanır, satır durumu kalp atışında `EXPIRED` olur.

## 5. Tahsilat, yenileme ve hata yönetimi

`AddOnChargeService`, plan etkinleştirmesiyle aynı ödeme yolunu kullanır: süreç genelindeki adaptör (`PaymentProviderRegistry.default`); MOCK geliştirme ve testte hemen tamamlanır, Stripe (ve diğer gerçek sağlayıcılar) barındırılan ödeme sayfası döndürür ve onay mevcut `POST /payments/webhook/:provider` adresine gelir (`PaymentWebhookRouter`; ek modül ödemeleri kendi işleyicisiyle, plan ödemeleri `PlatformBillingService` ile eşleşir, ikisi birbirinin kaydına dokunmaz). Ödeme `platform_billing_payments` satırıdır (`studio_add_on_id` dolu, plan boş, para birimi işletmeninki). **Tavsiye kredisi kullanılmaz; tavsiye ödülleri etkilenmez.** Ek modül ödemesi `studio_paid` dönüşümü üretmez (o hesap etkinleştirmeye aittir).

### Kalp atışı
`BillingJobsService.run()` (15 dakikada bir, `JobsService.runAll`) artık `AddOnJobsService.run()` de çalıştırır; hepsi koşullu güncellemeyle sahiplenilir (eşzamanlı çalışma çift gönderim, çift sona erdirme veya çift tahsilat yapmaz):
- **Deneme uyarısı:** deneme bitişine 3 gün kala işletme sahibine `ADDON_TRIAL_ENDING` (tr ve en, TRANSACTIONAL, mesajlaşma motoru; uygulama içi ve e-posta kanalları sahibin kanal ayarına göre), bir kez.
- **Süre dolumu:** biten deneme ve dönem sonu geçmiş iptal edilmiş ek modül `EXPIRED` olur (`add_on.expired` denetim kaydı).
- **Yenileme:** `ACTIVE` ve dönem sonu geçmiş satır, anlık görüntüdeki tutarla (para birimi dahil) tahsil edilir; yeni dönem önceki dönem sonundan başlar (kayma yok). Gerçek sağlayıcıda barındırılan ödeme sayfası bekleyen ödeme olarak kalır; 24 saat ödenmezse başarısız sayılır. Bekleyen yenileme ödemesi olan işletme `activate` ile ("Şimdi öde", `paymentOverdue`) öder.

### Tahsilat hatasında yeniden deneme (dunning)
Başarısız yenileme: 1., 2. ve 3. hatadan sonra sırasıyla 1, 3 ve 5 gün sonra yeniden denenir (`ADD_ON_DUNNING_RETRY_DAYS`); her hatada sahibe `ADDON_RENEWAL_FAILED` gider; **4. hatada ek modül `EXPIRED` olur** ve modül kapanır. Yeniden denemeler sürerken erişim devam eder. Bugün planlar için dönemsel yenileme motoru olmadığından (`docs/DENEME_VE_ETKINLESTIRME.md` bölüm 7) "planlarla aynı hata yönetimi" mevcut bir motoru yeniden kullanmaz; bu, ek modüller için yazılan ilk dunning'dir ve plan yenilemesi geldiğinde aynı adımları (`nextDunningAttempt`) kullanmalıdır.

## 6. Faturalama görünümleri

- İşletmenin `/studios/:id/billing/payments` listesi ek modül satırlarını gösterir (`planKey: null`, `addOn: { key, name }`); `/abonelik` sayfası "Uygulama: <ad>" yazar.
- Ek modül ödemesi de faturalama para birimini kilitler (tamamlanmış veya bekleyen platform ödemesi kuralı).
- Süper admin: `GET /admin/add-ons/revenue` para birimi başına tutar ve ödeme sayısı verir; para birimleri hiçbir yerde toplanmaz.

## 7. Web ve mobil

- Web `/ayarlar/uygulamalar` (Ayarlar merkezinde "Uygulama pazarı" kartı, `billing.manage`): kartlar (ad ve açıklama işletmenin dilinde, tanıtım videosu bağlantısı, ekran görüntüleri, aylık ve yıllık fiyat `Intl` ile işletmenin faturalama para biriminde), "Ücretsiz dene", "Aylık/Yıllık etkinleştir", "İptal et", kalan gün, dönem sonu. Fiyatı olmayan para biriminde açıklama gösterilir, düğme yoktur.
- `AddOnGate` (`apps/web/src/components/add-ons/AddOnGate.tsx`): bir modül ekranını `featureKey` ile sarar; bayrak kapalıysa ve bir yayındaki ek modül onu açıyorsa boş durum gösterir, sahibi `/ayarlar/uygulamalar` sayfasına, diğer personeli "sahibin etkinleştirmesi gerekir" metnine yönlendirir. İstek hatasında engellemez (gerçek kapı API'dir).
- Süper admin web `/admin/uygulama-pazari` ve gezinti girişi.
- Mobil: Hesabım > Uygulamalar (`billing.manage`), salt okunur: erişimi olan ek modüller ve denemeler, kalan gün veya yenileme tarihi; satın alma için web paneline bağlantı (`manageUrl`, `PUBLIC_APP_URL`).

## 8. Bilinen sınırlar ve açık kararlar

- **Hiçbir modül henüz özellik bayrağıyla kapalı değil.** `FEATURE_FLAGS` kataloğundaki anahtarların (`gamification`, `churn_risk`, `video_content`, ...) hiçbiri API veya web tarafından bir modülü kapatmak için okunmuyor. Bu yüzden örnek ek modüllerin bugünkü etkisi yalnızca bayrağın çözümünü değiştirmektir; bir modülün gerçekten satılabilmesi için o modülün ilgili uç noktalarında `isFeatureEnabled` denetimi ve ekranında `AddOnGate` gerekir. Bunu eklemek mevcut müşterilerin bugün kullandığı modülleri kapatacağı için sahip kararı gerektirir (varsayılan olarak açık mı kalacak, mevcut işletmelere GLOBAL/BUSINESS_TYPE bayrağı mı yazılacak?). Bu görevde hiçbir modül kapatılmadı ve yeni bayrak uydurulmadı.
- Örnek ek modüller (`prisma/seed.ts`, yalnızca geliştirme tohumu; üretim bootstrap'ine eklenmez): `gamification-plus`, `churn-radar`, `video-library`; hedefledikleri bayraklar yukarıdaki üç kataloğ anahtarıdır.
- Gerçek sağlayıcılarda saklı kart yoktur (platform düzeyinde kart kaydı yok); otomatik yenileme MOCK'ta çalışır, Stripe/iyzico/PayTR'de yenileme barındırılan ödeme sayfası gerektirir (bekleyen ödeme, 24 saat, sonra başarısız). Saklı kartla otomatik yenileme için platform düzeyinde kart kaydı gerekir (`chargeStoredCard` adaptör yeteneği mevcut). Sahip kararı.
- Yıllık aboneliğin iptalinde kalan sürenin iadesi yoktur (dönem sonuna kadar erişim).
- Tutar ve dönem, aboneliğin başında kilitlidir; fiyat artışının mevcut aboneliklere ne zaman yansıyacağı kararı (plan fiyatlarıyla aynı açık soru) bekliyor.
- Ek modüller için vergi/fatura kesimi bu adımda yok (plan ödemeleriyle aynı durum).

## 9. Testler

- Shared: `packages/shared/src/add-ons.spec.ts` (bayrak çözümü ve ek modül katmanı, deneme ve dönem sonu matematiği, para birimine göre fiyat, dil geri düşüşü, dunning günleri, uyarı eşiği, şemalar, hata çevirisi).
- API birim: `feature-flags.service.spec.ts` (ek modül katmanı), `studio-add-ons.service.spec.ts` (durum ve fiyat türetimi).
- API e2e: `add-on-marketplace.e2e-spec.ts` (süper admin CRUD ve yayınlama kapısı ve denetim; her işletme kendi para biriminde görür, fiyatı olmayan para biriminde satın alınamaz; sahibe özel izin; kısıtlı mod deneme başlatamaz; deneme bir kez ve yalnızca o işletmede bayrağı açar; MOCK ile tahsilat, bayrak, ödeme listesi; iptal dönem sonuna kadar erişim ve kalp atışı süre dolumu; başarısız ilk satın alma denemeyi açık bırakır; uyarı bir kez; webhook ile barındırılan ödeme; yenileme anlık görüntü tutarıyla ve 1/3/5 gün dunning ve dördüncü hatada süre dolumu; gelir para birimi başına).
- Web: Playwright `apps/web/e2e/add-on-marketplace.e2e.ts` (yalnızca tip denetimi yapıldı, koşulmadı).
