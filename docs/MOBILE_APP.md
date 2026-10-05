# Mobil uygulama (Expo)

Tek uygulama, tek Expo Router ağacı (`apps/mobile/app`), her rol için: üye, eğitmen, resepsiyon, işletme
sahibi. Navigasyon rollere değil, aktif kiracının etkin izin kümesine göre kurulur (CLAUDE.md "Mobil
uygulama kuralları"). Bu doküman personel deneyimini (eğitmen/resepsiyon/sahip), tablet düzenini ve
EAS build kurulumunu anlatır. Üye tarafı (rezervasyon, paket, sağlık entegrasyonu vb.) için ilgili
backlog dokümanlarına bakın (`docs/HEALTH_INTEGRATION.md`, `docs/CHECKIN.md`, `docs/VIDEO.md`,
`docs/MOBILE_WIDGETS.md`).

## Tasarım dili (Perfect UI)

Mobil uygulama webin kullandığı görsel dili (Perfect UI, bkz. `docs/TASARIM.md`) çizer. Renk, köşe,
boşluk ve yazı boyutu için tek kaynak `@platform/shared` içindeki `PERFECT_UI_TOKENS`'tır; ekranlar
temayı `useTheme()` (içeride `resolveTheme()`) üzerinden alır ve hiçbir yerde sabit renk, köşe veya
yazı boyutu yazmaz.

- **Yazı tipi yalnızca Inter**: `@expo-google-fonts/inter` (400, 500, 600, 700). React Native özel
  fontlarda ağırlık üretemediği için her ağırlık ayrı yüz olarak yüklenir (`src/fonts.ts`, adlar
  `src/interFaces.ts`). `src/components/Text` ve `TextInput`, react-native'in `Text` ve `TextInput`
  bileşenlerinin yerine geçer ve `fontWeight` değerinden Inter yüzünü seçer; yüzler yüklenene kadar
  sistem yazı tipi kullanılır. Ekranlarda `Text` her zaman bu bileşenden alınır.
- **Ölçek**: boşluk 4'ün katları (`spacing`), köşe 6 (kontroller) ve 9 (kartlar), çip ve rozet tam
  yuvarlak (`radii`), kenarlık 1px (`borderWidth`), yazı 12 / 14 / 16 / 20 / 24 (`typography.size`
  `xs`..`xl`, taban 14), dokunma hedefi en az 44 (`TOUCH_TARGET`).
- **Tek tema ailesi, açık/koyu kullanıcıya ait**: Görünüm ekranı yalnızca sistem, açık ve koyu seçer
  (`mAccount.appearance.*`). Kullanıcının kayıtlı tema ailesi eski bir alandır; olduğu gibi geri
  gönderilir. Marka rengi (`theme.colors.primary`) düz yüzeylerin rengidir ve gerekirse otomatik düzeltilir
  (`deriveBrandPalette()`, `docs/TASARIM.md` bölüm 1b); üzerindeki metin `theme.colors.onPrimary`,
  bağlantı ve vurgu metni `theme.colors.primaryText` ile okunur. İşletme teması ekranı (`hesabim/isletme-temasi`) yalnızca logo
  adresini ve ana rengi (`#RRGGBB`) düzenler. Süper admin işletme için birden çok tema ailesine izin
  verdiyse (D7) ekranda ayrıca bir aile seçici görünür (`themeDesign.picker.*`); tek aile izinliyse
  seçici yoktur. Aile, oturumdaki `membership.theme.allowedThemeFamilies` ile `resolveTheme()`
  üzerinden çizilir; izinli olmayan saklı aile `perfect` çizilir. İzin dışı bir aileyi API `403` ve
  `THEME_FAMILY_NOT_ALLOWED` koduyla reddeder.
- **Gradyan yalnızca iki alanda**: `MemberCard` (üye kartı) ve `PackageCard` (paket kartı), ayrıca
  sadakat bakiye kartı (üye kartı alanı); kaynağı `brandGradient()` (birincil renkten türetilir) ve
  metin rengi `onGradient()`. `GradientSurface` yalnızca bu alanları kabul eder. Birincil buton ve
  başlık bandı düz birincil renktir.
- **Gezinme**: sekme çubuğu ve üst başlıklar `src/navigation.ts` içindeki `useNavigationStyle()`
  üzerinden token alır (sayfa rengi zemin, 1px alt kenarlık, gölge yok, Inter başlık, etkin sekme rengi
  marka rengi; marka rengi zeminde okunmayacak kadar açıksa metin rengi). Tüm `Stack` yerleşimleri aynı
  stili kullanır.
- **Bileşen kümesi** (`apps/mobile/src/components`): `Button` (solid / soft / outline; ton: theme,
  success, warn, error, muted, surface; `compact`), `Card` (isteğe bağlı başlık bandı, `onPress`),
  `Badge`, `Chip`, `ListRow`, `EmptyState`, `SectionTitle`, `StatTile`, `Skeleton`, `TextField`,
  `ChoiceRow`, `SwitchRow`. Eski adlar korunur ve yeni ilkellerin üzerinde çalışır: `PrimaryButton`
  (`Button`'a eşleme), `ScreenContainer`, `DateTimeField`, `SessionDetail`, `MemberCard`,
  `PackageCard`, `PermissionGate`, `MemberHealthTrendCard`. Ton ve renk çözümü `tones.ts`'te
  (`toneColors()`), yumuşak (soft) dolgu rolün %12 saydamlığıdır.
- **Sınırlar**: Android ana ekran widget'ı tema bağlamı dışında çizildiği için kendi sabit
  paletini kullanır (`src/widgets`); kök hata ekranı (`ErrorFallback`) sağlayıcıların dışında olduğu için
  sistem yazı tipiyle çizilir.
- **Doğrulama**: bu ortamda cihaz veya simülatör yoktur; görsel sonuç yalnızca tip denetimi, birim
  testleri ve kod incelemesiyle doğrulandı. Gerçek cihazda açık/koyu ve marka rengi taraması gerekir.

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
| Gelen kutusu (G1c) | `inbox.view` (cevap `inbox.reply`, ata/kapat `inbox.manage`) | `hesabim/gelen-kutusu` |

Üye profili olan herkes Hesabım altında **İşletmeye yaz** (`hesabim/mesajlar`, G1c) girişini görür:
üyenin işletmeyle uygulama içi sohbeti (mesajlar personelin gelen kutusuna `IN_APP` kanalıyla düşer,
cevaplar burada görünür) ve işletmenin gönderdiği uygulama içi duyurular (gösterilince okundu işaretlenir).
Metinler `mMessaging.*` i18n anahtarlarıdır. Ayrıntılar: `docs/MESAJLASMA.md`.

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
- Gelen kutusu: açık konuşmalar solda, seçili konuşma ve cevap kutusu sağda (telefonda aynı ekranda
  liste ile konuşma arasında geçiş; WhatsApp 24 saat penceresi kapalıysa şablonlu cevap web panelinden).

Telefon genişliğinde aynı ekranlar tek panel kalır ve seçim `expo-router` stack push'una döner
(`hesabim/uyeler/[memberId]`, `hesabim/programim/[scheduleId]`). Yeni bir düzen kütüphanesi eklenmedi.

## Genel bakış panosu (mobil)

Sahibin isteği: web'deki genel bakış kartlarının mobilde de görünmesi ve
kartın basılı tutulup çöp kutusuna sürüklenerek kaldırılabilmesi. Ekran
`app/(app)/hesabim/genel-bakis.tsx`; `dashboard.view` izni olan her
üyelikte "Hesabım" menüsünün ilk satırı ve ana ekranda bir kısayol kartı
olarak görünür (`PermissionGate anyOf={['dashboard.view']}`; API aynı izni
ayrıca zorlar).

**Veri.** Web ile aynı uç noktalar: düzen `GET/PUT/DELETE
/studios/:studioId/dashboard/layout`, kart verisi `POST
/studios/:studioId/dashboard/data` (`src/dashboard/useDashboardBoard.ts`).
Kaydedilen düzen her zaman 12 sütunludur; mobil yalnızca motorun tek sütun
ölçeklemesiyle (`scaleForColumns(items, 1)`: okuma sırası, tam genişlik)
tek sütun gösterir. Düzenlemeler iyimser uygulanır, 800 ms sonra tek PUT
gider (aynı anda tek istek; arada yapılan düzenleme ardından saklanır),
başarısız kayıt son saklanan düzene döner ve kısa bir uyarı gösterir. Bekleyen
kayıt ekrandan çıkınca veya uygulama arka plana gidince gönderilir. Kart
ekleme ve boyutlandırma mobilde yoktur (web'de yapılır); başlığın yanında
"Varsayılana dön" (onaylı) vardır.

**Kart görünümleri** (`src/dashboard/widgets.tsx`): göstergeler büyük değer
ve alt satırla; tablolar ve listeler `ListRow` satırlarıyla; grafikler
`react-native-svg` ile çizilen çizgi/alan grafiğiyle (`TrendChart`,
geometri saf `src/lib/dashboardChart.ts`); haftalık takvim işletmenin saat
diliminde gün gün kısa liste olarak; hızlı işlemler mobilde karşılığı olan
ekranlara giden düğmeler olarak (`MOBILE_QUICK_ACTIONS`: yeni seans, yeni
üye, hızlı satış, check-in; "Paket sat" ve "Ödeme kaydet"in mobil ekranı
olmadığından gizlenir). Para her zaman yükteki para birimiyle ve etkin
dile göre `Intl` ile biçimlenir; işletme verisi çevrilmez. İzni olmayan
veya hata veren kart küçük, soluk bir mesaj gösterir.

**Basılı tut ve çöp kutusuna sürükle.** Karta yaklaşık 400 ms basılı
tutulunca (`LONG_PRESS_MS`) kart hafifçe büyür ve gölge kazanır, ekranın alt
ortasında çöp kutusu hedefi belirir ve liste kaydırması kapanır. Parmak
kaldırılmadan kart sürüklenir; parmak hedefin üzerindeyken hedef hata rolü
rengine döner. Hedefin üzerinde bırakılırsa kart küçülerek kaldırılır ve
motorla sıkıştırılmış 12 sütunlu düzen PUT ile saklanır (`removeCard`);
başka yerde bırakılırsa kart yerine animasyonla döner. Hold süresi dolmadan
parmak 10 puntodan fazla kayarsa dokunuş kaydırma sayılır. Yalnızca React
Native'in kendi `PanResponder` ve `Animated` API'leri kullanılır
(`react-native-gesture-handler` veya `reanimated` eklenmedi); çöp kutusu
simgesi `react-native-svg` ile çizilir. Kaldırınca altta "Kart kaldırıldı"
ve "Geri al" bandı yaklaşık 6 saniye kalır (`restoreCard`).

**Erişilebilirlik.** Her kartın başlık satırı erişilebilir bir öğedir ve
`remove` eylemi sunar (VoiceOver/TalkBack eylem menüsü, "Kartı kaldır");
kaldırma ve geri alma `announceForAccessibility` ile duyurulur. Dokunmayla
kaldırma ipucu başlık satırının `accessibilityHint` alanındadır.

**Test.** Saf mantık (çöp kutusu isabeti, kaldırma ve geri alma düzeni, tek
sütun sırası, hızlı işlem kuralı, grafik geometrisi) `src/lib/dashboardBoard.spec.ts`
ve `src/lib/dashboardChart.spec.ts` içindedir; jest yalnızca bu saf
modülleri çalıştırır, dokunuş davranışı elle doğrulanır.

## Mobil uygulamada dil

Çok dilli destek `apps/mobile/src/i18n/` altında yaşar; anahtarların ve İngilizce/Türkçe metinlerin tek
doğruluk kaynağı `packages/shared/src/i18n/` (bkz. `packages/shared/src/i18n/locales.ts`,
`translator.ts`, `messages/index.ts`). Mobil uygulamaya özgü ekran metinleri, çakışmayı önlemek için
`m` önekli isim alanlarında (namespace) tutulur: `mNav` (sekme başlıkları, stüdyo değiştirici), `mAuth`
(telefon/OTP/PIN ekranları), `mAccount` (Hesabım menüsü, Görünüm, Dil ekranı). Ortak metinler (Kaydet,
Vazgeç, hata mesajları vb.) `common.*` isim alanından tekrar kullanılır.

### Dil çözümleme sırası

`I18nProvider` (`app/_layout.tsx`, `SessionProvider` içinde) etkin dili `resolveLocale()` ile şu sırayla
belirler (`src/i18n/localeResolution.ts` -- `buildLocaleCandidates()`):

1. Oturum açıksa: kullanıcının kendi seçimi (`SessionUserDTO.locale`), ardından aktif stüdyo
   üyeliğinin varsayılan dili (`MembershipDTO.defaultLocale`), ardından cihaz dilleri
   (`expo-localization`'ın `getLocales()`'i).
2. Oturum kapalıyken: cihazda daha önce yerel olarak kaydedilmiş seçim (`storage.ts`,
   `getStoredLocaleChoice()`), ardından cihaz dilleri.
3. Hiçbiri etkin diller arasında değilse: Türkçe (`BASE_LOCALE`).

Bölge kodlu bir cihaz dili (ör. `en-GB`) etkin bir `en` diliyle eşleşir (`resolveLocale`'in kendi
davranışı). Hesabım > Dil ekranından yapılan seçim oturum açıkken `PUT /me/locale` ile sunucuya
yazılır (`null` = "işletmenin varsayılan dili") ve aynı zamanda cihazda saklanır, böylece bir sonraki
oturum açılışında da (henüz sunucudan `SessionUserDTO` gelmeden) aynı dil kullanılabilir.

### Mesaj önbellekleme

Ekranlar hiçbir zaman ağ isteğini beklemez: `BUNDLED_MESSAGES[locale]` (`packages/shared`'a gömülü,
yalnızca `tr` ve `en`) ile hemen render edilir. Ardından `GET /i18n/messages/:locale` çağrılır ve
sonucu (`messages` + `version`) `AsyncStorage`'da önbelleğe alınır (`storage.ts`); önbellek bulunduğu
sürece uygulama tamamen çevrimdışı çalışır. Yeniden çekme en fazla 10 dakikada bir yapılır
(`MESSAGES_REFRESH_INTERVAL_MS`, `localeResolution.ts`), uygulamanın ön plana her geçişinde de bu kural
kontrol edilir; istek `If-None-Match: <önbellekteki version>` gönderir, 304 dönerse önbellek olduğu
gibi kalır. `BUNDLED_MESSAGES` içinde olmayan bir dil (CMS'te eklenmiş) için gömülü bir küme yoktur;
render doğrudan `resolveLocale`'in Türkçe'ye düşüşüyle ve sunucudan gelen çeviriyle yapılır.

Eksik bir anahtar (`onMissing`), yalnızca `__DEV__` derlemede ve anahtar başına bir kez konsola
loglanır; üretimde sessizce anahtarın kendisi gösterilir (`createTranslator`'ın varsayılan davranışı).

### Yeni metin eklemek

1. Türkçe metni `packages/shared/src/i18n/messages/tr/<mNamespace>.ts` içine ekleyin (anahtar
   `"<namespace>.<...>"` ile başlamalı).
2. İngilizcesini aynı anahtarla `packages/shared/src/i18n/messages/en/<mNamespace>.ts` içine ekleyin;
   tip tanımı eksik bir İngilizce anahtarı derleme hatası yapar.
3. Yeni bir isim alanıysa `packages/shared/src/i18n/messages/index.ts`'deki `TR_NAMESPACES`/
   `EN_NAMESPACES` listelerine ekleyin.
4. Ekranda `useT()` (`apps/mobile/src/i18n`) ile `t('mNamespace.key')` çağırın; `{name}` yer tutucuları
   ve `count` ile çoğul biçimler (`.one`/`.other`) `packages/shared/src/i18n/translator.ts`'de
   açıklanan kurallara uyar.

Bu tur; kök/uygulama düzenini, sekme başlıklarını, stüdyo değiştiriciyi, (auth) altındaki tüm ekranları
(telefon, OTP, PIN girişi, PIN oluşturma), Hesabım menüsünü, Görünüm ekranını, yeni Dil ekranını ve
`PermissionGate` bileşenini anahtarlara taşıdı. Hesabım altındaki diğer ekranlar (ör. Bordro,
Faturalarım, Raporlar, Potansiyel üyeler) henüz sabit Türkçe metin içerir; aynı `mAccount` deseniyle
sonraki bir turda taşınabilir.

Tarih/sayı biçimlendirmesi için sabit kodlanmış `'tr-TR'` yerine `src/i18n/formatting.ts`'deki
`formatDate`/`formatTime`/`formatDateTime`/`formatNumber`/`formatCurrency` (etkin `locale`'i
`useLocale()`'den alarak) kullanılmalıdır. Bu tur bu yardımcıları oluşturdu ve birkaç paylaşılan
bileşeni (`DateTimeField`, `SessionDetail`, `PackageCard`, `MemberCard`) ve ana ekranları
(Ana sayfa, Seanslar) taşıdı; Hesabım altındaki para/tarih biçimlendiren diğer ekranlarda (Bordro,
Faturalarım, Ödemelerim, Hakedişim, Raporlar, Şubeler, Bugün, Programım, Riskli üyeler, Potansiyel
üyeler, Sağlık özeti, Arkadaşını getir, Resepsiyon tarama, Walk-in) hâlâ `'tr-TR'` sabit kodludur;
metin taşımasıyla aynı sonraki turda ele alınmalıdır.

### Widget'lar ve bildirimler

Ana ekran widget'ları (`src/widgets/`, iOS ve Android) kendi başlıksız arka plan görevlerinde çalışır
ve uygulamanın React ağacına (dolayısıyla `I18nProvider`'a) erişemez; `src/widgets/format.ts` bu yüzden
şimdilik sabit Türkçe metin üretmeye devam eder. Bunu doğru şekilde çözmek, widget görev işleyicisinin
(`android/taskHandler.ts`, iOS tarafı) `AsyncStorage`'daki önbelleklenmiş dil/mesaj kaydını kendi
başına okuyup küçük bir çevirici kurmasını gerektirir; bu turda kapsam dışı bırakıldı ve burada
belgelenmiştir. Push bildirimleri sunucudan gelir (`src/lib/push.ts` yalnızca cihaz kaydı yapar,
bildirim metnini oluşturmaz), bu yüzden yerel olarak planlanmış/biçimlendirilmiş bir bildirim metni
yoktur.

## Hata raporlama ve kaynak haritaları

Uygulama beklenmedik hataları yakalar, kişisel veriyi temizler ve platformun hata sistemine gönderir (mimari ve sınırlar: `docs/HATA_RAPORLAMA.md` "Mobil yakalama"). Kısaca:

- Kök `ErrorBoundary` ve Expo Router'ın `ErrorBoundary`'si dostça bir ekran ve 8 karakterlik hata kodu gösterir (`mErrors` metinleri); kullanıcı kodu destek ekibine iletir, süper admin `/admin/hatalar` aramasına yazar.
- Yakalanmamış JS hataları (`ErrorUtils`) ve Hermes'te yakalanmamış Promise redleri kaydedilir; olaylar önce cihaza (`AsyncStorage`, en fazla 50 olay) yazılır, açılışta, öne gelişte ve çevrimdışıysa katlanan aralıklarla `POST /telemetry/errors`'a gönderilir. Yeni bağımlılık eklenmedi (NetInfo yok).
- `release` uygulama sürümü artı (varsa) EAS Update kimliğidir (`1.4.0-<update-id>`); `environment` EAS profilinin `APP_VARIANT` değeridir (`app.config.ts` `extra.appVariant`).

### Kaynak haritalarını yükleme

Hermes ve Metro paketleri küçültülmüş olduğundan sunucu, yığın izlerini ancak o sürümün haritası yüklüyse çözer. `apps/mobile/scripts/upload-sourcemaps.mjs` bunu yapar (düz Node; depoda `ts-node`/`tsx` yok):

```bash
# EAS Update (OTA) paketi: harita export çıktısındadır
npx expo export --platform android --platform ios --source-maps --output-dir dist
SOURCEMAP_UPLOAD_TOKEN=... API_URL=https://api.<alan-adi> \
  node scripts/upload-sourcemaps.mjs --dist dist --update-id <eas update id>

# Mağaza derlemesine gömülü paket: sürüm = app.json sürümü, --update-id verilmez
node scripts/upload-sourcemaps.mjs --dist <EAS Build'in verdiği harita klasörü> --version 1.4.0
```

- Yüklenen sürüm anahtarı uygulamanın raporladığı `release` ile birebir aynı olmalıdır: `<sürüm>` veya `<sürüm>-<update id>`. Harita dosya adıyla saklanır (`index.android.bundle`, `entry-<hash>.hbc`); cihazdaki dizin önemli değildir, API çerçeveyi yol sonekiyle eşler.
- Update kimliğinden emin değilseniz, güncellenmiş uygulamada bir hata üretip `/admin/hatalar` detayındaki "Sürüm" alanına bakın; `--update-id` o değerin sürümden sonraki kısmı olmalıdır.
- Saklama 30 gündür; daha eski sürümlerin izleri ham kalır.
- Bu hat cihazda doğrulanmadı: Hermes bayt kodu çerçevelerinin gerçek biçimi ve `.hbc.map` eşlemesi sahibin ilk EAS derlemesinde denenmelidir.

**Sahibin yapması gerekenler** (EAS bulut sırrı CI'ya eklenmedi): (1) API sunucusunun `.env` dosyasına `SOURCEMAP_UPLOAD_TOKEN` (en az 32 karakter, `openssl rand -hex 32`); (2) yüklemeyi `expo export`/`eas update` sonrası elle veya kendi CI'nızda çalıştırmak; (3) mağaza derlemelerinde EAS Build'in ürettiği Hermes haritasını `--dist` ile vermek. Mobil için otomatik CI adımı, EAS token'ı (`EXPO_TOKEN`) gerektirdiğinden H3'e bırakıldı.

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
