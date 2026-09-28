# Büyüme ve Global Mimari

Bu belge pazarlama, reklam atıfı, iletişim ve globalleşme işlerinin ortak tasarımıdır. Bu alandaki her PR bu belgeye uyar; belgeyle çelişen bir ihtiyaç çıkarsa önce belge güncellenir. Amaç, sonradan eklenen modüllerin birbirine yamanmış parçalar gibi değil, tek bir çekirdeğin parçaları gibi çalışmasıdır.

## 1. İlkeler

1. **Tek çekirdek, iki kullanıcı.** Platformun kendi pazarlaması (işletme sahiplerine satış) ve işletmelerin pazarlaması (üyelere satış) aynı modülleri kullanır. Platform, sistemde `isPlatform = true` işaretli özel bir kiracı (Studio) olarak temsil edilir. Süper admin kendi pazarlamasını bu kiracının içinden yapar. Böylece CRM, kampanya, akış, atıf ve sayfa motoru bir kez yazılır, iki kez kullanılır.
2. **Yama değil, yeniden yazım.** Aşağıdaki mevcut modüller yeni çekirdeğe taşınır ve eski hâlleri kaldırılır:
   - `leads` -> `crm` (Kişi modeli, aday ve üye aynı kişide birleşir)
   - `automations` (tek adımlı kurallar) -> `journeys` (çok adımlı akışlar); mevcut kural türleri hazır akış şablonu olur
   - `notifications` içindeki gönderim, şablon ve izin kodu -> `messaging` (kanal, bölge, izin, gelen kutusu)
   - `notifications/consent` (İYS) -> `compliance` altında bölgesel izin paketlerinden biri
   - açılış sayfası ve gömülü widget sayfaları -> `sites` (sayfa motoru)
3. **Önce genişlet, sonra daralt.** Şema değişiklikleri CLAUDE.md kuralına uyar: yeni tablolar eklenir, veri taşınır, eski tablolar bir sürüm boyunca okunur, sonra kaldırılır.
4. **Global varsayılan, bölgesel adaptör.** Hiçbir modül bir ülkeyi varsaymaz. Ülkeye özgü her şey (ödeme, SMS, e-fatura, izin sicili, vergi) bir adaptördür ve kiracının ülkesine göre seçilir.
5. **Her metin çok dilli.** CLAUDE.md kural 11. Mesaj şablonları, sayfa blokları ve form alanları da dile göre varyant taşır.
6. **Ölçülemeyen harcama yok.** Reklamdan gelen her ziyaret, form, deneme, satın alma ve abonelik aynı atıf zincirine bağlanır ve reklam platformlarına sunucu tarafından geri bildirilir.

## 1a. G1a uygulama notları

G1a fazında (bölge ayarları, para/vergi, sağlayıcı kayıt defteri, Stripe/Twilio, uyum) belgedeki bazı açık noktalar şöyle netleşti:

- `notifications/consent` (İYS) fiziksel olarak taşınmadı: dosyalar `apps/api/src/modules/notifications/consent/` altında kalıyor, mevcut endpoint yolları ve davranışı değişmedi. `apps/api/src/modules/compliance/tr-consent-registry.adapter.ts` bu servisi TR bölgesinin izin sicili adaptörü olarak sarmalıyor. Bölüm 1 madde 2'deki "taşınır" ifadesi, sonraki bir fazda dosyaların gerçekten `compliance/` altına taşınmasıyla tamamlanacak; G1a bunu yalnızca işlevsel olarak (canSend üzerinden) yapıyor.
- `compliance.canSend`'in sessiz saat kontrolü (08:00-21:00 alıcı yerel saati, bölüm 2.3) uygulandı ve test edildi, ancak `NotificationsService` bunu şimdilik `skipQuietHours: true` ile çağırıyor: bugünkü Türkiye gönderimlerinde davranış değişmesin diye canlıda henüz açılmadı. Sahibin onayıyla açılmalı (her bölge için pencere teyit edildikten sonra).
- Sağlayıcı kayıt defteri (`apps/api/src/common/provider-registry.ts`) `PaymentProviderRegistry.resolveFor(countryCode, tenantOverrideKey)` ile kullanıma sunuldu; `.default`/`.get`/`.byName` (mevcut davranış) değişmedi. Mesajlaşma kanalları (WhatsApp/Netgsm/İleti Merkezi/Twilio) henüz aynı jenerik sınıfa taşınmadı, `SMS_PROVIDER` ortam değişkeniyle seçiliyor; bir sonraki fazda per-tenant override ile birleştirilebilir.
- Vergi rejimi dışındaki (`TR_KDV` olmayan) kiracılar için sıra numaralı dahili fatura kaydı ve PDF üretimi bu fazın kapsamı dışında bırakıldı (madde 6'da belirtildiği gibi); yalnızca `taxRegime`/`pricesIncludeTax` alanları ve `StudioRegion` sözleşmesi eklendi.

## 2. Globalleşme çekirdeği

### 2.1 Kiracı bölge ayarları
`Studio` üzerinde: `countryCode` (ISO 3166-1), `currency` (ISO 4217), `defaultLocale`, `timezone` (mevcut), `taxRegime` (aşağıda). Para tutarları her yerde `Prisma.Decimal` + `currency` çifti olarak tutulur; kodda sabit `'TRY'` kalmaz. Biçimlendirme `Intl.NumberFormat(locale, { style: 'currency', currency })` ile yapılır.

Telefon numaraları zaten E.164; Türkiye'ye özgü normalleştirme `phone.ts` içinde ülke parametresi alacak şekilde genelleştirilir (varsayılan ülke kiracının ülkesi).

### 2.2 Sağlayıcı kayıt defteri
Tek bir `ProviderRegistry` deseni: her yetenek için bir arayüz, ülkeye göre öncelik listesi, kiracı ayarıyla geçersiz kılma, kimlik bilgileri şifreli (`credential-cipher`).

| Yetenek | Global varsayılan | Türkiye | Not |
|---|---|---|---|
| Kart ödemesi, abonelik | Stripe | iyzico, PayTR | Mevcut `PaymentProvider` arayüzü korunur, Stripe adaptörü eklenir |
| SMS | Twilio | Netgsm, İleti Merkezi | |
| WhatsApp | WhatsApp Cloud API (Meta) | aynı | Gelen mesaj webhook'u eklenir |
| E-posta | Amazon SES | aynı | Alan adı doğrulama (SPF, DKIM, DMARC) |
| OTP | SMS sağlayıcısı üzerinden | aynı | |
| Fatura | PDF fatura (genel) | e-Arşiv / e-Fatura entegratörü | |
| İzin sicili | yok | İYS | |

### 2.3 Uyum (compliance) paketleri
`compliance` modülü, alıcının ülkesine göre kuralları uygular:
- **TR:** KVKK aydınlatma ve açık rıza, İYS kaydı ve sorgusu, ticari ileti saatleri.
- **AB/EEA ve Birleşik Krallık:** GDPR açık rıza (önceden işaretli kutu yok), çerez izni ve Google Consent Mode v2, veri dışa aktarma ve silme talepleri.
- **ABD:** TCPA (SMS için açık yazılı onay, STOP/HELP anahtar kelimeleri, alıcının yerel saatine göre gönderim penceresi), CAN-SPAM (fiziksel adres, tek tıkla abonelikten çıkma).
- **Diğer:** en katı ortak kural (açık rıza + abonelikten çıkma + sessiz saatler).

Her ticari gönderim `compliance.canSend(recipient, channel, purpose)` kontrolünden geçer. İşlemsel mesajlar (rezervasyon onayı, OTP) izin gerektirmez ama sessiz saat ve sıklık sınırına yine tabidir.

### 2.4 Vergi ve fatura
`taxRegime`: `TR_KDV`, `EU_VAT`, `US_SALES_TAX`, `NONE`. Paket fiyatları vergi dahil veya hariç girilebilir (kiracı ayarı). e-Arşiv yalnızca `TR_KDV` için etkinleşir; diğer bölgelerde sıra numaralı PDF fatura üretilir.

### 2.5 Barındırma ve veri yerleşimi
Tek sunucu (6 GB) başlangıç için yeterlidir. AB müşterileri için GDPR gereği veri işleme sözleşmesi (DPA) ve alt işleyen listesi yayınlanır. AB'de veri tutma şartı getiren büyük müşteriler için bölgesel ikinci kurulum ileride değerlendirilir; kod buna engel olacak şekilde yazılmaz (bölge sabitlenmez).

## 3. Büyüme çekirdeği

### 3.1 CRM: Kişi (Contact)
Kiracı başına her tanınan kişi tek bir `Contact` satırıdır: aday, deneme alan, üye, eski üye. Alanlar: ad, telefon (E.164), e-posta, dil, ülke, saat dilimi, yaşam döngüsü aşaması (`LEAD`, `TRIAL`, `MEMBER`, `LAPSED`, `LOST`), sahibi (personel), etiketler, özel alanlar (kiracının tanımladığı `ContactFieldDefinition`), ilk ve son atıf özeti.

- Kullanıcı hesabı oluşunca `Contact.membershipId` bağlanır; `MemberProfile` üyelik ayrıntısı olarak kalır.
- Mevcut `Lead` ve `LeadActivity` verisi `Contact` ve `ContactActivity`'ye taşınır.
- Satış hattı (pipeline) aşamaları kiracı verisidir; görevler (arama, mesaj, takip) personele atanır.
- Tekilleştirme: aynı kiracıda telefon veya e-posta eşleşmesi. Birleştirme işlemi denetim kaydına yazılır.

**Durum (G1b, yapıldı):** `Contact` (tüm alanlar, etiketler, özel alanlar, ilk/son atıf özeti, test işareti, birleştirme), `ContactActivity`, `ContactFieldDefinition`, `PipelineStage` (her kiracıya varsayılan aşamalar), `ContactTask`; `Lead`/`LeadActivity` verisinin ve üyelerin kişiye taşınması (eski tablolar daraltma sürümüne kadar yerinde, yazılmıyor); üyelik bağlama ve yaşam döngüsü kancaları; tekilleştirme ve denetimli birleştirme; `crm.view`/`crm.manage`/`crm.export` izinleri; `/crm` API'si ve kullanımdan kaldırılmış `/leads` sarmalayıcıları. Kalan: kişi listesi, kartı ve satış hattı panosu arayüzü (G2a ile). Ayrıntılar: `docs/CRM_VE_ATIF.md`.

### 3.2 Atıf (attribution)
**Ziyaretçi ve oturum.** Birinci taraf çerezi `pw_vid` (anonim ziyaretçi kimliği, 13 ay) ve `pw_sid` (oturum). Çerez izni gereken bölgelerde izin verilmeden yalnızca oturum içi, çerezsiz sayım yapılır.

**Temas noktası (Touchpoint).** Her oturumun ilk isteğinde kaydedilir:
- `utm_source`, `utm_medium`, `utm_campaign`, `utm_id`, `utm_term`, `utm_content`
- reklam kimlikleri: `pw_cid` (kampanya), `pw_asid` (reklam seti / reklam grubu), `pw_adid` (reklam), `pw_plc` (yerleşim)
- tıklama kimlikleri: `fbclid` (ve türetilen `_fbc`), `_fbp`, `gclid`, `gbraid`, `wbraid`, `ttclid`, `li_fat_id`, `msclkid`
- açılış URL'si, yönlendiren, cihaz, dil, ülke (IP'den kaba konum; IP saklanmaz, yalnızca ülke)

**Bağlama.** Bir form gönderildiğinde, deneme alındığında veya hesap açıldığında ziyaretçi `Contact`'a bağlanır. Aynı kişinin önceki temas noktaları da geriye dönük bağlanır.

**Dönüşüm olayları (ConversionEvent).** `lead`, `trial_booked`, `trial_attended`, `purchase`, `subscription_started`, `subscription_renewed`, platform kiracısında ayrıca `studio_signup` ve `studio_paid`. Her olay tutar, para birimi, benzersiz `eventId` ve kişiyi taşır.

**Modeller.** Raporlarda ilk temas, son temas (varsayılan) ve doğrusal model seçilebilir. Atıf penceresi kiracı ayarıdır (varsayılan 30 gün tıklama).

**Durum (G1b, yapıldı):** `pw_vid`/`pw_sid` çerezleri ve bölgeye göre izin bandı (AB/Birleşik Krallık/Kanada açık rıza ve Consent Mode v2, TR KVKK, ABD ve diğerleri bilgilendirme + GPC); `Visitor` ve `Touchpoint` kaydı (izinsiz hiçbir şey, reklam izni olmadan tıklama kimliği yok, sorgu dizesi ve IP saklanmaz, bot filtresi, hız sınırı); sunucu tarafında bağlama (herkese açık identify ucu yok) ve geriye dönük temas noktası bağlama; `lead`, `trial_booked`, `trial_attended`, `purchase`, `subscription_started`, `subscription_renewed`, platform kiracısında `studio_signup` olayları (idempotent, son temasa atfedilmiş); ilk/son/doğrusal modelli atıf raporu ve etiketsiz ücretli trafik sayısı. Ayrıntılar: `docs/CRM_VE_ATIF.md`.

**Durum (G2b, yapıldı):** atıf penceresi artık kiracı ayarı (`Studio.attributionWindowDays`, varsayılan 30, `PATCH /studios/:studioId/ads/settings`); `Touchpoint.advertisingConsent` her temas noktasında saklanır ve reklam platformuna gönderimin tek izin kapısıdır. Kalan: `studio_paid` bağlantısı platform faturalaması eklendiğinde bağlanacak (G3c/faturalama fazı).

### 3.3 Reklam platformlarına geri bildirim
`ConversionEvent` bir giden kuyruğuna (outbox) yazılır. Arka plan işi, izin durumuna bakarak şu hedeflere gönderir:
- **Meta Conversions API:** `event_id` tarayıcı Pixel'i ile aynıdır (çift sayım olmaz); hash'lenmiş e-posta ve telefon, `fbc`, `fbp`.
- **Google Ads:** `gclid` / `gbraid` / `wbraid` varsa çevrimdışı tıklama dönüşümü; yoksa hash'lenmiş verilerle gelişmiş dönüşüm (enhanced conversions for leads).
- **TikTok Events API** ve **LinkedIn Conversions API:** adaptör olarak, ihtiyaç olduğunda açılır.

Başarısız gönderimler üstel beklemeyle tekrar denenir, sonuç panelde görünür.

**Durum (G2b, yapıldı):** `ConversionDeliveryDispatcherService` (webhook dağıtıcısıyla aynı desen: ayrı bir BullMQ kuyruğu değil, `JobsService.runAll()`'ın 15 dakikalık kalp atışından -- veya Redis varsa tekrarlayan BullMQ işinden -- çağrılan, `PENDING` ve zamanı gelmiş satırları işleyen bir dağıtıcı; üretim kutusunun 6 GB RAM'i başka bir işçi sürecine yer bırakmaz) Meta CAPI, Google Ads (gclid/gbraid/wbraid varsa çevrimdışı tıklama dönüşümü, yoksa hash'lenmiş e-posta/telefonla gelişmiş dönüşüm) ve TikTok Events adaptörlerine gönderir; `CONVERSION_RETRY_DELAYS_SECONDS` ile yeniden dener, son denemeden sonra `FAILED` (ölü mektup) kalır. İzin veya eşleşme yoksa (`SKIPPED_NO_CONSENT` / `SKIPPED_NO_MATCH`) hiç gönderilmez. Test trafiği (`isTest`) zaten kuyruğa hiç yazılmaz (G1b); bağlantının kendi `isTestMode` bayrağı ise gerçek (test olmayan) olayları platformun test modunda işaretler (Meta `test_event_code`), yayın öncesi doğrulama içindir. `AdConnection` bağlantı CRUD'ı `/studios/:studioId/ads/connections` altında (`ads.manage`), kimlik bilgileri şifreli (`CredentialCipher`) ve asla geri döndürülmez, yalnızca son 4 karakter. Ayrıntılar: `docs/REKLAM_ENTEGRASYONU.md`.

### 3.4 Reklam yapısı ve harcama senkronu
Meta Marketing API ve Google Ads API'den günlük olarak kampanya, reklam seti ve reklam adları, durumları ve günlük harcama çekilir (`AdEntity`, `AdSpendDaily`). URL'lerde kimlikler taşındığı için reklam adı sonradan değişse bile atıf bozulmaz; raporda güncel ad gösterilir. Raporlar: kaynak, kampanya, reklam seti ve reklam bazında harcama, aday, deneme, satış, gelir, aday başı maliyet (CPL), müşteri edinme maliyeti (CAC), reklam getirisi (ROAS).

**Durum (G2b, yapıldı):** `AdSpendSyncService` günde bir kez (kalp atışı içinde kendi eşiğini uygulayan bir throttle ile) her bağlı hesabın kampanya/reklam seti/reklam harcamasını çeker ve `POST /studios/:studioId/ads/spend/sync` ile elle tetiklenebilir; atıf raporu harcamayı `groupBy` seviyesine göre eşleştirip CPL/CAC/ROAS hesaplar. TikTok'un yapı senkronu şimdilik yalnızca harcamayı döndürür, üst-alt ilişkisini değil (`parent_external_id` boş kalır); bir sonraki fazda TikTok'un ayrı yapı ucundan tamamlanacak.

### 3.5 Segmentler
Kural dili (Zod ile tanımlı, `packages/shared`) kişi alanları, etiketler, özel alanlar, yaşam döngüsü, katılım (son X günde seans, toplam seans), paket durumu (bitiyor, bitti), ödeme, atıf (kaynak, kampanya), dil, ülke ve şube üzerinde çalışır. `AND`/`OR` grupları desteklenir. Kurallar güvenli biçimde parametreli sorguya çevrilir (serbest SQL yok). Segment boyutu önbelleğe alınır ve arka planda yenilenir. Segmentler kampanyalar, akışlar ve raporlar tarafından ortak kullanılır.

### 3.6 Mesajlaşma motoru
- **Kanallar:** e-posta, SMS, WhatsApp, push, uygulama içi. Hepsi bölgesel sağlayıcı kayıt defterinden seçilir. Mevcut WhatsApp -> SMS sırası kiracı ayarı olarak kalır.
- **Şablonlar:** kanal ve dil başına varyant, değişkenler (`{firstName}` gibi), e-posta için blok tabanlı düzenleyici ve marka teması. WhatsApp şablonları Meta onay durumunu taşır.
- **Gönderim kontrolleri** (sırayla): uyum ve izin, alıcının saat dilimine göre sessiz saatler, sıklık sınırı (kişi başına günlük ve haftalık ticari mesaj sayısı), tekilleştirme.
- **Takip:** iletildi, okundu (e-posta pikseli, WhatsApp okundu bilgisi), tıklandı (bağlantılar kısa izleme adresine çevrilir, tıklama dönüşüm zincirine bağlanır), abonelikten çıktı, geri döndü (bounce), şikâyet.
- **Gelen kutusu:** WhatsApp, SMS ve e-posta cevapları `Conversation` ve `ConversationMessage` olarak kaydedilir; kişi kartına bağlanır, personele atanır, hazır cevaplar ve yapay zeka önerisi kullanılabilir. Uygulama içi üye-personel sohbeti de aynı kutuya düşer.
- **SMS kredisi:** mevcut kural korunur, kredi yalnızca fiilen gönderilen SMS için düşer.

### 3.7 Kampanyalar ve akışlar
- **Kampanya:** bir segmente tek seferlik gönderim; kanal, şablon, zamanlama (alıcının yerel saatine göre gönderim seçeneği), A/B varyantı (kazananı açılma veya tıklamaya göre otomatik seçme), sonuç raporu ve atfedilen gelir.
- **Akış (journey):** tetikleyici (segmente girme, olay: deneme alındı, paket bitiyor, doğum günü, gelmedi, form gönderildi vb.), adımlar (bekle, koşul dalı, mesaj gönder, etiket veya alan güncelle, görev oluştur, puan ver, webhook), hedef (ör. satın aldı) ve çıkış kuralları. Her kişi için akış durumu saklanır; adımlar kuyrukta idempotent çalışır.
- Mevcut altı otomasyon kuralı (geri kazanma, paket bitiyor, doğum günü, ilk seans sonrası, rezervasyon hatırlatma, gelmeyene takip) hazır akış şablonları olarak gelir ve mevcut kurallar taşıma sırasında otomatik akışa çevrilir.

### 3.8 Sadakat
Puan defteri (`LoyaltyLedger`): kazanma kuralları (seansa katılım, satın alma tutarı, tavsiye, doğum günü, rozet), harcama (indirim, ek seans hakkı, hediye), son kullanma politikası (kiracı ayarı). Mevcut tavsiye ödülü ve rozetler puan kazanma kaynağına dönüşür.

### 3.9 Sayfa motoru (Sites)
`Site` -> `Page` -> `Block`. Bloklar tipli ve şemalıdır (başlık bandı, özellik listesi, sektör kartları, fiyatlar, SSS, yorumlar, form, rezervasyon takvimi, eğitmenler, iletişim). Her sayfanın dil varyantları vardır; metinler blok içinde dile göre tutulur, çevrilmemiş dil ana dile düşer.

- **Platform sitesi:** platform kiracısının sitesi; sektör ve dile göre dinamik açılış sayfaları (bölüm 5).
- **İşletme siteleri:** her kiracı kendi sitesini aynı motorla kurar; alan adı `<slug>.<platform-alanı>` veya kendi alan adı (Caddy on-demand TLS ile otomatik sertifika).
- **Formlar:** form bloğu `Contact` oluşturur, atıfı bağlar, `lead` dönüşümü üretir, KVKK/GDPR onay metnini ülkeye göre gösterir, bot koruması (gizli alan + hız sınırı + zaman kontrolü) içerir.
- **A/B testi:** sayfa varyantı ziyaretçiye çerezle sabitlenir, dönüşüm oranı raporlanır.
- **SEO:** sayfa başlığı ve açıklaması, Open Graph, `hreflang`, site haritası, yapılandırılmış veri (Organization, LocalBusiness, FAQPage, Offer), sunucu tarafında render.
- **Performans:** sayfalar statik üretilir ve önbelleğe alınır; içerik değişince yeniden üretilir.

**Durum (G2c, yapıldı):** `Site`/`Page`/`PageLocale`/`Block`/`PageVersion`/`CompanyInfo` modeli; tipli ve Zod ile doğrulanan bloklar (hero, özellik listesi, sektör kartları, nasıl çalışır, fiyatlar, yorumlar, SSS + `FAQPage` JSON-LD, istatistikler, CTA, form, rezervasyon widget'ı, eğitmenler, iletişim, yasal metin); platform sitesi ve işletme siteleri aynı motorla, `/{dil}/{sektör}/{teklif}` ve `<slug>.<platform-alan-adı>`/özel alan adı yönlendirmesiyle; yalnızca yayınlanan diller render edilir, `hreflang`/canonical/OG/JSON-LD/sitemap/robots; A/B varyantı çerezle sabitlenir; süper admin "Web sitesi" ve kiracı "Web sitem" editörleri (blok düzenleme, sürüm geçmişi + geri alma, sektör açılış sayfası sihirbazı, özel alan adı doğrulama); Caddy on-demand TLS "ask" uç noktası. Kalan: joker (wildcard) sertifika ve tam CMS önizleme deneyimi ileride ele alınabilir. Ayrıntılar: `docs/SAYFA_MOTORU.md`.

### 3.10 Yapay zeka çekirdeği
Tek sağlayıcı katmanı (varsayılan Anthropic Claude), şifreli anahtar, model seçimi, kullanım ve maliyet ölçümü, kiracı başına aylık limit. Kullananlar: dil çevirisi, kampanya ve sayfa metni yazımı, gelen kutusu cevap önerisi, kişiye özel geri kazanma mesajı, segment tarifinden kural üretme.

### 3.11 Rakip incelemesinden gelen eklemeler

Sahibin paylaştığı Momence yönetim paneli kaydından (Eylül 2026) çıkarılan fikirler. Birebir kopyalanmaz; ilke ve akış olarak alınır, tasarım bizim token ve tema sistemimizle yapılır.

**Kullanıcı deneyimi iyileştirmeleri (mevcut ekranlar)**
- **Global hızlı işlem çubuğu:** Web ve mobil üst barda her ekrandan erişilen hızlı satış (sepet), takvim, bildirimler ve profil. Hızlı satış küçük bir pencerede açılır: kişi seç veya yeni kişi ekle, paket/ürün seç, "başkası adına ödüyor" seçeneği, ödeme yöntemi. Satış akışı üye kartındakiyle aynı servisi kullanır.
- **Açıklayıcı boş durumlar:** Her boş liste, özelliğin ne işe yaradığını anlatan tek cümle ve tek birincil eylem içerir. Ortak `EmptyState` bileşeni, metinler i18n anahtarı.
- **Raporlarda dönem karşılaştırması:** Tarih aralığı, "önceki dönem / geçen yıl" karşılaştırması ve günlük/haftalık/aylık gruplama; kartlarda değişim yüzdesi.
- **Yetki uyarısı:** Menüden ulaşılan ama yetkisi olmayan bir işlemde tam sayfa 403 yerine satır içi bildirim; doğrudan URL ile gelinen sayfalarda 403 ekranı kalır.

**Yeni modüller**
- **Topluluk ve erişim katmanları:** Üyelere özel içerik akışı (gönderi, video, dosya, duyuru), yorum ve beğeni, erişim katmanları (hangi üyelik veya paket hangi içeriği görür), herkese açık paylaşım bağlantısı (isteğe bağlı), mobilde akış ekranı. Mevcut video kütüphanesi (W19) bu modüle bağlanır.
- **Uygulama pazarı (ek modüller):** Modül kataloğu (ad, açıklama, tanıtım videosu, ekran görüntüleri, aylık fiyat, deneme süresi), kiracının modülü etkinleştirmesi ve denemeyi ücretliye çevirmesi, faturalamaya eklenmesi. Mevcut `Plan`, `Subscription` ve `FeatureFlag` altyapısı üzerine kurulur; platform için ek gelir modeli.
- **Dönüşüm hunileri:** Hazır huniler (aday -> deneme randevusu -> katıldı -> üye; deneme teklifi -> üye) ve kiracının tanımlayacağı huniler; adım bazında dönüşüm oranı, ortalama geçiş süresi, kaynak ve kampanya kırılımı. Veri kaynağı CRM ve `ConversionEvent`.
- **Banka ödemeleri ve mutabakat:** Ödeme sağlayıcısından (Stripe payout, iyzico/PayTR hakediş) banka hesabına geçen toplu tutarların listesi, içindeki tek tek tahsilatlar, komisyon ve iade kesintileri, muhasebe dışa aktarımı.
- **Deneme süresi ve etkinleştirme (platform satışı):** Yeni işletmeler için deneme süresi, panelde kalan gün bandı ve "hesabı etkinleştir" akışı, süresi dolunca kısıtlı mod. Etkinleştirme `studio_paid` dönüşümünü üretir (bölüm 3.2).
- **İşletmeden işletmeye tavsiye programı:** Platformu başka bir işletmeye öneren kiracıya ödül (abonelik kredisi); platform kiracısının CRM ve atıf altyapısını kullanır.

## 4. UTM ve reklam adlandırma standardı

### 4.1 Adlandırma
Adlar raporlarda okunabilirlik içindir; atıf kimliklerle yapılır.

- **Kampanya:** `{pazar}_{dil}_{sektör}_{amaç}_{yyyymm}`, örnek `tr_tr_pilates_lead_202610`, `de_de_yoga_trial_202611`, `us_en_allsector_brand_202610`
- **Reklam seti / reklam grubu:** `{kitle}_{yerleşim}_{teklif}`, örnek `lookalike1pct_feed_freetrial`
- **Reklam:** `{kreatif}_{format}_{varyant}`, örnek `ownerdashboard_video15s_v2`

İzin verilen değerler (pazar, dil, sektör, amaç) platform panelinde bir listedir; UTM oluşturucu yalnızca bu değerlerle ad üretir.

### 4.2 URL parametreleri
**Meta (Facebook, Instagram) - "URL parametreleri" alanına yapıştırılır:**
```
utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_id={{campaign.id}}&utm_term={{adset.name}}&utm_content={{ad.name}}&pw_cid={{campaign.id}}&pw_asid={{adset.id}}&pw_adid={{ad.id}}&pw_plc={{placement}}
```

**Google Ads - hesap düzeyinde "Nihai URL son eki" alanına yapıştırılır** (otomatik etiketleme açık kalır, `gclid` ayrıca gelir):
```
utm_source=google&utm_medium=cpc&utm_campaign={_campaign}&utm_id={campaignid}&utm_term={keyword}&utm_content={creative}&pw_cid={campaignid}&pw_asid={adgroupid}&pw_adid={creative}&pw_plc={network}
```
`{_campaign}` özel parametresi her kampanyada kampanya adıyla tanımlanır (UTM oluşturucu bunu hazırlar).

**TikTok:**
```
utm_source=tiktok&utm_medium=paid_social&utm_campaign=__CAMPAIGN_NAME__&utm_id=__CAMPAIGN_ID__&utm_term=__AID_NAME__&utm_content=__CID_NAME__&pw_cid=__CAMPAIGN_ID__&pw_asid=__AID__&pw_adid=__CID__&pw_plc=__PLACEMENT__
```

**LinkedIn** dinamik parametre desteği sınırlı olduğu için UTM oluşturucu her reklam için sabit kimlikli URL üretir.

### 4.3 Doğrulama
- Parametresiz veya standart dışı reklam trafiği raporda "Etiketsiz ücretli trafik" olarak ayrıca gösterilir.
- UTM oluşturucu adı ve URL'yi doğrular, açılış sayfasının var olduğunu ve dilin etkin olduğunu kontrol eder.

## 5. Platform açılış sayfaları

URL yapısı: `/{dil}/{sektör}` ve kampanya varyantları için `/{dil}/{sektör}/{teklif}`.
Örnekler: `/tr/pilates`, `/en/yoga-studio-software`, `/de/yoga`, `/tr/pilates/ucretsiz-deneme`.

- Sektör listesi `BusinessTypeTemplate` verisinden gelir; her sektörün her dilde yerelleştirilmiş adı ve URL parçası vardır.
- İçerik, sayfa motorunun blokları ve sektör kelime dağarcığıyla üretilir (ör. yoga için "öğrenci", fizyoterapi için "danışan").
- Yayındaki her sayfa `hreflang` ile diğer dillerine bağlanır; olmayan dil varyantı yayınlanmaz.
- Form ve deneme başlatma, platform kiracısında `Contact` ve `lead` / `studio_signup` dönüşümü üretir; yeni işletme açıldığında ve ilk ödemeyi yaptığında `studio_signup` ve `studio_paid` dönüşümleri reklam platformlarına gönderilir.
- Genel kurumsal sayfalar (ana sayfa, özellikler, fiyatlar, SSS, iletişim, hakkımızda, yasal metinler) aynı motorla yazılır; kurumsal bilgiler (unvan, adres, sicil ve vergi numarası, iletişim) süper admin panelinden gelir.

## 6. Uygulama sırası

Her madde ayrı PR'dır; her PR kendi e2e testleriyle gelir.

| Faz | İş | Bağımlılık |
|---|---|---|
| G0 | Bu belge; CLAUDE.md güncellemesi; paylaşılan sözleşmeler (atıf, dönüşüm, segment kural dili, akış şeması, para) | - |
| G1a | Tamamlandı. Globalleşme: bölge ayarları, para ve vergi, sağlayıcı kayıt defteri, Stripe ve Twilio adaptörleri, uyum paketleri (İYS dahil yeniden yazım) | G0 |
| G1b | Tamamlandı. CRM ve atıf: Contact (Lead taşıması), ziyaretçi ve temas noktası yakalama, dönüşüm olayları, platform kiracısı (`docs/CRM_VE_ATIF.md`) | G0 |
| G1c | Mesajlaşma motoru: e-posta kanalı (SES), şablonlar, gönderim kontrolleri, izleme, gelen mesajlar ve gelen kutusu | G1a |
| G2a | Segmentler, kampanyalar, akışlar (otomasyon taşıması) | G1b, G1c |
| G2b | Tamamlandı. Reklam entegrasyonu: Meta CAPI, Google Ads dönüşümleri, reklam yapısı ve harcama senkronu, atıf raporları, UTM oluşturucu (`docs/REKLAM_ENTEGRASYONU.md`) | G1b |
| G2c | Tamamlandı. Sayfa motoru: platform sitesi, sektör ve dil bazlı açılış sayfaları, kurumsal sayfalar, işletme siteleri ve özel alan adı (`docs/SAYFA_MOTORU.md`) | G1b |
| G3a | Sadakat puanı | G2a |
| G3b | Yapay zeka çekirdeği: çeviri, metin yazımı, cevap önerisi | G1c |
| G3c | Perakende ve stok, atölye/kurs/etkinlik, muhasebe ve Zapier | G1a |
| G5a | Kullanıcı deneyimi iyileştirmeleri: global hızlı işlem çubuğu ve hızlı satış, açıklayıcı boş durumlar, raporlarda dönem karşılaştırması, satır içi yetki uyarısı (bölüm 3.11) | G1a |
| G5b | Topluluk ve erişim katmanları (bölüm 3.11) | G1c |
| G5c | Uygulama pazarı ve ek modül faturalaması; deneme süresi ve etkinleştirme; işletmeden işletmeye tavsiye (bölüm 3.11) | G2b |
| G5d | Dönüşüm hunileri; banka ödemeleri ve mutabakat (bölüm 3.11) | G2a |
| G4 | Yayın öncesi sertleştirme: uçtan uca huni testi, güvenlik incelemesi, yük testi, hazırlık (staging) ortamında gerçek sağlayıcılarla deneme | hepsi |

## 7. Yayın öncesi kabul ölçütleri

Reklam bütçesi harcanmadan önce şunların hepsi doğrulanmış olmalıdır:
1. Uçtan uca test: reklam URL'si -> açılış sayfası -> form -> kişi kaydı -> deneme -> ödeme -> abonelik; her adımda atıfın korunduğu ve dönüşümün Meta ve Google'a (test modunda) gittiği otomatik testle kanıtlanır.
2. Meta Events Manager'da tarayıcı ve sunucu olaylarının tekilleştirildiği (event match quality) görülür; Google Ads'de dönüşüm eylemleri "kaydediliyor" durumundadır.
3. Çerez izni reddedildiğinde hiçbir reklam çerezi yazılmaz ve olay gönderilmez (AB testleri).
4. Tüm açılış sayfaları iki dilde de SEO ve erişilebilirlik denetiminden geçer; mobil sayfa hızı hedefi sağlanır.
5. E-posta alan adı doğrulaması tamamdır ve spam testleri geçer; SMS ve WhatsApp şablonları onaylıdır.
6. Formlarda bot koruması ve hız sınırı etkin; test verisi raporları kirletmez (test trafiği işaretlenir).
7. Hata izleme ve uyarılar açık: dönüşüm gönderim hatası, form hatası, ödeme hatası.

## 8. Sahibin sağlaması gerekenler

| Konu | Neden | Süre notu |
|---|---|---|
| Meta Business hesabı, Pixel, Conversions API erişim anahtarı, alan adı doğrulaması | Meta reklam atıfı ve geri bildirim | Hemen başlanabilir |
| Google Ads hesabı, Google Ads API geliştirici anahtarı (developer token) | Google dönüşüm yükleme ve harcama senkronu | Onayı günler-haftalar sürebilir, erken başvurulmalı |
| Hedef pazarlar ve öncelik sırası | Dil, para birimi, uyum paketi, sağlayıcı önceliği | |
| E-posta gönderim alan adı ve Amazon SES hesabı | E-posta kanalı | SES üretim erişimi onay gerektirir |
| Twilio hesabı (global SMS), WhatsApp Business numarası | Global mesajlaşma ve gelen kutusu | WhatsApp şablon onayı gerekir |
| Stripe hesabı | Global ödeme | |
| Hukuki metinler (ülkelere göre) ve AB için veri işleme sözleşmesi | Uyum | |
