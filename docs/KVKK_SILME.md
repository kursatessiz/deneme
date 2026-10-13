# KVKK/GDPR: kişisel verilerin silinmesi (anonimleştirme)

Bu doküman, bir üyenin bir işletmedeki kişisel verilerinin silinmesi talebini (KVKK madde 7 ve 11, GDPR madde 17) tanımlar: akış, izin, kapsam, hangi tablonun nasıl anonimleştirildiği, bilerek korunan kayıtlar ve testler.

## 1. Sahip kararları

- **Anonimleştir, mali kayıtları koru.** Kişisel veri silinir veya anonimleştirilir; `Payment`, fatura, rezervasyon, satış, etkinlik kaydı ve muhasebe satırları yasal saklama gereği kalır ama kişiyi artık tanımlamaz.
- **Akış.** Üye mobilde ister (Hesabım > Gizlilik > "Verilerimin silinmesini talep et"); işletme sahibi veya `members.erase` izni olan personel web panelinde onaylar ya da reddeder (üye kartı ve bekleyen talepler listesi). Onaylanan talepler zamanlayıcı kalp atışının (`apps/api/src/modules/jobs`, `erasure` adımı) işleyeceği kuyruğa girer; 30 gün içinde işlem görmeyen talep otomatik işlenir. İşletme, üye kartından da doğrudan başlatabilir (onay penceresi, `useConfirm`).
- **Kapsam stüdyo başınadır.** Kullanıcılar global ve telefonla tanımlıdır, başka işletmelerin de üyesi olabilir. Silme yalnızca o işletmedeki üyeliği etkiler.

## 2. İzin

`members.erase` (alan: Üyeler). Sahip her izne sahiptir; bir rol şablonuna ayrıca eklenebilir. Varsayılan resepsiyon ve eğitmen rollerinde yoktur. Migration `20261104000100_data_erasure`, mevcut sahip rollerine satırı ekler.

| Uç nokta | İzin |
|---|---|
| `GET /studios/:studioId/erasure-requests?status=` (varsayılan: açık talepler) | `members.erase` |
| `POST /studios/:studioId/erasure-requests/:id/approve` | `members.erase` |
| `POST /studios/:studioId/erasure-requests/:id/reject` | `members.erase` |
| `GET /studios/:studioId/members/:memberId/erasure` (üye kartı durumu) | `members.erase` |
| `POST /studios/:studioId/members/:memberId/erasure` (doğrudan başlat, hemen çalıştırır) | `members.erase` |
| `GET /me/erasure`, `POST /me/erasure` | `@SelfService()` (yalnızca üye profili olan kendi üyeliği) |

Yazma uçları `@AllowWhenRestricted()` işaretlidir: kısıtlı faturalama modunda da çalışır (`docs/DENEME_VE_ETKINLESTIRME.md`). `memberId` üye profili kimliğidir (üye kartı rota parametresi). Şube kısıtlı personel yalnızca kendi şubesindeki (veya şubesiz) üyelerin taleplerini görür ve karara bağlar.

## 3. Talep yaşam döngüsü

`data_erasure_requests.status`: `PENDING` (üye istedi, personel bekliyor), `APPROVED` (kuyrukta, kalp atışı işler), `REJECTED`, `COMPLETED`. Bir üyelik için aynı anda tek açık (PENDING veya APPROVED) talep olabilir (SQL'de kısmi benzersiz index; ikinci istek 409 `apiErrors.erasure.alreadyOpen`). Reddedilmiş talepten sonra üye yeniden isteyebilir.

- `dueAt = requestedAt + 30 gün` (`ERASURE_AUTO_PROCESS_DAYS`). Süresi dolan PENDING talep kalp atışında otomatik işlenir (`auto_processed = true`, denetim kaydında `auto: true`).
- İşleme başarısız olursa `attempts` artar, `last_error` yazılır; en fazla 5 denemeden sonra talep APPROVED kalır ve listede görünür (`ERASURE_MAX_ATTEMPTS`). Anonimleştirici idempotenttir; yarım kalmış bir çalıştırma güvenle tekrarlanır.
- Doğrudan başlatma, APPROVED bir talep oluşturur (veya açık olanı devralır) ve hemen çalıştırır; başarısız olursa kalp atışı sürdürür.
- Denetim kayıtları (`audit_logs`): `erasure.requested`, `erasure.approved`, `erasure.rejected`, `erasure.executed`. `entity_id` talep kimliğidir (yürütme kaydında üyelik kimliği); metaveri kişisel veri içermez.
- Üyeye bildirim: onay ve ret kararı mesajlaşma motorundan TRANSACTIONAL gider (`ERASURE_REQUEST_APPROVED`, `ERASURE_REQUEST_REJECTED`; kanal sırası kiracı ayarı). Kararın bildirimi en iyi çabadır; başarısızlığı kararı engellemez. İşlem tamamlandığında ayrıca bildirim gönderilmez: o anda üyenin iletişim bilgileri silinmiş olur.

## 4. Kimler silinemez

Yalnızca düz üyeler silinir. İşletme sahibi, izni olan (personel) roller, eğitmen profili olanlar (hakediş ve komisyon satırları onlara bağlıdır), süper admin ve platform üyeliği olan hesaplar, ve üye profili olmayan üyelikler 400 `apiErrors.erasure.staffNotErasable` ile reddedilir. Zaten silinmiş üyelik 409 `alreadyErased` döner.

## 5. Kimlik: global kullanıcı nasıl ele alınır

`Membership` ve `MemberProfile` satırları silinmez (ödeme ve rezervasyonlar `MemberProfile` kimliğine bağlıdır, `Payment.member` ilişkisi `Restrict`'tir). Üyelik `PASSIVE` olur ve `memberships.erased_at` yazılır (üyelik durumu enum'una yeni değer eklenmedi; `erased_at` bayrağı son durumdur).

- Kişinin **başka üyeliği kalmadıysa** global `User` yerinde anonimleştirilir: `phone` benzersiz, yönlendirilemez bir yer tutucu olur (`ERASED-<12 hex>`, geçerli E.164 değildir), `email` boşalır, ad ve soyad `***`, `pin_hash`, `password_hash`, `refresh_token_hash`, TOTP gizli anahtarı ve MFA kurtarma kodları temizlenir, `is_active = false` (JWT stratejisi her istekte bunu denetler, eski erişim jetonları da düşer), push cihazları, bildirim tercihleri ve takvim abonelik jetonu silinir, telefonla eşleşen OTP denemeleri silinir. Aynı telefonla sonradan yapılan davet yeni bir kullanıcı oluşturur.
- Kişinin **başka üyeliği varsa** gerçek `User` ve diğer üyelikler hiç değişmez. Silinen üyelik yeni, anonim bir `User` satırına taşınır (`memberships.user_id` güncellenir); böylece bu işletmedeki her join ad yerine `***` gösterir ve (stüdyo, kullanıcı) anahtarlı satırlar (onay kayıtları, tavsiye, deneme/promosyon kullanımı, denetim kayıtları) aynı anonim kimliği izler. Push cihazı, takvim jetonu ve bildirim tercihi kullanıcı düzeyinde olduğundan (stüdyo sütunu yoktur) bu durumda dokunulmaz; takvim aboneliği zaten yalnızca ACTIVE üyelikleri içerir.

## 6. Tablo ve alan dökümü

### Anonimleştirilen veya silinen

| Tablo | İşlem |
|---|---|
| `member_profiles` | `birth_date`, `emergency_contact_name`, `emergency_contact_phone`, `medical_conditions`, `notes`, `family_group_id`, `home_branch_id` boşaltılır; `leaderboard_opt_in = false`. Boş kalan `family_groups` silinir |
| `member_health_settings`, `health_sync_records`, `health_daily_summaries` | satırlar silinir (özel nitelikli veri) |
| `measurement_entries` | satırlar silinir |
| `member_risk_snapshots`, `member_risk_history`, `member_badges`, `member_goals`, `video_views`, `referral_codes`, `waitlists`, `dashboard_layouts`, `membership_branches`, `community_reactions` | satırlar silinir (türetilmiş veya kişiye özel veri) |
| `loyalty_ledger.note` | boşaltılır (puan satırları kalır) |
| `member_subscriptions` | `CANCELLED` yapılır (tahsilat durur); `stored_cards` silinir (sağlayıcı kart jetonu) |
| `billing_profiles` | silinir (ad, TCKN, VKN, adres, e-posta) |
| `payments.notes`, `sales.customer_name`, `sales.note`, `event_registrations.notes` ve `cancellation_reason`, `bookings.cancellation_reason`, `session_ratings.comment` | boşaltılır |
| `gift_cards` (alıcı adı, telefonu, mesaj, `purchaser_user_id`) | boşaltılır |
| `partner_guests` | telefon, harici misafir kimliği boşalır, ad `***` |
| `consents` | HEALTH_DATA onayı silinir (geri alma); diğer onay satırları kanıt olarak kalır, `ip` ve `device` boşaltılır |
| `communication_consents` | tüm kanallar `REVOKED` (İYS'ye, gerçek telefon hâlâ yerindeyken en iyi çabayla bildirilir; kayıt zaten İYS'ye iletilmediyse iletildi sayılır, kayıt telefonu yer tutucuya dönüşeceği için tekrar denenmez) |
| `contacts` (üyeliğe bağlı, telefon veya e-postası eşleşen ve birleştirilen kişiler) | ad `***`, soyad, telefon, e-posta, not, özel alanlar, etiketler, kayıp nedeni, kaynak ayrıntısı, tavsiye kodu boşaltılır |
| `contact_consents` | `REVOKED`, `evidence` boşaltılır; `contact_consent_confirmations` silinir |
| `contact_activities`, `contact_tasks`, `segment_members`, `conversations` (ve mesajları) | silinir |
| `campaign_recipients` (PENDING), `journey_enrollments` | bekleyenler iptal edilir, akışlardan çıkarılır, `context` boşaltılır |
| `visitors`, `touchpoints` | kişi bağlantısı kaldırılır; tarayıcı ve tıklama kimlikleri (fbclid, gclid, gbraid, wbraid, ttclid, li_fat_id, msclkid, fbp, fbc) boşaltılır |
| `leads` (üyeliğe dönüşen veya telefonu eşleşen) | ad `***`, telefon yer tutucu, e-posta, not, kayıp nedeni boşaltılır; `lead_activities` silinir |
| `invite_tokens` | telefon yer tutucu, ad `***` |
| `referrals.referred_phone` | yer tutucu |
| `notification_logs` (kullanıcı, kişi, telefon veya e-posta eşleşen) | `recipient_phone`, `recipient_email`, `user_id`, `contact_id`, `subject`, `error_message` boşaltılır, `content` boş metne çevrilir; `message_links` silinir |
| `community_posts`, `community_comments` | `author_membership_id` boşaltılır (yazar anonimleşir; içerik ve metin kalır) |
| `audit_logs` | üyelik ve profil kimliğine ait kayıtların `metadata` alanı boşaltılır (silme akışının kendi kayıtları hariç) |
| `memberships` | `status = PASSIVE`, `erased_at` |
| `users` | bkz. bölüm 5 |

### Bilerek korunanlar

- `payments` (tutar, para birimi, yöntem, durum, tarih, sağlayıcı referansı), `invoices` (numara, tutarlar, durum, satırlar ve `buyer_snapshot` alıcı bilgisi: VUK vergi saklama yükümlülüğü silmeye yasal istisnadır; saklama süresi dolduktan sonra anonimleştirme bu işin kapsamı dışındadır), `sales` ve `sale_lines`, `event_registrations` (tutarlar ve durum), `bookings` (durum, birim, zaman; yalnızca serbest metin neden silinir), `member_packages`, `package_transfers`, `loyalty_ledger` puan satırları, `sms_transactions`: yasal saklama ve muhasebe. Bağlı oldukları üyelik artık anonimdir.
- `notification_logs` satırlarının kendisi (tür, kanal, durum, zaman damgaları) ve `message_tracking_events`: teslimat istatistiği ve SMS kredi mutabakatı.
- `message_suppressions`: abonelikten çıkma/bastırma listesi. Kişinin ticari ileti almama tercihi, adres bilindiği sürece korunabilir; bu nedenle adres (telefon veya e-posta) bu listede kalır. Yasal gerekçe (itiraza saygı, İYS) için hukuki görüşle teyit edilmelidir.
- `consents` satırları (belge sürümü ve kabul zamanı): rıza kanıtı; kimlik bilgileri (`ip`, `device`) silinir.
- `touchpoints` ve `visitors` (ham ziyaret takibi; kişiye bağlı ziyaretçiler dahil) bu silmeden bağımsız olarak 13 ay sonra otomatik silinir (`docs/CRM_VE_ATIF.md`, Saklama süresi).
- `conversion_events` ve atıf özetleri (kaynak, ortam, kampanya adı): kişi artık anonimdir, toplu raporlama sürer.
- `trial_redemptions`, `promo_redemptions`, `redemption_counters`: kötüye kullanım önleme sayaçları; anonim kimliğe bağlanır (başka üyeliği olan kişide) veya anonimleşmiş kullanıcıda kalır.
- `data_erasure_requests`: talebin kendisi (hesap verebilirlik). `decision_note` personelin gerekçesidir, kişisel veri içermemelidir; `summary` yalnızca tablo bazlı sayılardır.
- Yedekler: günlük `pg_dump` yedekleri silme anından önceki veriyi içerir; saklama süresi dolunca (`docs/YEDEKLER.md`) kendiliğinden düşer. Geri yükleme sonrasında silinmiş üyeliklerin (`erased_at` dolu olanlar) yeniden anonimleştirilmesi gerekir.

### Davranış değişiklikleri

- Gelecek tarihli onaylı (CONFIRMED) rezervasyonlar normal iptal yolundan iptal edilir (kontenjan ve bekleme listesi doğru kalır, ceza uygulanmaz); bekleme listesi kayıtları silinir.
- Üye listesi (`GET /members/studio/:studioId`) silinmiş üyeleri göstermez; üye kartı kimlikle açılır ve `erasedAt` ile "Verileri silindi" rozetini gösterir.
- CRM'deki kişi satırı anonim olarak listelerde kalabilir (`***`); dönüşüm ve mali bağlantılar korunur.

## 7. Bilinen sınırlar

- Diğer işletmelerin görünümü etkilenmez; kullanıcı düzeyindeki veriler (push cihazı, takvim jetonu) başka üyeliği olan kişide korunur.
- Üçüncü taraflara (ödeme sağlayıcı kart jetonu, İYS, reklam platformlarına gönderilmiş dönüşümler) gönderilmiş veri bu akışla geri alınmaz; kart jetonunun sağlayıcıda silinmesi bu sürümde yapılmaz, yalnızca yerel referans silinir.
- Fatura `buyer_snapshot` alıcı bilgisi yasal saklama (VUK) için olduğu gibi korunur; saklama süresi sonunda anonimleştirilmesi bu işin kapsamı dışındadır.
- Geçmiş sürümlerde başka alanlara yazılmış serbest metindeki (ör. denetim kaydı metaverisi dışındaki) kişisel veriler tarama kapsamında değildir.

## 8. Testler

- Birim: `apps/api/src/modules/erasure/erasure-anonymizer.service.spec.ts` (alanlar silinir, mali satırlar silinmez, başka üyelik ve gerçek kullanıcı dokunulmaz, kullanıcı yalnızca başka üyelik kalmadıysa anonimleşir, idempotans, uygunsuz üyelikler, rezervasyon iptali ve onay geri alma); `apps/api/src/modules/jobs/jobs.service.spec.ts` (`erasure` adımı).
- API e2e: `apps/api/test/e2e/erasure.e2e-spec.ts` (talep, onay, kalp atışı yürütmesi; ret; 30 gün otomatik işleme; üye kartından başlatma ve iki stüdyolu kişi; `members.erase` olmayan personelin 403 alması).
- Web: `apps/web/e2e/erasure.e2e.ts` (talep listesi reddi, üye kartından onay penceresiyle silme).
- Mobil: `apps/mobile/src/lib/staffMenu.spec.ts` (Gizlilik menü öğesi yalnızca üye profili olana).
