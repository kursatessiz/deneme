# Segmentler, Kampanyalar ve Akışlar (G2a)

Bu belge G2a fazında gelen dört parçayı anlatır: segmentler, kişi düzeyinde ticari izin, kampanyalar ve akış (journey) motoru. Eski W10 otomasyon kuralları akış motoruna taşındı; `docs/AUTOMATIONS.md` yalnızca tarihsel başvuru içindir. Bağlayıcı tasarım `docs/BUYUME_VE_GLOBAL_MIMARI.md` bölüm 3.5 ve 3.7'dir.

## 1. Özet

| Parça | Kod | İzinler |
|---|---|---|
| Segmentler | `apps/api/src/modules/growth/segments` | `segments.view`, `segments.manage` |
| Kişi düzeyinde ticari izin | `apps/api/src/modules/notifications/consent/contact-consent.service.ts` | `crm.view` (okuma), `crm.manage` (kayıt) |
| Kampanyalar | `apps/api/src/modules/growth/campaigns` | `campaigns.view`, `campaigns.manage` |
| Akışlar | `apps/api/src/modules/growth/journeys` | `journeys.view`, `journeys.manage` |
| Eski `/automation-rules` | `apps/api/src/modules/automations` (kullanımdan kaldırıldı, sarmalayıcı) | `notifications.manage` (değişmedi) |

Sözleşmeler (Zod şemaları, DTO'lar, şablonlar) `packages/shared/src/growth/` altındadır: `segments.ts` (kural dili, G0), `segment-api.ts`, `campaigns.ts`, `journeys.ts` (akış şeması, G0 + G2a eklemeleri), `journey-api.ts` (API sözleşmesi, şablon galerisi, eski kural dönüşümü). Web ekranları `apps/web/src/app/(app)/(dashboard)/{kisiler,segmentler,kampanyalar,akislar}` altındadır.

Altı yeni izin anahtarı migration ile mevcut sahip rol şablonlarına eklendi; sahip zaten her izne sahiptir. Resepsiyon ve eğitmen varsayılan olarak bu anahtarları almaz; işletme rol ekranından verebilir.

## 2. Segmentler

**Model.** `Segment` (studioId, ad, açıklama, `kind` = `DYNAMIC` veya `STATIC`, `rules` JSON, `cachedCount`, `refreshedAt`, arşiv tarihi) ve güncel üyeler `SegmentMember` (segment, kişi, `enteredAt`, elle eklendi mi).

- **Dinamik segment**: kurallara uyan herkes. Üyelik arka planda, zamanlayıcı kalp atışında bir saatten eski olan segmentler için yeniden hesaplanır (en fazla 20 segment/atış). Yeni girenler `enteredAt` ile eklenir, çıkanlar silinir; yeni girenler akış motorunun `segment_entered` tetikleyicisine iletilir.
- **Statik segment**: personelin elle eklediği kişiler (`POST .../members`); istenirse oluşturulurken kurallara uyanlarla bir kez doldurulur (`seedFromRules`).

**Kural dili ve güvenlik.** Kurallar G0'da tanımlanan dildir (`SegmentGroupSchema`, en fazla 3 seviye iç içe, 40 koşul). Her yazma ve önizlemede önce Zod ile ayrıştırılır, sonra `validateSegmentRules` ile işletmenin özel alan türlerine göre doğrulanır; henüz desteklenmeyen alanlar (`UNAVAILABLE_SEGMENT_FIELDS`, şu an boş) 400 ile reddedilir; `loyalty.pointsBalance` G3a ile etkinleşti ve kişinin üyeliğine ait önbellekli puan bakiyesini (hesap yoksa 0) işletmeye göre süzülen parametreli sorguyla okur. Derleyici (`SegmentEvaluatorService`) kuralları Prisma `where` filtresine çevirir:

- kişi sütunları (aşama, dil, ülke, sahip, şube, kaynak alanları), etiketler (`hasSome`/`hasEvery`), özel alanlar (JSON yol filtreleri);
- ilişki soruları ("son N günde katıldı mı", "kullanılabilir paketi var mı", "paket N gün içinde bitiyor", "kalan hak", "son ödeme", kaybetme riski seviyesi, ticari izin) `some`/`none` ilişki filtreleriyle;
- Prisma'nın ifade edemediği toplamlar (son 30 günde katılım, toplam katılım, gelmeme sayısı, toplam ödeme, doğum gününe kalan gün, özel tarih alanları) etiketli şablon (`$queryRaw`) sorgusuyla, parametreli olarak, yalnızca bu işletmenin kişi kimliklerini döndürür; karşılaştırma işleci sabit bir izin listesinden gelir, kuraldan hiçbir metin SQL'e girmez.

Her sorguya `studioId` (tenant guard'dan) ve "birleştirilmemiş" filtresi eklenir. Not: `consent.commercialAllowed` alanı "herhangi bir kanalda verilmiş bir izin kaydı var" demektir (kişi veya üye kaydı); kanal bazında en son kararın birleştirilmesi gönderim anında mesajlaşma motorunda yapılır, dolayısıyla segmentte görünen ama izni geri alınmış bir kişiye yine de gönderilmez.

**Uç noktalar** (`/studios/:studioId/segments`): `GET /` (liste), `GET /fields` (oluşturucu için alan kataloğu ve özel alanlar), `POST /preview` (sayı + 10 örnek kişi, kaydetmeden), `POST /`, `GET /:id`, `PATCH /:id`, `DELETE /:id` (arşivler; çalışan bir kampanya veya akış kullanıyorsa 409), `POST /:id/refresh`, `GET /:id/contacts`, `POST /:id/members` (yalnızca statik).

## 3. Kişi düzeyinde ticari izin

G1c'de ticari izin yalnızca kullanıcı hesabına (`CommunicationConsent`) bağlıydı; hesabı olmayan aday veya içe aktarılmış kişilere yasal olarak ticari mesaj gönderilemiyordu. G2a `ContactConsent` tablosunu ekler (kişi, kanal SMS/WhatsApp/e-posta, durum, kaynak, kanıt notu, zamanlar, İYS senkron zamanı).

- **Gönderim kontrolü**: `MessagingService` artık izni `ContactConsentService.isGranted()` ile sorar. Kişinin kendi kaydı ile üyenin kendi tercihi (hesabı varsa) birleştirilir, **en son verilen karar geçerlidir** (formda izin verip uygulamada geri alan, ya da tersi, son söylediğiyle değerlendirilir). Hiç kayıt yoksa izin yoktur. Push izni üyenin pazarlama bildirim tercihidir, uygulama içi mesaj izinden muaftır (değişmedi).
- **Kaydetme**: kişi kartında `PUT /crm/studios/:studioId/contacts/:contactId/consents` (`crm.manage`). İzin verirken kanıt notu zorunludur (ör. "danışmada imzalı form"). `GET .../consents` ve kişi detayı etkin durumu, kararı veren kaydı ve adresin bastırma listesinde olup olmadığını döndürür.
- **Geri alma**: abonelikten çıkma bağlantısı ve STOP anahtar kelimesi (`OptOutService`) artık kişi kaydını da geri alır.
- **İYS**: Türkiye'deki alıcılar için her değişiklik İYS adaptörüne gönderilir (hemen denenir, başarısızsa kalp atışında `syncPending` tekrar dener). Üyenin kendi kaydı zaten aynı kişiyi İYS'ye bildiriyorsa kişi kaydı ikinci kez gönderilmez. TR dışı alıcılarda ulusal sicil olmadığından kayıt "gönderilecek bir şey yok" olarak işaretlenir.

İşlemsel mesajlar (hatırlatma, onay, OTP) G1c'deki gibi izinden, sessiz saatten ve sıklık sınırından muaftır.

## 4. Kampanyalar

Bir kampanya, bir segmente bir mesaj şablonunun (G1c şablon anahtarı; kanal ve dile göre çözülür) tek seferlik gönderimidir. Kampanyalar **her zaman ticaridir**.

Durumlar: `DRAFT` -> `SCHEDULED` -> `SENDING` -> `SENT`, veya `CANCELLED`.

1. **Planlama** (`POST .../schedule`, zaman verilmezse hemen). Redis varsa gecikmeli bir BullMQ işi (`growth` kuyruğu, `campaign-batch`) eklenir; yoksa (yerel geliştirme, e2e) 15 dakikalık zamanlayıcı kalp atışı aynı işi yapar. Üretimde kalp atışı kaybolan işler için güvenlik ağıdır.
2. **Başlama**: tek bir işçi durumu `SCHEDULED -> SENDING` olarak değiştirir (koşullu güncelleme) ve segmentin o anki üyelerini `CampaignRecipient` tablosuna yazar (kampanya + kişi benzersiz).
3. **Gönderim**: 200'lük gruplar halinde. Her alıcı satırı önce kiralanır (`nextAttemptAt` ile), sonra `MessagingService.send()` `campaign:<kampanya>:<kişi>` tekilleştirme anahtarıyla çağrılır. Böylece tekrar eden bir iş veya ikinci bir işçi asla ikinci mesaj göndermez.
4. **Sonuçlar**: başarılı -> `SENT`; sessiz saat -> alıcının yerel sabahı 08:00'e ertelenir (en fazla 48 saat, sonra `SKIPPED`); izin yok, abonelikten çıkmış, sıklık sınırı, şablon yok vb. -> `SKIPPED` ve neden kodu; sağlayıcı hatası -> `FAILED`. Bekleyen alıcı kalmayınca kampanya `SENT` olur.

**İstatistikler** (`GET .../:id`): kitle, gönderilen, bekleyen, atlanan (nedenlere göre), hatalı; `NotificationLog.campaignId` üzerinden iletilen, açılan, tıklanan; `UNSUBSCRIBE` izleme olayları; **dönüşen**: mesajdan sonra işletmenin atıf penceresi (`Studio.attributionWindowDays`) içinde `trial_booked`, `purchase`, `subscription_started` veya `subscription_renewed` dönüşümü olan alıcılar (test kişileri hariç); **atfedilen gelir**: bu dönüşümlerin satış ve abonelik tutarları, para birimine göre.

**Test gönderimi** (`POST .../test-send`): şablonu isteyen personelin kendi üyeliğine gönderir, yine motordan geçer (izin ve sessiz saat uygulanır), kampanya istatistiklerine girmez; sonuç ve neden kodu döner.

Diğer uç noktalar: `GET/POST /studios/:studioId/campaigns`, `PATCH /:id` (yalnızca `DRAFT`/`SCHEDULED`), `DELETE /:id` (yalnızca `DRAFT`), `POST /:id/cancel`, `GET /:id/recipients`.

**A/B testi ve gönderim saati (M3c)**: kampanyaya isteğe bağlı A/B testi (test payı, ölçüt açılma/tıklama/dönüşüm oranı, bekleme, 2-5 varyant; varyant kendi şablonuyla ya da e-posta konu/ön başlık/metin ve SMS metin geçersiz kılmasıyla farklılaşır) ve gönderim saati modu (`FIXED`, `RECIPIENT_LOCAL`, `BEST_TIME`) eklendi. Test payı varyantlara eşit paylaştırılır, kalan kitle bekletilir ve bekleme sonunda kazanan varyantı alır; `POST /:id/pick-winner` ile elle seçilebilir. Atama `hash(kampanya:kişi)` ile deterministik ve tekildir. Sessiz saat, izin ve sıklık sınırı her varyantta ve her modda motordan geçmeye devam eder. Ayrıntılar ve sapmalar: `docs/PAZARLAMA_MODULU.md` (M3c notları).

## 5. Akışlar (journeys)

### 5.1 Tanım

Akış tanımı G0 sözleşmesidir (`JourneyDefinitionSchema`): tek tetikleyici, kimliğe göre adımlar, hedef (`goal`) ve tekrar giriş politikası. G2a eklemeleri:

- **Tetikleyiciler**: `booking_upcoming` (seanstan `leadMinutes` önce), `session_attended`, `first_session_attended`; `package_expiring` için `daysBefore` / `remainingUnitsAtMost`, `birthday` için `daysBefore` parametreleri.
- **Mesaj adımı**: `templateKey` (kanal ve dile göre çözülür, önerilen) veya `templateId`; kanal isteğe bağlı (verilmezse işletmenin kanal sırası); isteğe bağlı `category` (eski kuralların üyenin kendi bildirim tercihine uyması için).
- **Doğrulama** (`validateJourneyGraph`): başlangıç adımı, bağlantılar, döngü olmaması, ulaşılamayan adım olmaması, tetikleyici parametreleri, tek şablon referansı, görev ataması; ayrıca API segment koşullarını işletmenin özel alanlarına göre, tetikleyici segmentin, şablonun ve görev atananının bu işletmeye ait olduğunu doğrular.
- **Puan verme (`award_points`)**: G3a ile etkin. Puan (1-100000) ve puan hareketinde görünecek açıklama zorunludur. Adım sadakat defterine `journey:<kayıt>:<adım>` anahtarıyla yazar, bu yüzden yeniden denenen iş puanı iki kez vermez (adım `DONE`, tekrar `DUPLICATE`). Üyeliği olmayan kişide adım `SKIPPED` / `NO_MEMBERSHIP`, sadakat programı kapalıysa `SKIPPED` / `LOYALTY_DISABLED` olur ve akış bir sonraki adıma geçer. Ayrıntılar: `docs/SADAKAT.md`.

Durumlar: `DRAFT`, `ACTIVE`, `PAUSED`, `ARCHIVED`. Çalışan bir akışın adımları değiştirilemez (önce durdurulur); arşivleme devam eden kayıtları iptal eder.

### 5.2 Kayıt (enrollment)

Kişi bir akışa üç yoldan girer, hepsi `JourneyEngineService.enroll()` ile:

1. **Olaylar** (`GrowthEventsService`, CRM çekirdeğinde süreç içi dağıtıcı): `ConversionService` her yeni dönüşümde (`lead`, `trial_booked`, `trial_attended`, `purchase`, `subscription_*`, platform olayları), rezervasyon kancaları (`booking_created`, `booking_cancelled`, `no_show`, `session_attended`, ilk katılımda `first_session_attended`), personelin eklediği etiketler (`tag_added`; akışın kendi `update_contact` adımı olay üretmez, akışlar birbirini döngüye sokamaz) ve gelen mesajlar (`message_replied`, anahtar kelime olmayan cevaplar). Dağıtıcı hataları yutar; bir rezervasyon veya ödeme asla akış yüzünden başarısız olmaz.
2. **Segmente giriş**: dinamik segment yenilemesinde yeni girenler.
3. **Zaman tabanlı taramalar** (`JourneyScannersService`, kalp atışı): `booking_upcoming`, `package_expiring`, `package_expired`, `birthday`, `no_show`, `session_attended`, `first_session_attended`, `churn_risk_high`. Bunlar eski altı kural değerlendiricisinin yeniden yazımıdır (aynı iş soruları, ama göndermek yerine aday döndürürler). Geçmişe dönük taramalar en fazla 7 gün geriye bakar; yeni bir akış etkinleştirildiği andan itibaren olayları görür. Partner misafirleri hiçbir taramaya girmez. Her tarama en yeni adayları önce alır (`SCAN_LIMIT` = 500) ve akışın zaten kaydettiği adayları sorgunun içinde dışlar (`journey_enrollments` üzerinde `journeyId` + `triggerRef` için `NOT EXISTS` veya `id notIn`), böylece ilk 500 satır hep aynı eski adaylarla dolmaz. Aynı desen sadakat puanı süre sonu bildiriminde (`LoyaltyJobsService.notifyExpiring`) geçerlidir: bu vade için zaten bildirilmiş hesaplar sorguda elenir.

Tekilleştirme veritabanıyla güvenceye alınır: (akış, kişi, tetikleyici referansı) benzersizdir (ör. aynı rezervasyon için kanca ve tarama asla iki kayıt açmaz). Tekrar giriş politikası `lockKey` benzersiz indeksiyle uygulanır: `NEVER` -> "once" (sonsuza dek), `AFTER_EXIT` -> çalışırken "active" (bitince boşalır), `ALWAYS` -> kilit yok. Tetikleyici filtresi (`filter`) sağlanmayan veya hedefi zaten sağlayan kişi kaydedilmez.

### 5.3 Çalıştırma

Her kayıt küçük bir durum makinesidir (geçerli adım, adıma varış zamanı, sonraki çalışma zamanı). Redis varsa her adım gecikmeli bir BullMQ işidir (`journey-enrollment`, iş kimliği kayıt + zaman); yoksa kalp atışı zamanı gelen kayıtları (en fazla 200) işler. Bir işçi kaydı önce `lockedUntil` ile sahiplenir (eşzamanlı işçiler çakışmaz), her adımdan önce hedefi kontrol eder, bekleme gereken bir adıma kadar ilerler, sonra bırakır.

| Adım | Davranış |
|---|---|
| `wait` | `minutes`: adıma varıştan itibaren; başlangıç adımıysa olayın kendi zamanından (ör. ilk seanstan 24 saat sonra). `untilLocalTime`: kişinin (yoksa işletmenin) saat dilimine göre bir sonraki "SS:DD". |
| `send` | `MessagingService.send()`, tekilleştirme anahtarı `journey:<kayıt>:<adım>`, `journeyRunId` = kayıt. İzin, sessiz saat ve sıklık sınırı motorda uygulanır. Sessiz saatte kişinin yerel 08:00'ine ertelenir (48 saat sınırı); sıklık sınırı veya izin yoksa adım `SKIPPED` olur ve akış devam eder. |
| `branch` | Segment koşulu bu kişi için değerlendirilir, `ifTrue` / `ifFalse`. |
| `update_contact` | Etiket ekle/kaldır, özel alanları ayarla (tanımlı ve türü uyan alanlar). |
| `create_task` | Kişi sahibine, bir role (o roldeki ilk aktif personel) veya bir personele görev açar. Adım önce kaydedilir, tekrar eden iş ikinci görev açmaz. `titleKey` `journeys.task.*` ise işletmenin dilinde çevrilir, değilse işletmenin yazdığı metindir. |

Her çalışan adım `JourneyStepRun` tablosuna bir kez yazılır (kayıt + adım benzersiz). Beklenmedik bir hatada adım 15 dakika sonra tekrar denenir; 48 saati geçerse kayıt `FAILED` olur. Bitişler: `COMPLETED`, `EXITED_GOAL` (hedef sağlandı), `CANCELLED` (akış arşivlendi), `FAILED`.

**Uç noktalar** (`/studios/:studioId/journeys`): `GET /`, `GET /templates`, `POST /`, `POST /from-template`, `GET /:id` (istatistiklerle), `PATCH /:id`, `DELETE /:id` (yalnızca kişi girmemiş taslak), `POST /:id/activate`, `POST /:id/pause`, `POST /:id/archive`, `GET /:id/enrollments`.

### 5.4 Şablon galerisi

`journeyTemplates()` (shared): eski altı kural türü (seans hatırlatması, paket bitişi, geri kazanma, doğum günü, ilk seans sonrası takip, gelmeyene takip) ve yeni aday takibi (görev -> 2 gün bekle -> hâlâ adaysa ikinci görev; deneme veya üyelikte hedefe ulaşır). Şablondan oluşturulan akış taslaktır; geri kazanma şablonu işletmeye kendi dinamik kitle segmentini de oluşturur. Yeni işletmelerin seed'i bu şablonlardan akış oluşturur (yalnızca seans hatırlatması çalışır durumda, eski varsayılanla aynı).

## 6. Eski otomasyonların taşınması

Sahibin isteği doğrultusunda otomasyon modülü yamanmadı, yeniden yazıldı:

- Kalp atışı (`JobsService.runAll`) her adımı ayrı çalıştırır: bir adımın hatası kaydedilir ve hata yakalama servisine `job` kaynağıyla iletilir, sonraki adımlar çalışmaya devam eder; churn yeniden hesaplaması stüdyo başına izole edilir. Tekrarlanan iş `removeOnComplete`/`removeOnFail` ile Redis'i şişirmez.
- Kampanya başlatılırken alıcı kitlesi (`campaign_recipients`) durum `SENDING` olmadan önce yazılır; çökme halinde kampanya `SCHEDULED` kalır ve sonraki çalıştırmada kitle yeniden (kopyasız) yazılır, böylece alıcısız `SENT` kampanya oluşmaz.
- Altı değerlendirici ve çalıştırıcı silindi; iş soruları akış tarayıcılarına, gönderim akış motoruna taşındı.
- Her kural türü bir akış şablonudur (`legacyRuleToJourney`): aynı şablon anahtarı, aynı kanal seçimi, aynı amaç (işlemsel/ticari) ve aynı üye bildirim kategorisi. `WIN_BACK` bir dinamik segmente (`winBackSegmentRules`: aktif/süresi dolmuş aşama, N gündür katılım yok veya hiç yok, isteğe bağlı kullanılabilir paket yok) ve `segment_entered` tetikleyicisine dönüşür.
- **Veri taşıma** (`LegacyAutomationMigratorService`, zamanlayıcı kalp atışında ve eski uç noktalar yanıt vermeden önce çalışır): `migrated_journey_id` boş her kural için tek bir işlemde kural sahiplenilir, akış (ve gerekiyorsa segment) oluşturulur, kurala bağlanır ve kural pasife alınır. Akış, kural aktifse `ACTIVE`, değilse `PAUSED` olur.
- **Çift gönderim yok**: eski çalıştırıcı artık yok, dolayısıyla taşımadan sonra yalnızca akış gönderir. Akış, taşınan kuralın `automation_runs` kaydını kişiyi kaydetmeden önce kontrol eder (aynı hedef referansıyla: rezervasyon, paket, `<üye profili>:<yıl>`, geri kazanmada `<üye profili>:<ISO hafta>`); eski çalıştırıcının zaten gönderdiği bir hatırlatma tekrar gönderilmez. Dağıtım sırasında eski konteyner hâlâ çalışıyorsa da aynı kontrol geçerlidir.
- **Davranış farkları** (bilinçli): geri kazanma artık kişi segmente girdiğinde bir kez gönderilir, segmentten çıkıp yeniden girene kadar tekrarlanmaz (eskiden koşul sürdükçe haftada bir); gelmeme takibinin beklemesi seans başlangıcından sayılır (eskisiyle aynı); partner misafirleri seans hatırlatmasından da çıkarıldı (pazarlama dışı tutma kararıyla tutarlı).
- **`/studios/:studioId/automation-rules`** (kullanımdan kaldırıldı): yollar, yanıt biçimleri ve `notifications.manage` izni değişmedi (mobil "Otomatik mesajlar" ekranı çalışmaya devam eder). Liste, akışları eski kural biçiminde döndürür (kimlik = akış kimliği; eski kural kimliği de kabul edilir), oluşturma/güncelleme akış yazar, aç/kapat akışı başlatır/durdurur, istatistik ve geçmiş akış adım kayıtlarından gelir. Sözleşme (daraltma) sürümünde `automation_rules`/`automation_runs` tablolarıyla birlikte kaldırılacaktır.

## 7. Web ekranları

- **Kişiler** (`/kisiler`, `crm.view`): arama (300 ms bekleme), yaşam döngüsü, satış hattı aşaması ve etiket filtreleri, sayfalı tablo.
- **Kişi kartı** (`/kisiler/[id]`): bilgiler, etiket ekle/kaldır, özel alanlar (işletmenin dilindeki etiketiyle), ticari izin (kanal başına durum, kararı veren kayıt, bastırma, kanıtla izin verme / geri alma), görevler (ekle, tamamla), etkinlik geçmişi (not ekle), atıf özeti (ilk/son temas, temas noktaları, dönüşümler).
- **Satış hattı panosu** (`/kisiler/satis-hatti`): aşama sütunları, sürükle-bırak ve klavyeyle erişilebilir "aşamaya taşı" seçimi, iyimser güncelleme.
- **Segmentler** (`/segmentler`, `/segmentler/yeni`, `/segmentler/[id]`): iç içe VE/VEYA oluşturucu (alan türüne göre işlem ve değer alanı, özel alanlar dahil), 400 ms beklemeli canlı önizleme (sayı ve örnek kişiler), statik segment üye listesi.
- **Kampanyalar** (`/kampanyalar`, `/kampanyalar/yeni`, `/kampanyalar/[id]`): taslak, kanal ve şablon seçimi, hemen veya ileri tarihli planlama, kendine test gönderimi, iptal, sonuçlar ve alıcılar.
- **Akışlar** (`/akislar`, `/akislar/sablonlar`, `/akislar/yeni`, `/akislar/[id]`): liste, şablon galerisi, dikey adım düzenleyici (dallar "koşul doğruysa / yanlışsa" seçimleriyle), hedef ve tekrar giriş, başlat/durdur/arşivle, istatistikler ve akıştaki kişiler.

Tüm metinler `crm`, `segments`, `campaigns`, `journeys` ve `nav` i18n ad alanlarındadır (tr + en).

## 8. Nasıl test edilir

- Birim: `packages/shared/src/growth/engagement.spec.ts` (şablonlar, eski kural gidiş-dönüşü, yeni doğrulamalar, `nextLocalTime`), `apps/api/src/modules/growth/segments/segment-evaluator.service.spec.ts` (derleyici çıktısı, parametreli toplamlar, izin birleştirme).
- API e2e: `apps/api/test/e2e/growth.e2e-spec.ts` (segment önizleme ve kiracı izolasyonu, kişi izni ve STOP ile geri alma, kampanya tekilleştirmesi + izin + sıklık sınırı, akış kaydı/bekleme/dal/hedef çıkışı/tekrar giriş, izinler), `automations.e2e-spec.ts` (sarmalayıcı ve eski kuralın çift gönderimsiz taşınması), `partner-guest-filter.e2e-spec.ts`.
- Tarayıcı e2e: `apps/web/e2e/crm-contacts.e2e.ts`, `apps/web/e2e/segments-campaigns.e2e.ts`.

## 9. Sahibin karar vermesi gerekenler

- Resepsiyona pazarlama izinlerinin (`segments.*`, `campaigns.*`, `journeys.*`) varsayılan olarak verilip verilmeyeceği (şimdilik yalnızca sahip).
- Geri kazanma akışının eski "koşul sürdükçe haftalık tekrar" davranışına dönmesi istenirse `ALWAYS` tekrar girişli, haftalık referanslı bir tarama tetikleyicisi eklenebilir.
- Kampanyada A/B testi ve alıcının yerel saatine göre gönderim: M3c ile yapıldı (yukarıdaki bölüm 4).
