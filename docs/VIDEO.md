# Video: Canlı Yayın ve İsteğe Bağlı Kütüphane (W19)

Bu doküman, backlog W19 kapsamında eklenen canlı çevrimiçi seanslar (yayın bağlantısı) ve
isteğe bağlı video kütüphanesinin davranışını ve API'sini anlatır. Kod tarafında ilgili modül
`apps/api/src/modules/video` (içerik kütüphanesi ve katılım hatırlatma servisi) ve
`apps/api/src/modules/schedules` (canlı seans katılım mantığı); paylaşılan şema ve tipler
`packages/shared/src/video.ts` içindedir.

## 1. Canlı çevrimiçi seanslar

### Teslim şekli ve yayın bağlantısı

- Her `SessionSchedule` bir `deliveryMode` taşır: `IN_PERSON` (varsayılan, mevcut tüm seanslar),
  `ONLINE` veya `HYBRID`. `HYBRID`/`ONLINE` seanslar için opsiyonel `onlineCapacity` (çevrimiçi
  katılımcı üst sınırı) girilebilir.
- Yayın bağlantısı sağlayıcı soyutlaması `VideoMeetingProvider` (`apps/api/src/modules/video/providers`)
  iki adaptör sunar:
  - **MANUAL**: personel var olan bir Zoom/Meet/Jitsi/başka bir bağlantıyı yapıştırır; yalnızca
    `https://` kabul edilir (`HttpsUrlSchema`, ayrıca sunucu tarafında ikinci bir doğrulama).
  - **JITSI**: `JITSI_BASE_URL` ortam değişkeninden (varsayılan `https://meet.jit.si`) türetilen,
    16 bayt (128 bit) rastgele onaltılık oda adına sahip tahmin edilemez bir oda bağlantısı üretir.
- Bağlantı, seans oluşturma (`POST /schedules`) veya `PATCH /schedules/:scheduleId/meeting`
  (`schedule.manage`) ile ayarlanır/değiştirilir.
- **Yayın bağlantısı hiçbir listeleme yanıtında dönmez**: ne `GET /schedules/studio/:studioId`
  (personel takvimi) ne de `GET /schedules/self/week` (üye haftalık listesi) `meetingUrl`/
  `meetingProvider` alanlarını içerir. Bağlantı yalnızca aşağıdaki katılım uç noktasından döner.

### Katılım (`POST /schedules/sessions/:scheduleId/join`)

- Yalnızca üye kendi kendine (`@SelfService`) çağırabilir.
- Bağlantı, çağıran üyenin bu seans için **CONFIRMED veya ATTENDED** durumda bir rezervasyonu
  varsa döner; aksi halde `403`.
- Katılım penceresi: seans başlamadan **15 dakika önce** (`JOIN_WINDOW_MINUTES_BEFORE`,
  `packages/shared/src/video.ts`) ile seansın bitişi arasında. Pencere dışında `400`.
- Katılım, `SchedulesService.checkInForMember` (mevcut `checkIn` ile aynı çekirdek mantığı
  paylaşır) üzerinden rezervasyonu **ATTENDED** olarak işaretler, böylece W16 oyunlaştırma
  değerlendirmesi de çalışır. İdempotenttir: zaten ATTENDED bir rezervasyon için tekrar katılma
  isteği yine bağlantıyı döner ve yeniden check-in yapmaz.
- `IN_PERSON` bir seansa veya yayın bağlantısı hiç ayarlanmamış bir seansa katılma isteği `400`
  döner.

### Katılım hatırlatması (zamanlanmış iş)

- `JoinReminderService.sendDueReminders()` (`apps/api/src/modules/video/join-reminder.service.ts`),
  W10/W15/W6/W7 ile aynı 15 dakikalık nabızdan (`JobsService.runAll()`) çağrılır.
- CONFIRMED/ATTENDED durumdaki, katılım penceresi açılmış, henüz hatırlatma gönderilmemiş
  rezervasyonlara `BOOKING_REMINDER` kategorisiyle push bildirimi gönderir.
- İdempotentlik `Booking.joinReminderSentAt` üzerinde koşullu güncelleme ile sağlanır (önce
  hatırlatma alanını doldur, sonra gönder deseni; W15'teki `ratingPromptSentAt` ile aynı desen).

## 2. İsteğe bağlı video kütüphanesi

### Model

- `VideoContent`: başlık, açıklama, süre, kaynak (`provider`), görünürlük, opsiyonel kredi
  maliyeti, yayın durumu. **Yalnızca `EXTERNAL_URL` uygulandı** (herhangi bir https bağlantı:
  YouTube gizli/liste dışı video, Vimeo, vb). `UPLOADED` şema/veritabanında yer ayrılmış ama
  uygulanmadı - bu projede yerel dosya yükleme altyapısı (multipart upload, disk/nesne depolama
  entegrasyonu) henüz yok; eklenirse `UPLOADED` bu iskelete oturtulabilir.
- Görünürlük (`visibility`):
  - `ALL_MEMBERS`: her aktif üye görür.
  - `MEMBERS_WITH_ACTIVE_PACKAGE`: en az bir ACTIVE, süresi dolmamış paketi olan üyeler.
  - `SPECIFIC_PACKAGES`: yalnızca `VideoContentPackage` ile eşleşen paket tanımlarından birine
    sahip üyeler.
  - Kilitli bir kart için `GET /video/content/self` yanıtı `isLocked: true`, Türkçe bir
    `lockedReason` döner ve **`sourceUrl` asla döndürülmez**.
- `VideoView`: üye+içerik başına tek satır (`@@unique([videoContentId, memberId])`); kaldığı yer
  (`lastPositionSeconds`), tamamlanma zamanı ve kredi tahsilatının yapıldığı an
  (`creditChargedAt`).

### İzleme ve kredi tahsilatı

- İzleme **varsayılan olarak hiçbir hak/kredi tüketmez**. İçerik başına opsiyonel `creditCost`
  girildiğinde, yalnızca **CREDIT_BASED** paketlerden, **üye başına bir kez** tahsil edilir.
- `POST /video/content/self/:contentId/start` akışı:
  1. `VideoView` satırı üye+içerik için oluşturulur (yoksa); eşzamanlı iki ilk-izleme isteği
     yarışırsa kaybeden taraf benzersizlik hatasını (P2002) yakalayıp satırı yeniden okur - bu adım
     tahsilat transaction'ının **dışında**, ayrı bir sorgu olarak çalışır ki bir çakışma hatası
     sonraki transaction'ı asla "aborted transaction" durumuna düşürmesin.
  2. İçeriğin `creditCost`'u varsa ve bu satır için **daha önce tahsilat yapılmamışsa**, tek bir
     transaction içinde: önce `VideoView.creditChargedAt` alanı `IS NULL` koşuluyla koşullu
     güncellenerek tahsilat hakkı "iddia edilir" (yalnızca bu güncellemeyi kazanan istek devam
     eder); ardından seçilen `MemberPackage` üzerinde `remainingUnits >= creditCost` koşuluyla
     koşullu düşüm yapılır. Koşul sağlanmazsa transaction geri alınır ve `409 Conflict` döner
     (paket asla eksiye düşmez, iddia da geri alınır).
  3. Bu iki koşullu güncelleme sayesinde **eşzamanlı iki istek altında tahsilat tam olarak bir
     kez** gerçekleşir (bkz. `apps/api/test/e2e/video.e2e-spec.ts`, "charges exactly once under
     two parallel start requests").
- `POST /video/content/self/:contentId/progress` yalnızca kaldığı yeri/tamamlanma durumunu
  günceller; tahsilat mantığına dokunmaz.

### İzinler ve uç noktalar

Yeni izin anahtarları (`packages/shared/src/permissions.ts`): `content.view` (içerik ve
izlenme raporlarını görüntüleme) ve `content.manage` (içerik ekleme/düzenleme/yayınlama, seans
yayın bağlantısı ayarlama `schedule.manage` ile ayrıdır). Sahip her zaman ikisine de sahiptir.

| Yöntem ve yol | İzin | Açıklama |
|---|---|---|
| `POST /video/content/studio/:studioId` | `content.manage` | İçerik oluştur (taslak) |
| `PUT /video/content/studio/:studioId/:contentId` | `content.manage` | İçeriği güncelle |
| `POST .../:contentId/publish` \| `.../unpublish` | `content.manage` | Yayınla / yayından kaldır |
| `GET /video/content/studio/:studioId` | `content.view` | Personel listesi (taslaklar dahil) |
| `GET /video/content/studio/:studioId/reports` | `content.view` | İzlenme, tamamlanma, tekil izleyici (`?format=csv`) |
| `GET /video/content/self` | Üye kendi kendine | Yayınlanmış kütüphane, kilit durumu, kaldığı yer |
| `POST /video/content/self/:contentId/start` | Üye kendi kendine | İzlemeye başla / devam et, gerekiyorsa kredi tahsil et |
| `POST /video/content/self/:contentId/progress` | Üye kendi kendine | Kaldığı yeri / tamamlanmayı kaydet |
| `PATCH /schedules/:scheduleId/meeting` | `schedule.manage` | Seansın teslim şekli ve yayın bağlantısını ayarla |
| `POST /schedules/sessions/:scheduleId/join` | Üye kendi kendine | Katılım bağlantısını al (yukarıdaki kurallarla) |

## 3. Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `JITSI_BASE_URL` | `https://meet.jit.si` | JITSI adaptörünün oda bağlantısı türettiği taban URL; yalnızca https kabul edilir. |

## 4. Mobil

- **Videolar** sekmesi (`apps/mobile/app/(app)/videolar`): kütüphane ızgarası, hizmet türüne göre
  filtre, kilitli kartlarda gerekçe, kaldığı yerden devam bilgisi. Oynatma, projede henüz
  `expo-av`/`expo-video` bağımlılığı olmadığından **harici bağlantıyı `Linking.openURL` ile
  açarak** yapılır; bu bağımlılıklardan biri eklenirse uygulama içi oynatıcıya geçilebilir.
- Personel içerik yönetimi: Hesabım > "Video içerikleri" (`content.manage`), liste/oluştur/
  yayınla-kaldır.
- Seans detayında (`app/(app)/seans/[scheduleId].tsx`) `ONLINE`/`HYBRID` seanslar için "Seansa
  katıl" birincil butonu **yalnızca katılım penceresi içindeyken** görünür; dışındayken bilgi
  metni gösterilir.
- Seans oluşturma/düzenleme için mobilde henüz bir ekran yok (yalnızca API); bu nedenle
  "personel: seans düzenlemede yayın bağlantısı alanı" şu an yalnızca API üzerinden
  (`PATCH /schedules/:scheduleId/meeting`) kullanılabilir. Mobil/web seans yönetim ekranları
  eklendiğinde bu alan oraya eklenmelidir.

## 5. Test

- Birim testler: `packages/shared/src/video.spec.ts` (katılım penceresi matematiği),
  `apps/api/src/modules/video/content.service.spec.ts` (görünürlük kuralları, kredi tahsilatı
  idempotency'si, yarış kaybeden isteğin pakete dokunmaması).
- e2e: `apps/api/test/e2e/video.e2e-spec.ts` - yayın bağlantısının listelerden gizlenmesi,
  rezervasyonu olmayan üyenin katılamaması, pencere dışında/içinde katılım, katılımın yoklamayı
  tam olarak bir kez işaretlemesi, paket bazlı görünürlük, iki paralel istekte tam olarak bir
  kredi tahsilatı, yetersiz kredide `409`, yayınlama/kaldırma, izin ve kiracılar arası erişim
  reddi, https-only bağlantı doğrulaması.

## Kalan (kapsam dışı bırakılanlar)

- `UPLOADED` video sağlayıcısı (yerel dosya yükleme altyapısı yok).
- Web paneli ekranları (yalnızca API ve mobil).
- Mobilde seans oluşturma/düzenleme ekranı (dolayısıyla yayın bağlantısı alanı da mobilde henüz
  yok, yalnızca API üzerinden ayarlanabilir).
- Uygulama içi video oynatıcı (şu an harici bağlantı açılıyor).
