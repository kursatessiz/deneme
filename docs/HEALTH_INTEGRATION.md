# Sağlık entegrasyonu (Apple Health / Android Health Connect, W21)

Bu doküman W21 kapsamında eklenen Apple Health (HealthKit) ve Android Health
Connect entegrasyonunu açıklar: veri modeli, API uç noktaları, mobil akış,
KVKK/gizlilik yaklaşımı ve sahibin App Store / Google Play tarafında yapması
gerekenler.

## 1. Gizlilik ilkeleri

Sağlık verisi, 6698 sayılı KVKK kapsamında **özel nitelikli kişisel veridir**.
Bu nedenle:

- Her şey varsayılan olarak **kapalıdır**. Hiçbir veri, üye Hesabım > "Sağlık
  entegrasyonu" ekranından açıkça açmadan okunmaz, yazılmaz veya paylaşılmaz.
- Yazma (derslerin sağlığa yazılması) ve okuma (günlük özetlerin cihazda
  gösterilmesi) **ayrı** anahtarlardır.
- İşletmeyle paylaşım (`shareWithStudio`) okumadan da **ayrı, üçüncü** bir
  anahtardır: okuma açık olsa bile işletme hiçbir şey görmez, üye ayrıca bunu
  da açmalıdır.
- Herhangi bir anahtar açılmadan önce, `document_versions.type = HEALTH_DATA`
  altında saklanan açık rıza metni onaylanmış olmalıdır (`consents` tablosu,
  mevcut KVKK onam altyapısıyla aynı: `acceptedAt`, `device`, `ip`,
  `documentVersionId`). Bu onam, üyelik onboarding'indeki zorunlu belgelerden
  **ayrıdır**; yalnızca sağlık entegrasyonunu açmak isteyen üyeden istenir.
- Sunucuya yalnızca **günlük özet** (adım, aktif enerji kcal, dinlenme nabzı)
  yüklenir; ham örnek (raw sample) hiçbir zaman sunucuya gönderilmez.
- Üye "Verilerimi sil" ile sunucudaki tüm sağlık satırlarını (`health_daily_
  summaries`, `health_sync_records`) kalıcı olarak silebilir; bu işlem
  denetlenir (`audit_logs`, `member_health.data_deleted`) ve HEALTH_DATA
  onayını da geri alır (bir sonraki açışta yeniden onay gerekir).
- Cihazın kendi Sağlık uygulamasındaki veriler bu silme işleminden etkilenmez;
  üye onu Apple Health / Health Connect ayarlarından kendisi yönetir.

## 2. Veri modeli

Bkz. `docs/DATABASE_ERD.md` "Sağlık Entegrasyonu" bölümü. Özet:

- `ServiceType.healthActivityType`: kiracının bir hizmetini genel bir
  `HealthActivityType` (STRENGTH, FLEXIBILITY, YOGA, PILATES, DANCE,
  MARTIAL_ARTS, SWIMMING, CYCLING, RUNNING, WALKING, TENNIS, OTHER) ile
  eşler. Kodda hiçbir yerde sektöre özgü varsayım yoktur; varsayılan `OTHER`,
  eşleme kiracı ayarıdır (katalog uç noktalarında `CreateServiceTypeInput` /
  `UpdateServiceTypeInput` alanı).
- `MemberHealthSettings`: üye başına üç anahtar (yukarıdaki gizlilik ilkeleri).
- `HealthSyncRecord`: `(memberId, bookingId, platform)` üzerinde tekil kısıt;
  bir rezervasyon bir platforma iki kez yazılamaz.
- `HealthDailySummary`: `(memberId, date)` üzerinde tekil kısıt; upsert her
  zaman aynı günü günceller, asla yeni satır çoğaltmaz.

## 3. API uç noktaları

Tümü `JwtAuthGuard` + `StudioTenantGuard` (`x-studio-id` başlığı veya body/
query alanı) gerektirir; kendi verisi (`/me/health/*`) `@SelfService()`,
personel görünümü `@RequirePermission('members.health.view')`.

| Uç nokta | Açıklama |
|----------|----------|
| `GET /me/health/settings` | Üç anahtar + aktif onay durumu |
| `PUT /me/health/settings` | Ayarları günceller; herhangi biri `true` yapılmak isteniyorsa aktif HEALTH_DATA onayı şarttır (yoksa 403); `shareWithStudio`, `readAggregates` kapalıyken otomatik `false`'a zorlanır |
| `GET /me/health/consent` | Güncel HEALTH_DATA belge sürümü ve onay durumu |
| `POST /me/health/consent` | Güncel HEALTH_DATA belge sürümünü onaylar (idempotent) |
| `POST /me/health/summaries` | Günlük özet toplu upsert, tek seferde en fazla 31 gün; adım 0-100000, kcal 0-10000, dinlenme nabzı 25-220 doğrulanır; aktif onay VE `readAggregates` + `shareWithStudio` açık olmalı, yoksa 403 |
| `GET /me/health/summaries` | Kendi son özetlerini listeler (varsayılan son 30 gün) |
| `DELETE /me/health/data` | Tüm sunucu taraflı sağlık verisini siler, ayarları sıfırlar, onayı geri alır, denetler |
| `GET /me/health/sync-records` | Hangi rezervasyonların hangi platforma yazıldığını listeler |
| `POST /me/health/sync-records` | Bir rezervasyonun bir platforma yazıldığını kaydeder; idempotenttir (aynı istek tekrar gönderilirse aynı kayıt döner, yeni satır oluşmaz); yalnızca ATTENDED durumundaki kendi rezervasyonu için ve `writeWorkouts` açıkken çalışır |
| `GET /me/health/pending-workouts` | Son 14 gündeki, sunucunun hâlâ yazılabilir gördüğü (ATTENDED, `writeWorkouts` açık, onay aktif) rezervasyonlar; mobil uygulama bunu kendi yerel ve sunucu önbelleğiyle karşılaştırıp eksik olanları yazar |
| `GET /studios/:studioId/members/:memberId/health` | Personel görünümü: `members.health.view` VE üyenin `shareWithStudio` açık olması şart (kapalıysa boş liste döner, hata değil); şube kısıtlı personel yalnızca kendi şubesindeki üyeyi görebilir |

`members.health.view` izni yeni değildir; üye kartındaki sağlık notları
görünürlüğüyle aynı izin, sağlık verisi eğilim görünümü için de kullanılır
(tek izinle iki ilgili yetenek).

## 4. Mobil akış

### Yazma yönü (birincil)

`apps/mobile/src/health/index.ts`'teki `syncAttendedBookingToHealth()` ve
`syncAllPendingWorkouts()`:

1. `GET /me/health/pending-workouts` ile hâlâ yazılması gereken ATTENDED
   rezervasyonları alır.
2. Her biri için önce cihaz üzerindeki yerel önbelleği kontrol eder
   (`apps/mobile/src/health/localSyncCache.ts`, `expo-secure-store`), sonra
   HealthKit/Health Connect'e yazar, sonra `POST /me/health/sync-records` ile
   sunucuya bildirir, en son yerel önbelleğe işaretler. Sıra bilinçlidir:
   sunucunun tekil kısıtı gerçek doğruluk kaynağıdır; yerel önbellek yalnızca
   gereksiz native çağrıları önler.
3. `ServiceType.healthActivityType` sunucudan geldiği gibi kullanılır;
   `resolveHealthActivityType()` (`packages/shared/src/health.ts`) tanınmayan
   bir değeri her zaman `OTHER`'a düşürür.
4. Süre girilen ders başlangıç/bitiş saatinden gelir; kalori yalnızca üye
   kendisi girmişse eklenir (asla tahmin edilmez).

Bu akış, ana ekran (`app/(app)/index.tsx`) her yüklendiğinde sessizce,
başarısızlığı asla ana akışı bozmadan (`.catch(() => undefined)`) çalışır.

### Okuma yönü (isteğe bağlı, ayrı onay)

`syncTodayAggregatesIfOptedIn()` aynı ekran yüklemesinde, yalnızca
`readAggregates` VE `shareWithStudio` ikisi de açıkken günün özetini okur ve
`POST /me/health/summaries` ile yükler. Üye "Sağlık" ekranında
(`app/(app)/hesabim/saglik-ozet.tsx`) kendi son 7/30 günlük adım ve aktif
enerji grafiğini (düz `View`'lardan oluşan çubuklar, grafik kütüphanesi yok)
ve son dinlenme nabzını görür.

### Ekranlar

- `app/(app)/hesabim/saglik.tsx`: ayarlar (onay, üç anahtar, "Verilerimi
  sil").
- `app/(app)/hesabim/saglik-ozet.tsx`: üyenin kendi 7/30 günlük özeti.
- `src/components/MemberHealthTrendCard.tsx`: personel üye kartına
  eklenebilecek, `members.health.view` iznine ve üyenin paylaşım açığına
  bağlı hazır bileşen (henüz mobilde ayrı bir "üye kartı" ekranı olmadığından
  -- bkz. HANDOVER.md W2 -- bu bileşen o ekran eklendiğinde doğrudan
  kullanılabilir; API ve izin kontrolü tamamen çalışır durumda).

### Platform modülü ve Expo Go

`apps/mobile/src/health/appleHealth.ts` ve `healthConnect.ts`,
`@kingstinct/react-native-healthkit` ve `react-native-health-connect`
paketlerine dayanır. Her ikisi de **native modül** gerektirir ve Expo Go
içinde çalışmaz (development build veya EAS build şart). Bu nedenle:

- `apps/mobile/src/health/environment.ts`'teki `isExpoGo()`, Expo Go'da her
  iki modülü de native koda hiç dokunmadan no-op yapar.
- Her native çağrı `try/catch` ile sarılıdır; izin reddi, cihazda Sağlık
  uygulaması/Health Connect kurulu olmaması veya bir development build
  olmaması hep aynı şekilde "başarısız, sessizce vazgeç" olarak ele alınır.
- Bu oturumda macOS/Xcode veya bir Android emülatör/EAS derlemesi
  olmadığından gerçek cihazda native davranış doğrulanamadı; tip kontrolü
  (`tsc --noEmit`) geçti ve her genel API çağrısı manuel olarak paketlerin
  `.d.ts` tanımlarıyla karşılaştırıldı.

## 5. Yapılandırma (app.json)

İki config plugin eklendi:

```json
["@kingstinct/react-native-healthkit", {
  "NSHealthShareUsageDescription": "...",
  "NSHealthUpdateUsageDescription": "..."
}],
"react-native-health-connect"
```

İlki iOS `Info.plist`'e Türkçe izin metinlerini ve HealthKit entitlement'ını
ekler; ikincisi Android `AndroidManifest.xml`'e Health Connect'in izin
gerekçesi (rationale) intent-filter'larını ekler (izinlerin kendisi
`requestPermission()` çağrısı sırasında çalışma zamanında istenir, manifest'e
elle eklenmesi gerekmez).

## 6. Sahibin yapması gerekenler

Widget'larda olduğu gibi (`docs/MOBILE_WIDGETS.md`), bu özellik de bir
development build / EAS build gerektirir; Expo Go'da test edilemez.

1. **Apple Developer**: App Store Connect'teki uygulama için **HealthKit**
   capability'sinin açılması gerekir (Xcode'da veya `eas build:configure`
   ile imzalama sırasında). Ek bir App Group gerekmez (W4'teki widget App
   Group'undan bağımsızdır).
2. **App Store gizlilik etiketleri (Privacy Nutrition Labels)**: App Store
   Connect'te "Health & Fitness" veri türü altında toplanan veriler
   (Fitness, Health) beyan edilmelidir; bu veri kullanıcıyla
   ilişkilendirilir ve üçüncü taraflarla paylaşılmaz, yalnızca uygulama
   işlevselliği için kullanılır şeklinde işaretlenmelidir.
3. **Google Play Health Connect beyan formu**: Play Console'da Health
   Connect API kullanımı için ayrı bir bildirim formu doldurulmalı
   (uygulamanın hangi veri türlerini okuduğu/yazdığı, KVKK/gizlilik
   politikası bağlantısı, verinin nasıl kullanıldığı). Play Store'daki veri
   güvenliği (Data Safety) bölümü de güncellenmelidir.
4. **Gizlilik politikası**: herkese açık gizlilik politikası metnine sağlık
   verisi entegrasyonu (ne toplanır, nasıl silinir, kiminle paylaşılır)
   eklenmelidir; her iki mağaza da bunu ister.
5. **HEALTH_DATA belge metni**: seed'deki taslak metin
   (`packages/database/prisma/seed.ts`) yalnızca örnektir; canlıya
   geçmeden önce bir hukuk danışmanı tarafından gözden geçirilmelidir (bkz.
   CLAUDE.md "Sahiple çalışma").
6. **Gerçek cihaz testi**: bir development build veya EAS build ile hem iOS
   hem Android'de izin diyalogları, yazma ve okuma akışları uçtan uca
   denenmelidir; bu oturumda yapılamadı.
