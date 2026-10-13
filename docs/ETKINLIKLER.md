# Etkinlikler, atölyeler ve kurslar (G3c-1)

Bağlayıcı tasarım: `docs/BUYUME_VE_GLOBAL_MIMARI.md` bölüm 6, G3c satırı ("atölye/kurs/etkinlik"). Bu belge uygulanan modeli, kuralları, uç noktaları ve sahip kararlarını anlatır.

## Özet

- Sektörden bağımsızdır: bir hafta sonu inzivası, dört haftalık seramik atölyesi, sekiz derslik yüzme kursu, padel turnuvası veya bir dil kursu dönemi aynı modelle kurulur. Başlıklar, bilet adları ve fiyatlar **kiracı verisidir** (CLAUDE.md kural 7).
- Bir **etkinlik** bir veya daha fazla **oturumdan** (tarih + saat, isteğe bağlı kaynak ve eğitmen), bir veya daha fazla **bilet türünden** ve **kayıtlardan** oluşur. Çok oturumlu (SERIES) etkinlikte tek kayıt tüm oturumları kapsar.
- Kontenjan atomik olarak korunur; eşzamanlı kayıtlar hiçbir zaman fazla satış yapmaz. Kontenjan dolunca istenirse bekleme listesi açılır ve boşalan yer sıradaki kişiye otomatik verilir.
- Ödeme mevcut ödeme modülünden geçer: her tutar para birimiyle saklanır ve işletmenin para birimi dışında bilet fiyatı kabul edilmez (kural 8).
- Tüm tablolarda `studio_id` vardır; her sorgu işletmeye göre süzülür, şubeye kısıtlı personel yalnızca kendi şubelerinin etkinliklerinde işlem yapar.

## Tasarım kararı: oturumlar neden `SessionSchedule` değil

Oturumlar ayrı bir `event_occurrences` tablosunda tutulur, mevcut `SessionSchedule` satırları kullanılmaz. Gerekçe:

1. `SessionSchedule` bir `serviceTypeId` ister ve kapasitesi, `bookedCount` sayacı, bekleme listesi ve iptal politikası **oturum başınadır**. Etkinlikte ise kapasite, bilet ve kayıt **etkinlik başınadır**; sekiz derslik bir kursa tek kayıt yapılır. Etkinlik oturumlarını seans olarak açmak, her oturumda ayrı sayaç ve ayrı rezervasyon demek olurdu ve kurs kontenjanı ile oturum kontenjanı birbirinden kopardı.
2. Seans takvimi, üye rezervasyonu, QR/kiosk check-in, partner (ClassPass vb.) yer ayırma ve paket hakkı düşümü `SessionSchedule`/`Booking` üzerinden çalışır. Etkinlik oturumları orada görünseydi bu akışların hepsi etkinliği sıradan bir seans sanıp rezervasyona açardı.
3. Buna karşın çakışma kontrolü paylaşılır: bir oturum eklenirken seçilen eğitmen veya kaynak aynı saatte iptal edilmemiş bir seansta ya da başka bir canlı etkinlik oturumunda doluysa 409 `EVENT_OCCURRENCE_CONFLICT` döner.

Etkinliğin ilk oturum başlangıcı ve son oturum bitişi (`starts_at`, `ends_at`) listeleme, iade penceresi ve tamamlanma için etkinlik satırına da yazılır; oturumlar değişince güncellenir.

## Veri modeli

Tek migration: `20261006000000_events` (yalnızca ekleme; mevcut kolonlara dokunmaz).

| Tablo | Amaç |
|---|---|
| `events` | Başlık, açıklama, şube (isteğe bağlı), tür (`SINGLE`/`SERIES`), durum (`DRAFT`/`PUBLISHED`/`CANCELLED`/`COMPLETED`), kontenjan ve dolu yer sayacı (`seats_taken`), bekleme listesi, görünürlük (`PUBLIC`/`MEMBERS_ONLY`), kapak görseli bağlantısı, kayıt başlangıç/bitiş, tam iade süresi (`full_refund_hours_before`), yayın/iptal/tamamlanma zamanları. |
| `event_occurrences` | Oturum: başlangıç, bitiş, kaynak, eğitmen, hatırlatma gönderim zamanı (`reminder_sent_at`). |
| `event_ticket_types` | Bilet türü: ad, fiyat (`price_amount` + `currency`, 0 = ücretsiz), adet sınırı ve satılan (`quantity_limit`, `sold_count`), satış penceresi, yalnızca üyeler, bir kişinin birden fazla kaydı (`allow_multiple`), paket hakkıyla ödeme (`credit_service_type_id` + `credit_units`), satışta mı, sıra. |
| `event_registrations` | Kayıt: üye (`member_id`) veya CRM kişisi (`contact_id`, web sayfasından gelen misafir), bilet, durum (`PENDING_PAYMENT`/`CONFIRMED`/`WAITLIST`/`CANCELLED`/`ATTENDED`/`NO_SHOW`), kaynak (`STAFF`/`MEMBER`/`PUBLIC`), bekleme sırası, ödenecek/ödenen/iade tutarı + para birimi, ödeme satırı (`payment_id`), ödeme yöntemi, ödeme bağlantısı ve son ödeme zamanı, kullanılan paket ve hak sayısı, giriş (check-in) zamanı, iptal bilgisi. |

Tür, durum ve görünürlük değerleri `packages/shared/src/events.ts` içindeki listelerdir (tek doğruluk kaynağı); veritabanında CHECK kısıtları vardır. Ayrıca `seats_taken` 0 ile kontenjan arasında, `sold_count` 0 ile adet sınırı arasında kalır, fiyat negatif olamaz, oturum bitişi başlangıçtan sonradır ve her kayıt bir üyeye veya bir kişiye bağlıdır.

## Kontenjan ve bekleme listesi

- Kayıt tek bir işlemde yapılır: önce `UPDATE events SET seats_taken = seats_taken + 1 WHERE ... status = 'PUBLISHED' AND seats_taken < capacity`, sonra aynı koşullu güncelleme bilet adedi için (`sold_count < quantity_limit`), en son kayıt satırı. Etkinlik satırı üzerindeki satır kilidi eşzamanlı kayıtları sıraya koyar; e2e testi sekiz eşzamanlı kaydın üç kişilik etkinlikte tam üçünü onayladığını doğrular.
- Yer yoksa ve bekleme listesi açıksa kayıt `WAITLIST` olur; etkinlik satırı kilitlenerek sıra numarası verilir (eşzamanlı katılımlar farklı ve sıralı numara alır). Bekleme listesi kapalıysa 409 `EVENT_FULL`.
- **Tekillik:** bir kişinin bir etkinlikte tek canlı kaydı olur (`(event_id, dedupe_key)` benzersiz; anahtar `m:<üye>` veya `c:<kişi>`). Aynı istek tekrarlanırsa ilk kayıt `duplicate: true` ile döner. İptal edilen kaydın anahtarı silinir, kişi yeniden kayıt olabilir. `allow_multiple` biletlerde anahtar yoktur.
- **Otomatik doldurma** (seans bekleme listesiyle aynı davranış): bir yer boşaldığında (kayıt iptali, kontenjan artışı, süresi dolan ödeme bekletmesi) listenin başındaki kayıt koşullu güncellemeyle `WAITLIST` durumundan çıkarılır, istek başına en fazla 20 deneme. Ücretsiz bilet hemen `CONFIRMED`; paket hakkıyla katılan kişinin paketinden hak düşülür, paket artık ödeyemiyorsa kayıt nedeniyle (`EVENT_NO_CREDITS`) iptal edilir ve sıradaki denenir; ücretli bilet `PENDING_PAYMENT` olur ve 48 saat (en geç etkinlik başlangıcı) içinde ödenmelidir. Bilgilendirme: `EVENT_WAITLIST_PROMOTED` veya `EVENT_PAYMENT_DUE`.

## Ödeme

- **Masada (personel):** kayıt sırasında veya sonra "Ödemeyi al" ile nakit, POS veya havale kaydedilir. Üye için de misafir için de mevcut `payments` tablosuna `COMPLETED` bir `Payment` yazılır (bilet para birimi, etkinliğin şubesi, `metadata.eventId`); misafirin ödemesinde `member_id` boştur ve `contact_id` kaydın kişisidir. Kaydın `payment_id`, `amount_paid` ve `payment_method` alanları aynı işlemde yazılır. Ardından ödeme modülünün tamamlanma işleri çalışır (otomatik fatura, `payment.completed` webhook'u, CRM `purchase` dönüşümü; sadakat satın alma puanı yalnızca üyeye).
- **Çevrimiçi (üye):** mevcut ödeme sağlayıcı adaptör kaydı (`PaymentProviderRegistry.default`, paket satın almayla aynı) üzerinden checkout başlatılır. MOCK hemen tamamlar; gerçek sağlayıcı bir ödeme bağlantısı döndürür, kayıt `PENDING_PAYMENT` olur ve yer 30 dakika tutulur. Sağlayıcının mevcut webhook'u ödemeyi tamamladığında kayıt `CONFIRMED` olur (`EventSeatsService.onPaymentCompleted`, `PaymentsService.handleWebhook` içinden). Üye bekleyen bir kaydı uygulamadan "Ödemeyi tamamla" ile yeniden ödeyebilir.
- **Paket hakkıyla:** bilet `credit_service_type_id` + `credit_units` taşıyorsa, üye o hizmeti kapsayan etkin paketinden hak düşürerek kayıt olabilir (seans rezervasyonundaki koşullu düşümle aynı; sınırsız paket 0 hak öder). Paket seçilmezse bitişi en yakın uygun paket kullanılır.
- **Misafir (web sayfası):** ücretsiz bilet hemen onaylanır. Ücretli bilette yer 48 saat (en geç başlangıç) `PENDING_PAYMENT` olarak tutulur ve masada ödenir. Masada alınan ödeme, migration `20261009000000_guest_payments` ile `member_id` boş, `contact_id` misafirin CRM kişisi olan bir `Payment` olarak yazılır; böylece finans ödeme listesinde, gelir raporunda ve muhasebe dışa aktarımında görünür (`docs/MUHASEBE.md`). Bu sürümden önce alınmış misafir ödemelerinin `Payment` satırı yoktur; geriye dönük kayıt üretilmedi (sahip kararı, aşağıda).
- **Süresi dolan bekletme:** zamanlayıcı kalp atışı, son ödeme zamanı geçmiş `PENDING_PAYMENT` kayıtlarını iptal eder (`PAYMENT_EXPIRED`), yeri ve bileti geri verir ve bekleme listesini doldurur.

## İptal ve iade politikası

- Etkinlik başına tek kural: başlangıçtan **`full_refund_hours_before` saat öncesine kadar tam iade, sonrasında iade yok** (`evaluateEventRefund`, paylaşılan paket; birim testli). Başlangıcı olmayan etkinlik her zaman iade edilebilir.
- Üye kendi kaydını iptal eder; personel iptal ederken "süre geçmiş olsa da tam iade" seçebilir. Bekleme listesindeki kaydın ödemesi yoktur.
- Tam iade: üye ve misafir ödemeleri mevcut `PaymentsService.refundPayment` ile iade edilir (sağlayıcı iadesi, hediye kartı payı, tam iadede fatura iptali, denetim kaydı, `payment.refunded` webhook'u, muhasebe dışa aktarımında negatif satır); kaydın `refunded_amount` alanı ödemenin iade tutarıyla eşitlenir (finans ekranından yapılan iade dahil). Kullanılan paket hakları pakete geri döner. Yalnızca bu sürümden önce ödenmiş ve `Payment` satırı olmayan eski misafir kayıtlarında iade eskisi gibi kayıtta işaretlenir (parayı resepsiyon geri verir).
- **Etkinlik iptali (işletme):** durum önce işlem içinde `CANCELLED` yapılır (yeni kayıtlar `PUBLISHED` şartına takılır), tüm canlı kayıtlar iptal edilir, haklar iade edilir, sonra ödemeler tam iade edilir ve (istenirse) herkese `EVENT_CANCELLED` gönderilir. Yanıt iptal edilen kayıt, iade edilen ödeme, başarısız iade ve bildirim sayılarını verir.

## Bildirimler

Tümü mesajlaşma motorundan (`MessagingService.send`) ve yerleşik şablonlarla (`msgTpl` ad alanı, tr + en; işletme özelleştirebilir) gider. Hepsi **TRANSACTIONAL**'dır: kişinin kendi kaydıyla ilgilidir, teklif içermez; sessiz saat ve kanal sırası motor tarafından uygulanır. Her gönderimin tekilleştirme anahtarı vardır.

| Şablon | Ne zaman | Anahtar |
|---|---|---|
| `EVENT_REGISTRATION_CONFIRMED` | Kayıt onaylandığında (ücretsiz, masada ödeme, çevrimiçi ödeme tamamlanınca) | `event-confirmed:<kayıt>` |
| `EVENT_PAYMENT_DUE` | Yer ayrıldı, ödeme bekleniyor (misafir, masada ödeme, bekleme listesinden yükselen ücretli kayıt) | `event-payment-due:<kayıt>` |
| `EVENT_WAITLIST_PROMOTED` | Bekleme listesinden onaylandığında | `event-promoted:<kayıt>` |
| `EVENT_REMINDER` | Her oturumdan 24 saat önce, onaylı kayıtlara (kalp atışı) | `event-reminder:<oturum>:<kayıt>` |
| `EVENT_CANCELLED` | İşletme etkinliği iptal ettiğinde | `event-cancelled:<kayıt>` |

Hatırlatma her oturum için bir kez gönderilir: kayıtlara gönderim bittikten sonra oturum `reminder_sent_at` ile işaretlenir. Döngü ortasında bir çökme oturumu işaretsiz bırakır ve sonraki kalp atışı kalan kayıtlarla devam eder; kayıt başına idempotency anahtarı (`event-reminder:<oturum>:<kayıt>`) kimseye ikinci mesaj gitmesini engeller.

## Zamanlayıcı kalp atışı

`EventsJobsService.run()` mevcut `JobsService.runAll()` içinde (15 dakikada bir; Redis yoksa yönetici tetikleyicisi veya testler): süresi dolan ödeme bekletmelerini bırakır ve bekleme listesini doldurur, hatırlatmaları gönderir, bitişi geçmiş `PUBLISHED` etkinlikleri `COMPLETED` yapar. Ayrı bir kuyruk yoktur (6 GB RAM kısıtı).

## CRM, sadakat

- **Misafir kaydı** mevcut `ContactsService.resolveOrCreate` ile kişiyi telefon, sonra e-posta ile bulur veya oluşturur (`WEB_FORM`, kaynak ayrıntısı etkinlik başlığı), ziyaretçinin temas noktalarını bağlar (`X-PW-VID` başlığı veya `pw_vid` çerezi) ve kişi aday (`LEAD`) aşamasındaysa mevcut `lead` dönüşümünü yazar (kişi başına tekil, form uç noktasıyla aynı kaynak anahtarı; üye olan kişi için yazılmaz).
- **Sadakat:** check-in, `LoyaltyEarnService.onEventAttendance` ile ATTENDANCE kurallarından puan verir (kaynak `event_registration` / kayıt kimliği, tekil). Hizmet türüne daraltılmış kural etkinlikte geçerli olmaz, çünkü etkinliğin hizmet türü yoktur. Kazanma mantığı çoğaltılmadı: aynı kural ve defter yardımcıları kullanılır.

## İzinler

| Anahtar | Kapsam | Varsayılan |
|---|---|---|
| `events.view` | Etkinlik listesi ve ayrıntısı, kayıt listesi, CSV dışa aktarma | Sahip, resepsiyon |
| `events.manage` | Oluşturma, düzenleme, oturumlar, biletler, yayınlama, iptal, personel kaydı, ödeme alma, kayıt iptali | Sahip |
| `events.checkin` | Giriş (check-in) ve gelmedi işaretleme | Sahip, resepsiyon |

Migration üç anahtarı sahip rollerine, `events.view` ve `events.checkin` anahtarlarını `reception` anahtarlı rollere ekler. Üye uç noktaları self-servistir ve yalnızca çağıranın kendi üye profiline bakar.

## API

Personel ve üye uç noktalarının tümü `@StudioScoped()`; işletme her zaman kiracı korumasından gelir.

| Uç nokta | İzin |
|---|---|
| `GET /studios/:studioId/events?status&from&to` | view |
| `POST /studios/:studioId/events` | manage |
| `GET /studios/:studioId/events/:eventId` | view |
| `PATCH /studios/:studioId/events/:eventId` (kontenjan dolu yerin altına inemez) | manage |
| `PUT /studios/:studioId/events/:eventId/occurrences` (tüm oturumları değiştirir) | manage |
| `POST /studios/:studioId/events/:eventId/publish` | manage |
| `POST /studios/:studioId/events/:eventId/cancel` (`reason`, `notify`) | manage |
| `POST .../events/:eventId/tickets`, `PATCH/DELETE .../tickets/:ticketId` (kaydı olan bilet silinmez, satışı durdurulur) | manage |
| `GET /studios/:studioId/events/:eventId/registrations?status` | view |
| `POST /studios/:studioId/events/:eventId/registrations` (üye veya kişi, isteğe bağlı masada ödeme veya paket) | manage |
| `GET /studios/:studioId/events/:eventId/registrations/export.csv?locale` | view |
| `POST /studios/:studioId/events/registrations/:registrationId/payment` | manage |
| `POST /studios/:studioId/events/registrations/:registrationId/cancel` (`fullRefund`) | manage |
| `POST /studios/:studioId/events/registrations/:registrationId/check-in` | checkin |
| `POST /studios/:studioId/events/registrations/:registrationId/no-show` | checkin |
| `GET /studios/:studioId/events/self`, `GET .../self/:eventId`, `GET .../self/registrations` | self-servis |
| `POST /studios/:studioId/events/self/:eventId/register` (`ticketTypeId`, `memberPackageId` veya `useCredits`) | self-servis |
| `POST /studios/:studioId/events/self/registrations/:registrationId/cancel`, `.../pay` | self-servis |
| `GET /public/studios/:slug/events`, `GET /public/studios/:slug/events/:eventId` | herkese açık (yanıt `timezone` ve `location` alanlarını da taşır: şubenin dilimi/adresi, yoksa işletmeninki) |
| `POST /public/studios/:slug/events/:eventId/registrations` | herkese açık |

Herkese açık uç noktalar yalnızca `PUBLIC` ve `PUBLISHED`, bitmemiş etkinlikleri döndürür; kayıt sayısı veya kayıtlı kişiler hakkında bilgi vermez (yalnızca kalan yer). IP başına sabit pencereli hız sınırı vardır (okuma dakikada 60, yazma dakikada 5; Redis varsa Redis, yoksa bellek içi, açık bırakmaz). Misafir formundaki gizli tuzak alanı (`website`) doluysa hiçbir şey kaydedilmez. Hatalar gövdede kararlı bir `code` taşır (`EVENT_ERROR_CODES`); istemciler `events.error.<code>` / `mEvents.error.<code>` anahtarıyla çevirir. CSV noktalı virgülle ayrılır, formül önekleri etkisizleştirilir, başlıklar istenen veya işletmenin dilindedir; telefon yalnızca `members.contact.view` izniyle yazılır.

## Arayüz

- Web `/etkinlikler`: durum filtresi, liste (tarih, durum, dolu yer, bekleme listesi); `/etkinlikler/yeni`; `/etkinlikler/[id]` sekmeleri: Genel (düzenleme, yayınlama, iptal), Oturumlar, Biletler (ekleme, satışı durdurma, silme), Kayıtlar (giriş, gelmedi, ödemeyi alma, iptal, CSV). Menü girişi `events.view` ile görünür (`lib/nav.ts`).
- Web herkese açık sayfalar (S2a): `/events/<işletme-slug>` liste ve `/events/<işletme-slug>/<başlık-slug>-<id>` ayrıntı (`apps/web/src/app/(app)/(public)/events`), sunucuda render edilir, işletme markasıyla (herkese açık yapılandırma) çizilir, `Event` JSON-LD taşır ve işletme `sitemap.xml` dosyasında listelenir (`docs/SEO.md`). Tarihler etkinliğin saat diliminde yazılır. Sayfada kayıt formu yoktur: üyeler mobil uygulamadan, misafirler işletmeyle iletişime geçerek kaydolur. Metinler `events.public.*` anahtarlarındadır.
- Mobil üye: "Hesabım > Etkinlikler" (kayıtlarım ve yaklaşan etkinlikler), etkinlik ayrıntısı (oturumlar, biletler, kayıt, paket hakkıyla kayıt, bekleme listesi, ödeme, iade süresini gösteren iptal onayı).
- Mobil personel: "Hesabım > Etkinlik girişi" (`events.checkin` + `events.view`): yayındaki etkinliği seçip tek dokunuşla giriş.
- Tüm metinler `events` ve `mEvents` ad alanlarında (tr + en).

## Demo verisi

Seed, Zen işletmesinde iki etkinlik açar: herkese açık, bekleme listeli, tek oturumlu "Hafta sonu atölyesi" (standart bilet ve paket hakkıyla ödenebilen üyelere özel bilet, iki üye masada ödeyerek kayıtlı) ve yalnızca üyelere açık, dört oturumlu "Başlangıç kursu (4 hafta)".

## Sahip kararları

1. **Misafirin masada ödemesi artık `payments` tablosuna yazılıyor** (karar verildi): `payments.member_id` boş olabilir, `payments.contact_id` misafirin kişisidir (yalnızca genişletme; daraltma adımı gerekmez). Açık karar: bu sürümden önceki misafir ödemeleri için geriye dönük `Payment` üretilsin mi? Migration saf şemadır; istenirse ayrı, tekrar çalıştırılabilir bir yönetici betiği yazılır (`docs/MUHASEBE.md`, "Sahip kararları").
2. **Web sayfasından gelen kayıt her zaman kişi (CRM) kaydıdır.** Üye olan biri web sayfasından kayıt olursa üyelik yerine kişi üzerinden kaydolur ve mobil uygulamada "Kayıtlarım"da görünmez. Telefonla üyeliğe otomatik bağlamak, telefonu bilen herkesin başkası adına üye kaydı yapmasına yol açacağı için bilerek yapılmadı.
3. **Katılım kayıt düzeyinde.** Çok oturumlu kursta her oturum için ayrı yoklama tutulmuyor; ilk giriş kaydı `ATTENDED` yapar. Oturum başına yoklama istenirse ayrı bir tablo gerekir.
4. **Hatırlatma her oturum için** (24 saat önce) gönderiliyor. Sekiz derslik kursta sekiz hatırlatma demektir; yalnızca ilk oturum istenirse değiştirilebilir.
5. **Süresi dolan çevrimiçi ödeme:** bekletme süresi (30 dakika) dolduktan sonra sağlayıcı ödemeyi yine de tamamlarsa kayıt yeniden açılmaz, ödeme `COMPLETED` kalır ve personelin iade etmesi gerekir (API loguna uyarı yazılır).

## Kalan

- Herkese açık etkinlik sayfasında misafir kayıt formu (S2a yalnızca liste ve ayrıntıyı ekledi) ve sayfa motorunda "etkinlikler" bloğu. API uç noktaları hazır; site motoru sayfaları `[[...slug]]` yakalayıcısıyla ve blok şemalarıyla render ettiği için ayrı bir "etkinlikler" bloğu tasarlanmalı.
- Misafir için çevrimiçi ödeme (sağlayıcı checkout'u üye profili istiyor).
- Oturum başına yoklama ve çok oturumlu kursta kısmi iade.
- Web'de personelin üye/kişi arayıp kayıt eklemesi (API hazır: `POST .../registrations`).
- Etkinlik raporu (doluluk, gelir, katılım) ve takvim görünümünde etkinlik oturumları.
- Playwright senaryosu (`apps/web/e2e/events.e2e.ts`) bu ortamda koşturulamadı.
