# Mobil takvim entegrasyonu ve ana ekran widget'ları

Bu doküman W4 kapsamında eklenen kişisel takvim akışını ve iOS/Android ana
ekran widget'larını açıklar: neyin kod olarak hazır olduğunu, sahibin
sağlaması gereken girdileri ve widget'ları görmek için gereken derleme
adımlarını.

## 1. Kişisel takvim (ICS abonelik akışı)

- API: `POST /me/calendar-feed` yeni bir abonelik token'ı oluşturur (veya
  mevcut olanı döndürür), `DELETE /me/calendar-feed` iptal eder, herkese
  açık `GET /calendar/:token.ics` RFC 5545 uyumlu bir takvim döndürür.
  Token'ın yalnızca sha256 özeti veritabanında tutulur; ham değer sadece
  oluşturma/döndürme (rotate) anında bir kez gösterilir.
- Mobilde Hesabım > "Takvim aboneliği" ekranı (`apps/mobile/app/(app)/hesabim/takvim.tsx`)
  bağlantıyı oluşturur, panoya kopyalamayı (`expo-clipboard`) ve
  `webcal://` ile doğrudan takvim uygulamasında açmayı sunar, iptal
  seçeneği vardır.
- Ana ekranda her rezervasyon kartında "Takvime ekle" eylemi
  (`apps/mobile/src/lib/calendarSync.ts`, `expo-calendar` paketi) cihazın
  varsayılan takvimine (iOS) veya birincil yazılabilir takvimine (Android)
  etkinlik ekler, başlangıçtan 60 dakika önce hatırlatma alarmı kurar.
- Bu akış Expo Go üzerinde de çalışır (expo-calendar "managed" bir
  modüldür, native config plugin gerektirmez), ekstra kurulum gerekmez.

## 2. Ana ekran widget'ları

Widget içeriği: sonraki ders (başlık, saat, stüdyo adı) ve en yakın zamanda
biten aktif paketin kalan hakkı. Veri `GET /me/summary`'den gelir ve
`apps/mobile/src/widgets/refresh.ts` üzerinden şu anlarda tazelenir: giriş
yapıldıktan sonra, uygulama ön plana geldiğinde (`app/_layout.tsx`, `AppState`)
ve ana ekranda rezervasyon listesi her yüklendiğinde. Gerçek bir
rezervasyon oluşturma/iptal ekranı eklendiğinde oradan da
`refreshWidgets()` çağrılmalıdır (bkz. `apps/mobile/src/widgets/index.ts`).

Widget kodu `apps/mobile/src/widgets/` altında:
- `types.ts`, `format.ts`, `store.ts`: paylaşılan veri şekli, Türkçe
  metin biçimlendirme, cihaz üzerinde son bilinen anlık görüntünün
  saklanması (`expo-secure-store`).
- `ios/nextSessionWidget.tsx`: `expo-widgets` ile `createWidget`,
  `@expo/ui/swift-ui` bileşenleriyle (VStack/Text) yazılmış widget
  düzeni. `'widget'` direktifi taşıyan fonksiyon expo-widgets'in derleme
  zamanı paketleyicisi tarafından native koda çevrilir.
- `android/nextSessionWidget.tsx`, `android/taskHandler.ts`:
  `react-native-android-widget` ile FlexWidget/TextWidget tabanlı düzen ve
  arka planda (uygulama açık olmasa da) widget güncellemelerini işleyen
  headless görev (`registerWidgetTaskHandler`), `app/_layout.tsx`'te JS
  paketi yüklenirken kaydedilir.

### app.json yapılandırması

`apps/mobile/app.json` içine iki config plugin eklendi:

```json
["expo-widgets", { "groupIdentifier": "group.com.platform.member", "widgets": [...] }],
["react-native-android-widget", { "widgets": [...] }]
```

`expo-widgets` yalnızca iOS widget'ını (WidgetKit) üretir; Android tarafı
kasıtlı olarak `react-native-android-widget`'a bırakıldı (iki ayrı, görev
tanımında istenen kütüphane).

### Sahibin sağlaması gerekenler

Widget'lar **Expo Go içinde çalışmaz**; bir development build veya EAS
build gerekir çünkü her ikisi de native kod (iOS WidgetKit extension'ı,
Android AppWidgetProvider) ekler. Bu oturumda macOS/Xcode veya EAS hesabı
olmadığı için native derleme doğrulanamadı; aşağıdakiler sahip tarafından
sağlanmalı veya yapılmalı:

1. **Apple Developer hesabı ve takımı**: iOS widget'ı için App Store
   Connect'te kayıtlı bir takım (team) gerekir. `expo-widgets` config
   plugin'i Team ID'yi doğrudan `app.json`'dan istemiyor; `eas credentials`
   ile veya Xcode'da imzalama sırasında seçilir. `eas.json`'da henüz bir
   iOS imzalama profili yoksa sahibin `eas build:configure` çalıştırması
   gerekir.
2. **App Group**: `groupIdentifier` alanı `app.json`'da
   `group.com.platform.member` olarak ayarlandı (varsayılan: `group.<bundle id>`).
   Bu, ana uygulama ile widget extension'ı arasında paylaşılan depolama
   için Apple entitlement'ıdır; plugin App Group entitlement dosyasını
   otomatik oluşturur, ancak Apple Developer hesabında bu App Group'un
   (veya "Automatically manage signing" ile Xcode/EAS'in bunu oluşturmasına
   izin verilmesi) mevcut olması gerekir.
3. **EAS build / development build**: `eas build --profile development`
   (veya yerel `npx expo run:ios` / `npx expo run:android`, macOS ve
   Android Studio araç zinciri gerekir). CI'da widget'lı bir build henüz
   yok; `release.yml`'e eklenmedi çünkü mobil uygulamanın kendisi henüz
   store'a yayınlanmıyor (bkz. HANDOVER.md Backlog 3).
4. **Android**: ek bir hesap/kimlik gerekmez; `react-native-android-widget`
   bir development build ile çalışır (`npx expo run:android` veya EAS).

### Bilinen sınırlamalar / açık sorular

- iOS widget düzeni (`ios/nextSessionWidget.tsx`) bu ortamda gerçek bir
  Xcode derlemesiyle doğrulanamadı; `expo-widgets`'in `'widget'`
  direktifli fonksiyonları native SwiftUI'a çeviren derleme adımı yalnızca
  macOS + Xcode araç zincirinde çalışır. Kod, paketin TypeScript tip
  tanımlarına (`node_modules/expo-widgets/build/*.d.ts`) ve resmi API
  şekline göre yazıldı; ilk gerçek cihaz/simülatör derlemesinde küçük
  düzeltmeler gerekebilir.
- Widget'ların otomatik yenilenme sıklığı (iOS WidgetKit timeline, Android
  `updatePeriodMillis`) şu an minimum değerlerde bırakıldı; gerçek pil
  etkisi ölçülüp ayarlanmalı.
- `remainingUnits` alanı `TIME_UNLIMITED` paketlerde `null`; widget bunu
  "Sinirsiz" olarak gösteriyor, ürün metni onaylanmalı.
