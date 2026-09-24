# Puan, Google Yorum Yönlendirmesi ve Arkadaşını Getir (W15)

Bu doküman, backlog W15 kapsamında eklenen ders sonrası puanlama, Google yorum yönlendirmesi ve
"Arkadaşını getir" tavsiye programının davranışını ve API'sini anlatır. Kod tarafında ilgili
modül `apps/api/src/modules/feedback`, paylaşılan şema ve tipler `packages/shared/src/feedback.ts`
içindedir.

## 1. Ders sonrası puanlama

### Kurallar

- Bir üye yalnızca **kendi** rezervasyonunu puanlayabilir ve rezervasyon **ATTENDED** durumda olmalıdır.
- Puanlama penceresi: seansın bitişinden sonraki **7 gün**. Pencere dışında `400 Bad Request`.
- Bir rezervasyon **yalnızca bir kez** puanlanır: tekrar puanlama denemesi `409 Conflict` döner.
- Puan, oluşturulmasından sonraki **24 saat** içinde `PATCH` ile düzenlenebilir; sonrasında `400`.
- `trainerProfileId`, puanlama anındaki değil **seansı veren eğitmeni** (`SessionSchedule.trainerId`)
  yansıtır; bu sayede daha sonra yapılan bir ikame (substitution) geçmiş puanları değiştirmez.
- `isAnonymousToTrainer` varsayılan olarak `true`'dur: eğitmenin kendi görünümünde
  (`GET /ratings/studio/:studioId/me/received`) üyenin kimliği gösterilmez, yalnızca puan ve yorum
  görünür. Sahip/yönetici (`reports.view`) her zaman tam listeyi, üye kimlikleriyle birlikte görür.
- Puan `<= 2` olduğunda, stüdyonun aktif tüm sahiplerine (`RoleTemplate.isOwner`) `NotificationsService.notifyUser`
  ile `FEEDBACK` kategorisinde push bildirimi gönderilir (bkz. `packages/shared/src/notifications.ts`).
  `FEEDBACK` yalnızca personele gösterilen (`staffOnly: true`), varsayılan olarak açık bir kategoridir.

### Uç noktalar

| Yöntem ve yol | İzin | Açıklama |
|---|---|---|
| `POST /ratings/studio/:studioId/bookings/:bookingId` | Üye kendi kendine (`@SelfService`) | Puanla; yanıt `{ rating, reviewPrompt }` |
| `PATCH /ratings/studio/:studioId/bookings/:bookingId` | Üye kendi kendine | İlk 24 saat içinde düzenle |
| `GET /ratings/studio/:studioId/me/given` | Üye kendi kendine | Kendi verdiği puanlar |
| `GET /ratings/studio/:studioId/me/pending` | Üye kendi kendine | Değerlendirilmemiş, pencere içindeki son ATTENDED rezervasyonlar (ana ekran davet kartı) |
| `GET /ratings/studio/:studioId/me/received` | Eğitmen kendi kendine | Kendi aldığı puanlar (anonimleştirme kurallarına göre) ve ortalama |
| `GET /ratings/studio/:studioId` | `reports.view` | Filtreli tam liste (`trainerProfileId`, `serviceTypeId`, `branchId`, `from`, `to`) ve ortalama |

## 2. Google yorum yönlendirmesi

- `Studio.googleReviewUrl` yalnızca şu öneklerden biriyle başlayan `https://` bağlantısını kabul eder:
  `https://g.page/`, `https://search.google.com/local/writereview`, `https://www.google.com/maps`.
  Doğrulama `packages/shared/src/feedback.ts` içindeki `GoogleReviewUrlSchema` ve `isValidGoogleReviewUrl` iledir.
- Bir puanlama isteği `score >= 4` ile sonuçlanır **ve** stüdyonun `googleReviewUrl`'i tanımlıysa,
  API yanıtı `reviewPrompt: { googleReviewUrl }` alanını içerir. Aksi halde `reviewPrompt: null`.
- Mobil uygulama bu alanı yalnızca **nazik bir öneri** olarak gösterir (`app/(app)/seans/degerlendir/[bookingId].tsx`):
  ayrı bir buton, hiçbir ödül veya zorunluluk yok.
- **Önemli (Google politikası):** teşvikli (incentivized) yorumlar -- indirim, hediye, ekstra ders vb.
  karşılığında yorum istemek -- Google'ın İş Profili politikalarını ihlal eder. Bu nedenle sistemde
  yorum bırakma hiçbir ödülle (ör. tavsiye programındaki `EXTRA_UNITS` ile) ilişkilendirilmez ve
  hiçbir ekranda "yorum bırakırsan ödül kazanırsın" mesajı yoktur.
- Ayarlar: `GET`/`PUT /studios/:studioId/feedback-settings` (`studio.settings.view` / `studio.settings.manage`).

## 3. Puanlama daveti (rating prompt)

- Seans bittikten sonra üyeye "seansını değerlendir" push bildirimi gönderilir (`NotificationsService.notifyUser`,
  kategori `BOOKING_REMINDER`, kullanıcı tercihine saygılı).
- `RatingPromptService.promptRecentAttendees(now)` (`apps/api/src/modules/feedback/rating-prompt.service.ts`):
  - Son 48 saat içinde biten, ATTENDED, henüz davet gönderilmemiş (`Booking.ratingPromptSentAt IS NULL`)
    rezervasyonları bulur (en fazla 500 kayıt, tek çağrıda).
  - Her rezervasyon için koşullu `updateMany` ile `ratingPromptSentAt`'i işaretler (idempotency): eşzamanlı
    veya tekrarlanan çalıştırmalar aynı üyeye iki kez bildirim göndermez.
- **BullMQ bu API'de henüz kurulu değil** (bkz. HANDOVER.md W6/W7). Bu nedenle W6'daki dunning tetikleyicisiyle
  aynı desende bir süper admin uç noktası sunulur: `POST /admin/feedback/rating-prompts/run` (`{ now?: ISO tarih }`).
  BullMQ kurulduğunda bu, tekrarlayan bir işe (job) taşınmalıdır; iş mantığı zaten `RatingPromptService` içinde
  ayrık ve saf tutulmuştur.

## 4. Arkadaşını getir (refer-a-friend)

### Kod ve kayıt

- Her üyenin stüdyo başına tek bir kısa kodu vardır (`ReferralCode`, `GET /referrals/studio/:studioId/me/code`
  ilk çağrıda oluşturur, sonraki çağrılarda aynı kodu döner). Kod büyük harf ve rakamlardan oluşur
  (karışmasın diye 0/O/1/I hariç), 8 karakter.
- Herkese açık iniş sayfası: `GET /public/referrals/:code` -- JWT gerektirmez, yalnızca `{ studioName, offerText }`
  döner; hiçbir üye kimliği veya iletişim bilgisi açığa çıkmaz.
- Üye oluşturma (`POST /members`, `CreateMemberSchema`) ve herkese açık potansiyel üye formu
  (`POST /public/studios/:slug/leads`, `PublicLeadFormSchema`) isteğe bağlı bir `referralCode` alanı kabul eder.
  - Doğrudan üye oluşturmada: `MembersService.createMember` işlemin aynı transaction'ı içinde
    `ReferralsService.recordReferral` çağrılır.
  - Potansiyel üye formunda: kod, `Lead.referralCode` alanında saklanır ve potansiyel üye üyeliğe
    dönüştüğünde (`LeadsService.convert` / `bookTrial`) `MembersService.createMember`'a aktarılır.
- **Kendine tavsiye engeli**: tavsiye edilen kullanıcı, kodun sahibiyle aynı (global) kullanıcıysa
  hiçbir `Referral` satırı oluşturulmaz (bkz. `ReferralsService.recordReferral`, birim testi
  `apps/api/src/modules/feedback/referrals.service.spec.ts`).
- **Aynı telefon iki kez değil**: kullanıcılar telefonla global benzersiz olduğundan,
  `(studioId, referredUserId)` üzerindeki veritabanı benzersiz kısıtı aynı kişinin bir stüdyoda iki kez
  tavsiye olarak kaydedilmesini engeller (ikinci deneme sessizce yok sayılır).

### Hak kazanma ve ödül

- Durum makinesi: `PENDING -> QUALIFIED -> REWARDED`, veya personel tarafından her aşamada `VOIDED`
  (ödül verildikten sonra iptal edilemez).
- Hak kazanma koşulu: tavsiye edilen üyenin bu stüdyoda **ilk tamamlanmış ödemesi** (`Payment.paymentStatus = COMPLETED`)
  **veya ilk katıldığı ders** (`Booking.status = ATTENDED`).
- Ödül: `Studio.referralRewardUnits` (varsayılan 1) kadar `EXTRA_UNITS`, tavsiye edenin en son oluşturulmuş
  **aktif, birim tabanlı** (`SESSION_COUNT` veya `CREDIT`) paketine eklenir. Hediye kartı (`GIFT_CARD`) modülü
  ana dalda henüz olmadığından tek ödül türü budur (bkz. görev tanımı).
- **Tam olarak bir kez ödül**: `ReferralsService.grantReward`, `status = QUALIFIED` koşuluyla bir `updateMany`
  çalıştırır; yalnızca bu koşullu güncellemeyi (satır kilidi ile) kazanan çağrı paket birimini kredilendirir.
  Eşzamanlı iki çağrı için de aynı fonksiyon çağrılır (bkz. e2e testi "parallel qualification"); kaybeden
  çağrı `count === 0` görüp hiçbir şey yapmadan döner. Her ödül bir `AuditLog` kaydı bırakır.
- **Yeniden değerlendirme ne zaman çalışır**: bu API'de henüz ayrı bir zamanlanmış iş yoktur (bkz. bölüm 3).
  Hak kazanma/ödül kontrolü, ilgili liste uç noktaları çağrıldığında (üyenin kendi tavsiye listesi veya
  personelin tavsiye listesi) tembel (lazy) olarak çalışır (`ReferralsService.recompute`). Bu, demo ölçeğinde
  yeterlidir; üretimde BullMQ kurulduğunda bölüm 3'teki gibi zamanlanmış bir işe taşınması önerilir.

### Uç noktalar

| Yöntem ve yol | İzin | Açıklama |
|---|---|---|
| `GET /referrals/studio/:studioId/me/code` | Üye kendi kendine | Kod ve paylaşım metni |
| `GET /referrals/studio/:studioId/me` | Üye kendi kendine | Kendi tavsiyelerinin durumu (her çağrıda yeniden değerlendirilir) |
| `GET /referrals/studio/:studioId` | `members.manage` | Filtreli personel listesi (`status`, `memberId`) |
| `POST /referrals/studio/:studioId/:referralId/reward` | `members.manage` | Manuel ödül (otomatik hak kazanmayı bekletmeden) |
| `POST /referrals/studio/:studioId/:referralId/void` | `members.manage` | İptal (yalnızca `REWARDED` değilse) |
| `GET /public/referrals/:code` | Yok (herkese açık) | İniş sayfası bilgisi |
| `GET`/`PUT /studios/:studioId/feedback-settings` | `studio.settings.view` / `manage` | `googleReviewUrl`, `referralRewardUnits` |

## 5. Mobil ekranlar

- `app/(app)/seans/degerlendir/[bookingId].tsx`: puanlama ekranı, 5 adet 56pt (>= 44pt) dokunma hedefi,
  isteğe bağlı yorum alanı, başarılı gönderimden sonra (varsa) Google yorum önerisi.
- Ana ekran (`app/(app)/index.tsx`): değerlendirilmemiş, pencere içindeki son dersler için davet kartı
  (`GET /ratings/studio/:studioId/me/pending`).
- `app/(app)/hesabim/arkadasini-getir.tsx`: kod, paylaş butonu (React Native `Share` API), tavsiye durumu listesi.

## 6. Açık sorular / kalanlar

- Web paneli tarafı bu backlog öğesinin kapsamında değildir (bkz. HANDOVER.md 2.1).
- Gerçek zamanlı hak kazanma (ödeme/yoklama anında anlık tetikleme) yerine tembel yeniden değerlendirme
  kullanılmıştır; bu, mevcut ödeme ve yoklama modüllerine dokunmadan (regresyon riskini düşük tutarak)
  W15'i teslim etmek için bilinçli bir tercihtir. BullMQ kurulduğunda hem bu hem de puanlama daveti aynı
  zamanlanmış iş altyapısına taşınabilir.
