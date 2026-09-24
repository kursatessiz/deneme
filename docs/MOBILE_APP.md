# Mobil uygulama (Expo)

Tek uygulama, tek Expo Router ağacı (`apps/mobile/app`), her rol için: üye, eğitmen, resepsiyon, işletme
sahibi. Navigasyon rollere değil, aktif kiracının etkin izin kümesine göre kurulur (CLAUDE.md "Mobil
uygulama kuralları"). Bu doküman personel deneyimini (eğitmen/resepsiyon/sahip), tablet düzenini ve
EAS build kurulumunu anlatır. Üye tarafı (rezervasyon, paket, sağlık entegrasyonu vb.) için ilgili
backlog dokümanlarına bakın (`docs/HEALTH_INTEGRATION.md`, `docs/CHECKIN.md`, `docs/VIDEO.md`,
`docs/MOBILE_WIDGETS.md`).

## Roller ve navigasyon

Sekmeler sabittir (`app/(app)/_layout.tsx`): Ana sayfa, Seanslar (üye kendi rezervasyonu), Videolar,
Hesabım. Personel ekranlarının tamamı Hesabım altında yaşar; Hesabım menüsü
`apps/mobile/src/lib/staffMenu.ts`'deki saf `buildHesabimMenu()` fonksiyonundan üretilir (birim testli,
bkz. `staffMenu.spec.ts`), aktif üyeliğin `permissions` dizisine ve `memberProfileId`/`trainerProfileId`
alanlarına bakar. Bir kullanıcı birden fazla kiracıya ait olabilir; başlıktaki stüdyo değiştirici
(`StudioSwitcher`, `app/(app)/_layout.tsx`) zaten mevcuttu ve değişmedi.

Menüde izne göre görünen personel girişleri:

| Menü öğesi | Gerekli izin | Ekran |
| --- | --- | --- |
| Programım | `schedule.view` + eğitmen profili | `hesabim/programim` |
| Bugünün seansları | `attendance.manage` veya `bookings.manage` | `hesabim/bugun` |
| Üyeler | `members.view` | `hesabim/uyeler` |
| Yeni üye davet et | `members.manage` | `hesabim/uyeler/yeni` |
| Yeni seans | `schedule.manage` | `hesabim/programim/yeni` |
| Üye QR tarama | `attendance.manage` | `hesabim/resepsiyon-tarama` (W17, değişmedi) |

Menüde görünmeyen bir rotaya doğrudan gidilirse (ör. eski bir derin bağlantı), her personel ekranı
`PermissionGate` (`apps/mobile/src/components/PermissionGate.tsx`) ile ekran seviyesinde de korunur:
izin yoksa "Bu ekrana erişim yetkiniz yok" mesajı gösterilir. API bağımsız olarak
`@RequirePermission`/`@SelfService` ile yetkiyi zorunlu kılmaya devam eder; mobildeki koruma yalnızca
kullanıcı deneyimi içindir.

## Eğitmen akışı ("Programım")

`hesabim/programim`: gün/hafta seçici, `GET /schedules/studio/:studioId?trainerId=<benim>` ile kendi
seanslarım. Bir seansa dokunmak `hesabim/programim/[scheduleId]` (telefon) veya tablette sağ paneli açar
(`src/components/SessionDetail.tsx`, hem Programım hem Bugünün seansları tarafından paylaşılır):

- Roster: `bookingMemberName()`/`trainerName()` (`src/lib/scheduleTypes.ts`) ile katılımcı adları,
  partner misafiri etiketleri.
- Giriş yap / gelmedi: `PATCH /schedules/check-in/:bookingId`, `PATCH /schedules/no-show/:bookingId`
  (`attendance.manage`).
- İkame eğitmen isteği: eğitmen listesi (`GET /trainers/studio/:studioId`), `POST
  /schedules/:scheduleId/substitute` (`schedule.manage`).
- Seansı düzenle / iptal et: `PATCH /schedules/:scheduleId`, `POST /schedules/:scheduleId/cancel-session`
  (`schedule.manage`).
- Hakedişim: değişmedi, `hesabim/hakedisim` zaten mevcuttu (`commissions.view.own`).

## Resepsiyon akışı ("Bugünün seansları")

`hesabim/bugun`: tüm personelin bugünkü seansları (trainerId filtresi yok), aynı `SessionDetail`
bileşeniyle hızlı giriş/gelmedi. Kısayollar: W17'nin mevcut "Üye QR tarama" ekranı ve üye arama.

Üye kartı (`hesabim/uyeler/[memberId]`, `src/components/MemberCard.tsx`, `members.view`):

- Profil ve maskesiz iletişim yalnızca `members.contact.view` ile (`GET
  /members/:memberId/studio/:studioId`).
- Aktif paketler: `PackageCard` (`packageCard` gradyan slotu), dondur/dondurmayı kaldır (`POST
  /members/packages/:packageId/{freeze,unfreeze}`, `packages.sell`).
- Rezervasyon geçmişi, notlar.
- W12 risk rozeti ve ilk üç neden (`GET /churn/studio/:studioId/members/:memberId`).
- `isPartnerGuest` etiketi.
- W21 `MemberHealthTrendCard` (`members.health.view` arkasında, üyenin kendi paylaşım tercihine bağlı).
- "Seansa ekle (walk-in)" (`bookings.manage`, önümüzdeki 7 gün boş kontenjanlı seanslar, `POST
  /schedules/book`) ve "Paket sat" (`packages.sell`, `POST /payments/sell`).

Yeni üye davet etme (`hesabim/uyeler/yeni`, `members.manage`): ad/telefon, `POST /invites`, ekranda QR
gösterimi -- mevcut onboarding akışıyla aynı (`InviteToken` -> `/j/<token>` -> OTP -> PIN -> onay).

Yeni seans (`hesabim/programim/yeni`, `schedule.manage`): hizmet türü/eğitmen/kaynak/şube seçici
(`GET /catalog/service-types`, `/catalog/resources`, `/trainers`, `/branches`), başlangıç/bitiş saati,
kontenjan, W19 teslim şekli (yüz yüze/çevrimiçi/hibrit) ve toplantı bağlantısı, `POST /schedules`.

Bu backlog turunda yeni bir API uç noktası eklenmedi: yukarıdaki tüm uç noktalar zaten mevcuttu
(çoğu web paneli 2.2/2.3'ten). Form doğrulaması `packages/shared`'daki aynı Zod şemalarıyla yapılır
(`CreateScheduleSchema`, `UpdateScheduleSchema`, `SellPackageSchema`, `CreateInviteSchema`,
`BookSessionSchema`), tekilleştirilmiş hata haritalama `src/lib/formErrors.ts` üzerinden.

## Tablet düzeni

`useWindowDimensions` + saf `selectLayout()`/`isTabletWidth()` (`src/lib/layout.ts`, eşik 768px,
birim testli). 768px ve üzeri genişlikte:

- Üyeler: liste solda, seçili üyenin kartı sağ panelde (`hesabim/uyeler/index.tsx`).
- Programım / Bugünün seansları: seans listesi solda, seçili seansın detay/roster paneli sağda.

Telefon genişliğinde aynı ekranlar tek panel kalır ve seçim `expo-router` stack push'una döner
(`hesabim/uyeler/[memberId]`, `hesabim/programim/[scheduleId]`). Yeni bir düzen kütüphanesi eklenmedi.

## EAS Build

`apps/mobile/eas.json`: `development` (internal dağıtım, dev client), `preview` (internal, Android APK)
ve `production` (Android App Bundle) profilleri. Hiçbir gizli bilgi commit edilmez.

İşletme sahibinin doldurması/sağlaması gerekenler:

- **iOS**: Apple Developer hesabı, Team ID ve App Store Connect uygulama ID'si. `eas.json`'daki
  `submit.production.ios` alanları yer tutucu metin olarak bırakılmıştır (`APPLE_ID_ENV_PLACEHOLDER`
  vb.); gerçek değerler `eas submit` sırasında ortam değişkeni olarak (`EXPO_APPLE_ID`,
  `EXPO_ASC_APP_ID`, `EXPO_APPLE_TEAM_ID`) veya EAS hesap ayarlarından girilmelidir, dosyaya asla
  yazılmamalıdır.
- **Android**: Google Play hizmet hesabı (service account) JSON anahtarı,
  `apps/mobile/google-service-account.json` yoluna yerel olarak konur; bu dosya `.gitignore`'dadır ve
  commit edilmemelidir. CI/CD'de EAS'in kendi "credentials" deposu veya bir GitHub secret'ı üzerinden
  sağlanmalıdır.
- Bundle identifier / package adı `app.json`'dan okunur (`com.platform.member`, hem iOS hem Android);
  değiştirilecekse tek yerden güncellenir.
- `EXPO_PUBLIC_API_URL`: her profil için `eas.json`'da yer tutucu bir URL var (`api-staging`/`api`);
  gerçek ortam adresleriyle güncellenmeli.

Build komutları (yerel `eas-cli` ile, kurulum ve giriş sahipte):

```bash
eas build --profile development --platform all
eas build --profile preview --platform android
eas build --profile production --platform all
```

Kamera (W17 QR tarama) ve Sağlık (W21) izin metinleri Türkçe olarak `app.json`'da zaten tanımlıdır;
bu turda değişmedi.
