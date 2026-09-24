# Oyunlaştırma: Seri, Kilometre Taşı, Rozet, Aylık Hedef (W16)

Bu doküman, üyeleri düzenli katılıma teşvik eden oyunlaştırma katmanını
anlatır: seri (streak), kilometre taşı (milestone), rozet (badge) ve aylık
seans hedefi. Uygulama: `apps/api/src/modules/gamification`.

## Tasarım ilkesi: rozetler veri, kod değil

CLAUDE.md kuralı gereği (madde 7) rozetler sabit kodlanmış bir liste değil,
`BadgeDefinition` tablosundaki satırlardır:

- `studio_id` null olan satırlar **küresel varsayılanlardır**: her kiracıya
  otomatik sunulur (seed'de 1/10/25/50/100/250 seans kilometre taşları,
  4/8/12 haftalık seriler, ilk seans, 3 farklı hizmet türü çeşitliliği,
  saat 08:00'den önce erken kuş, aylık hedef tutturma).
- Kiracı, kendi rozetlerini `studio.settings.manage` izniyle ekleyebilir,
  düzenleyebilir ve (henüz kimse kazanmadıysa) silebilir. Küresel
  varsayılanlara dokunamaz.
- `kind` altı sabit türden biridir (bu **enum kod tarafındadır**, çünkü
  değerlendirme mantığı türe göre değişir): `MILESTONE_SESSIONS`,
  `STREAK_WEEKS`, `MONTHLY_GOAL_MET`, `FIRST_SESSION`, `EARLY_BIRD`,
  `VARIETY`. Her türün parametreleri (`threshold` Json alanı)
  `@platform/shared`'daki bir Zod discriminated union ile doğrulanır, hem
  yazarken (API) hem de rozet kartını çizerken (mobil) aynı tip kullanılır.
- Rozetler yalnızca metin ve tema renkleriyle gösterilir; emoji veya ikon
  kütüphanesi kullanılmaz (CLAUDE.md madde 1 ve 10).

## Seri ve kilometre taşı hesaplaması: saf fonksiyonlar

Tüm hesaplama `apps/api/src/modules/gamification/gamification-calculations.ts`
içinde veritabanına dokunmayan saf fonksiyonlardır (`gamification-calculations.spec.ts`
ile birim testlidir):

- Bir seansın "yerel tarihi", stüdyonun saat dilimine (`Studio.timezone`)
  göre `Intl.DateTimeFormat` ile okunur; ek bir tarih kütüphanesi eklenmez.
- Bir ISO haftanın kimliği, o haftanın **Pazartesi 00:00 UTC** anıdır
  (`weekStartOf`); ardışık haftalar arasındaki fark her zaman tam 7 gündür,
  bu da yıl sonu/53. hafta gibi kenar durumlarında bile haftaları doğru
  sıralar ve bitişikliği basit bir çıkarma ile test eder.
- `computeStreakWeeks(attendedAt, timezone, minSessionsPerWeek, referenceDate)`:
  - **En iyi seri**: geçmişteki en uzun ardışık "yeterli haftalar" (o hafta
    içinde en az `minSessionsPerWeek` katılım) dizisi.
  - **Güncel seri**: `referenceDate`'in haftasından geriye doğru sayılır.
    Şu anki hafta henüz bitmediği (kotayı henüz tutturmamış olabilir) için,
    güncel hafta veya ondan önceki hafta yeterliyse seri kırılmış sayılmaz;
    daha büyük bir boşluk seriyi sıfırlar.
- `reachedMilestones`, `countDistinctServiceTypes`, `isEarlyBirdSession`,
  `countSessionsInLocalMonth` de aynı dosyada, aynı prensiple saf fonksiyonlardır.

## Değerlendirme ve verme (awarding)

`GamificationService.onAttendance(bookingId)`, `SchedulesService.checkIn()`
tarafından check-in başarılı olduktan **hemen sonra**, `try/catch` içinde
çağrılır: oyunlaştırma değerlendirmesi asla check-in'i başarısız kılmaz,
yalnızca uyarı loglar. Değerlendirme, üyenin **tüm** katılım geçmişini
yeniden okuyup her aktif rozet tanımı için koşulu kontrol eder; bu hem
`onAttendance` hem de stüdyo başına elle tetiklenen `backfill()` tarafından
kullanılan tek bir iç fonksiyondur (`evaluateMemberBadges`).

Verme her zaman **idempotenttir**: `member_badges` tablosundaki
`(member_id, badge_definition_id)` benzersiz kısıtı, aynı rozetin iki kez
verilmesini veritabanı seviyesinde engeller; olası bir yarış durumunda
`P2002` hatası sessizce yutulur.

Yeni kazanılan her rozet için `NotificationsService.notifyUser()` ile
`ACHIEVEMENT` bildirim kategorisi üzerinden push bildirimi gönderilir
(`packages/shared/src/notifications.ts`). Bu kategori varsayılan olarak
açıktır ve üye, mevcut "Bildirim ayarları" ekranından kapatabilir.

Stüdyo, `PUT /gamification/studio/:studioId/settings` ile oyunlaştırmayı
tamamen kapatabilir (`Studio.gamificationEnabled`, varsayılan açık).
Kapalıyken `evaluateMemberBadges` hiçbir rozet vermez, ama katılım
(check-in) kaydı normal şekilde işlenmeye devam eder.

## Aylık hedef: ilerleme her zaman hesaplanır

`MemberGoal` yalnızca `month` ("YYYY-MM") ve `targetSessions` saklar.
İlerleme hiçbir zaman bir sütunda tutulmaz; her okumada
`countSessionsInLocalMonth` ile o ayın katılım geçmişinden anlık hesaplanır.
Bu, geçmişe dönük bir rezervasyon iptali veya yoklama düzeltmesi olduğunda
ilerlemenin otomatik olarak doğru kalmasını sağlar.

## Liderlik tablosu: gizlilik önce

`MemberProfile.leaderboardOptIn` varsayılan **kapalıdır**. Yalnızca
katılımı açık üyeler `GET /gamification/studio/:studioId/leaderboard?month=YYYY-MM`
yanıtında görünür, en fazla 20 kişi, stüdyo kapsamlı ve o ayki seans
sayısına göre sıralı. Görünen ad her zaman `maskLeaderboardName()` ile
maskelenir: yalnızca ad ve soyadın ilk harfi (`"Ayşe Y."`), personel dahil
kimseye tam soyadı gösterilmez.

## Uç noktalar

Tümü `gamification/studio/:studioId` altında, `StudioScoped()` (JWT +
kiracı çözümleme + izin kontrolü) ile korunur.

| Yöntem ve yol | İzin | Açıklama |
|---|---|---|
| `GET .../settings` | `reports.view` | Oyunlaştırma açık mı |
| `PUT .../settings` | `studio.settings.manage` | Oyunlaştırmayı aç/kapa |
| `GET .../badge-definitions` | `reports.view` | Küresel + kiracının kendi rozetleri |
| `POST .../badge-definitions` | `studio.settings.manage` | Kiracıya özel rozet oluştur |
| `PUT .../badge-definitions/:id` | `studio.settings.manage` | Yalnızca kiracının kendi rozeti; `threshold.kind` değiştirilemez |
| `DELETE .../badge-definitions/:id` | `studio.settings.manage` | Yalnızca kazanılmamış, kiracıya özel rozet |
| `GET .../achievements` | `reports.view` | Her üye için toplam seans, seri, rozet sayısı |
| `POST .../backfill` | `studio.settings.manage` | Stüdyonun tüm üyeleri için geçmişten yeniden değerlendirme |
| `GET .../me/stats` | üye (self-service) | Toplam seans, güncel/en iyi seri, bu ayki hedef, kazanılan ve sıradaki rozetler (ilerleme yüzdesiyle) |
| `PUT .../me/goal` | üye (self-service) | Aylık hedef belirle/güncelle |
| `PUT .../me/leaderboard-opt-in` | üye (self-service) | Liderlik tablosuna katıl/ayrıl |
| `GET .../leaderboard?month=YYYY-MM` | üye (self-service) | Aylık liderlik tablosu (yalnızca katılımı açık üyeler) |

## Mobil

Hesabım ve ana ekrandan erişilen **"Başarılarım"** ekranı
(`apps/mobile/app/(app)/hesabim/basarilarim.tsx`): seri sayacı, aylık
hedefe doğru düz bir ilerleme çubuğu (grafik kütüphanesi yok), kazanılan
ve kilitli rozetlerin ızgarası (kilitli rozetlerde metin ilerleme durumu:
`"12/25 seans"` gibi), liderlik tablosu ve katılım anahtarı. Tüm renkler
`useTheme()`/`useThemeFonts()` üzerinden tasarım tokenlarından gelir.

## Kalan

- Web paneli (rozet tanımları yönetimi ve personel için üye başarı
  görünümü şimdilik yalnızca API üzerinden).
- Rozet tanımları için mobilde bir personel yönetim ekranı (şimdilik API).
