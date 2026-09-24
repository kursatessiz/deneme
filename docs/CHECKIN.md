# Check-in Kiosku ve QR (W17)

Bu doküman tablet kiosk modunu, statik işletme/şube QR'ını ve üyenin dinamik
QR'ını açıklar. Uygulama: `apps/api/src/modules/checkin`.

**Kapsam dışı: turnike ve kapı entegrasyonu.** Bu özellik yalnızca bir
`Booking`'i `ATTENDED` işaretler; hiçbir fiziksel kilit, geçiş kontrol
sistemi veya donanım sürücüsüyle konuşmaz. "Check-in" burada her zaman
yazılımsal bir yoklama kaydıdır.

## Üç giriş yolu

1. **Statik nokta QR'ı** (`CheckInPoint`): girişte asılı bir poster. Üye
   kendi telefonuyla tarar, `POST /me/check-in/scan` çağrılır.
2. **Dinamik üye QR'ı**: üyenin uygulamasında ~45 saniyede bir yenilenen,
   60 saniye geçerli imzalı bir kod. Resepsiyon veya kiosk bunu tarar.
3. **Kiosk modu**: şubeye eşleştirilmiş bir tablet, kendi cihaz tokenıyla
   yalnızca kiosk uç noktalarını çağırabilir.

Üçü de aynı check-in çekirdeğini kullanır: `SchedulesService.checkInForMember`
(`apps/api/src/modules/schedules/schedules.service.ts`), personelin elle
check-in yaptığı `SchedulesService.checkIn`'den ayrı bir metottur çünkü QR/kiosk
akışında **yeniden tarama bir hata değildir** (aşağıya bakınız). Gelecekte
eklenecek gamification/otomasyon tetikleyicileri (W16 henüz yapılmadı) için
tek ortak nokta burasıdır.

## Check-in penceresi

Her stüdyonun `checkInWindowBeforeMinutes` / `checkInWindowAfterMinutes`
alanları vardır (varsayılan 30 / 15), `GET`/`PUT /studios/:studioId/check-in/window`
ile yönetilir (`studio.settings.manage`). Bir tarama, o an saatine göre
`[seans_başlangıcı - beforeMinutes, seans_başlangıcı + afterMinutes]`
aralığındaki `CONFIRMED` (veya zaten `ATTENDED`) bir rezervasyonu arar.

- Pencere dışında henüz gelmemiş bir rezervasyon varsa: "Check-in penceresi
  henüz açılmadı" (yalnızca önümüzdeki 4 saat içindeyse; daha uzak bir
  rezervasyon üyeyi yanıltmasın diye bu mesaj o ufkun dışında verilmez).
- Pencere kapanmış, geçmişte kalan bir rezervasyon varsa: "Check-in penceresi
  kapandı, resepsiyona danışın".
- Hiçbiri yoksa: genel "onaylı bir rezervasyonunuz yok" mesajı.

## Statik nokta QR'ı (`CheckInPoint`)

- Alanlar: `studioId`, `branchId`, `name`, `tokenHash` (SHA-256, ham kod
  saklanmaz), `isActive`.
- `POST /studios/:studioId/check-in/points` (`studio.settings.manage`) yeni
  bir nokta oluşturur; yanıt ham kodu **yalnızca bu çağrıda** içerir (192
  bit, `base64url`), aynı `invite`/`gift card` deseninde. Bu yanıttaki `url`
  alanı basılabilir QR payload'ıdır (madde 5, "printable"): posteri
  basmak/göstermek için başka bir uç noktaya gerek yoktur.
- `POST .../points/:id/rotate` eski posteri geçersiz kılıp yeni bir kod
  üretir (yine tek seferlik yanıt). Kaybolan/çalınan bir poster için tek
  kurtarma yolu budur; hash'ten ham kod geri hesaplanamaz.
- `PATCH .../points/:id {isActive}` bir noktayı geçici olarak devre dışı
  bırakır (poster hâlâ asılı ama artık çalışmıyor).
- `POST /me/check-in/scan {token}` üyenin kendi uç noktasıdır, `x-studio-id`
  gerektirmez: hangi stüdyoya ait olduğu token'ın kendisinden çözülür. Üyenin
  o stüdyoda aktif üyeliği yoksa "başka bir işletmeye ait" hatası döner
  (stüdyo id'sini sızdırmadan aynı 404/403 ayrımı `InvitesService`'teki
  gibi korunur).
- Redis varsa `POST /me/check-in/scan` kullanıcı başına 60 saniyede 12
  istekle sınırlıdır (`CheckInScanRateLimitGuard`); Redis yoksa sınır
  uygulanmaz (fail-open, düşük riskli bir uç nokta).

## Dinamik üye QR'ı

`apps/api/src/modules/checkin/dynamic-qr-token.ts`, JWT değil, HMAC-SHA256
imzalı, saf (side-effect'siz) bir token'dır:

- Anahtar, `JWT_SECRET`'ten ayrı bir amaç etiketiyle (`dynamic-member-qr:v1`)
  türetilir (`HMAC(JWT_SECRET, label)`), böylece bu kod hiçbir zaman bir
  erişim/yenileme/kiosk JWT'siyle karıştırılamaz ve `JwtAuthGuard`'dan
  geçemez (kendi `typ` alanı yok, imza biçimi tamamen farklı).
- İçerik: `membershipId`, `studioId`, `iat`, `nonce`. TTL 60 saniye
  (+ 5 saniyelik saat kayması payı).
- `POST /me/check-in/qr {studioId}` üyenin kendi uç noktasıdır; mobil
  uygulama bunu ~45 saniyede bir çağırıp QR'ı yeniler.
- `POST /studios/:studioId/check-in/member-qr {token, scheduleId?}`
  (`attendance.manage`) personelin tarama uç noktasıdır. `scheduleId`
  verilmezse ve birden fazla aday rezervasyon varsa, `resolved: false` ve
  `candidates` listesiyle döner; istemci üyenin bugünkü rezervasyonlarından
  birini seçtirir.
- Şubeye kısıtlı personel yalnızca `tenant.branchIds` içindeki şubelerin
  rezervasyonlarını görür/işler; kısıt dışı bir rezervasyon 403 döner.

### Tekrar oynatma (replay) koruması

Her `nonce`, `DynamicQrNonceStore` üzerinden bir kez "claim" edilebilir:

- `REDIS_URL` tanımlıysa `SET NX EX` ile Redis'te (API replikaları arasında
  paylaşılır).
- Tanımlı değilse bellek içi bir `Map`'e düşer (**yalnızca tek örnek**;
  Redis'siz çok replikalı bir üretim dağıtımında her replika kendi nonce
  kümesini tutar, bu da teorik olarak aynı QR'ın farklı replikalara aynı
  anda gönderilmesiyle iki kez kabul edilmesine izin verebilir --
  `REDIS_URL` üretimde zaten zorunlu olduğu için bu, tek-replikalı yerel
  geliştirme ve testler için kabul edilebilir bir ödünleşimdir).

Bir nonce ikinci kez görüldüğünde `409 Conflict` döner ("Bu QR kodu zaten
kullanıldı, üye ekranı yenilesin").

## Kiosk modu

`KioskDevice`: `studioId`, `branchId`, `name`, `pairingCodeHash` (SHA-256, tek
seferlik), `pairingCodeExpiresAt` (10 dakika), `pairedAt`, `lastSeenAt`,
`revokedAt`, `createdByUserId`.

1. `studio.settings.manage` yetkili personel `POST /studios/:studioId/kiosk-devices
   {branchId, name}` çağırır; yanıt 8 karakterlik, karışıklığa kapalı bir
   alfabeden (`A-HJ-NP-Z2-9`, `0/O` ve `1/I` yok) tek seferlik bir eşleştirme
   kodu döner.
2. Tablet `POST /kiosk/pair {pairingCode}` çağırır (herkese açık, IP başına
   60 saniyede 12 istekle sınırlı, Redis yoksa bellek içi yedek --
   `KioskPairRateLimitGuard`, fail-**kapalı**: bu uç nokta uzun ömürlü bir
   token dağıttığı için Redis'siz de sınırlı kalır). Karşılığında kiosk'a
   özel, uzun ömürlü (180 gün) bir JWT alır: `{ sub: deviceId, typ: "kiosk",
   studioId, branchId }`.
3. Kiosk uç noktaları (`GET /kiosk/sessions/today`, `POST /kiosk/check-in`)
   yalnızca `KioskAuthGuard`'ın kabul ettiği `typ: "kiosk"` token'ını kabul
   eder. `JwtStrategy` yalnızca `typ: "access"` kabul ettiği için bir kiosk
   token'ı normal hiçbir uç noktayı çağıramaz; tersine normal bir erişim
   token'ı da `KioskAuthGuard`'dan geçemez. İki token türü birbirinin
   yerine asla kullanılamaz.
4. `KioskAuthGuard` her istekte `KioskDevice.revokedAt`'i veritabanından
   kontrol eder: iptal, token süresi dolmadan **anında** etkilidir.
   `POST /studios/:studioId/kiosk-devices/:id/revoke` ile iptal edilir.
5. Her kiosk eşleştirmesi, iptali ve check-in'i `AuditLog`'a yazılır
   (`kiosk.device.pair`, `kiosk.device.revoke`, `kiosk.check-in`).

### Telefonun son 4 hanesi + PIN yedek girişi: kapsam dışı bırakıldı

Görev tanımı bunu "güvenli yapılabilirse" istiyordu. Güvenli bir tasarım,
kilitlenme/hız sınırı mantığının PIN doğrulaması ile aynı olmasını (bkz.
`AuthService` PIN kilitleme) ve kiosk'un genel bir üye arama uç noktasına asla
sahip olmamasını gerektirir -- son 4 hane tek başına küçük bir stüdyoda
üyeleri ayırt etmeye yetmeyebilir ve bir kiosk'un "telefon numarasına göre
üye ara" yetkisi vermesi, tarayıcı olmadan üye listesini teker teker
denemeyi mümkün kılar. Bu W17 kapsamında **uygulanmadı**; QR olmadan giriş
gerekiyorsa resepsiyonun elle check-in akışı (`PATCH
/schedules/check-in/:bookingId`) kullanılmaya devam eder.

## İzinler

Yeni bir izin anahtarı eklenmedi; mevcut katalogdan kullanılır:

- `attendance.manage`: dinamik QR ile personel taraması
  (`POST /studios/:studioId/check-in/member-qr`).
- `studio.settings.manage`: nokta/kiosk cihazı oluşturma, döndürme,
  devre dışı bırakma, iptal etme ve check-in penceresini değiştirme.
- `studio.settings.view`: check-in penceresini görüntüleme.

## Bilinen sınırlar

- Redis olmadan hem nonce tekrar-oynatma koruması hem de kiosk eşleştirme
  hız sınırı tek örnekle sınırlıdır (üretimde `REDIS_URL` zaten zorunlu).
- Kiosk telefon+PIN yedek girişi uygulanmadı (yukarıya bakınız).
- Gamification/otomasyon kancaları (W16) henüz mevcut olmadığından bu PR'da
  eklenmedi; `SchedulesService.checkInForMember` bunların gelecekte
  takılacağı tek yerdir.
