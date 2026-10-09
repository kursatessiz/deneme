# Web paneli (apps/web) mimarisi

Bu doküman web panelinin tamamını anlatır: W2.1 temeli (kimlik doğrulama,
oturum, izne göre menü, tema), W2.2 takvim, üye kartı, paket satışı ve
yoklama ekranları, W2.3 Ayarlar ekranları ve W2.4 finans, hakediş, rapor,
aday ve riskli üye ekranları.

## Neden BFF (Backend-for-Frontend)

`NEXT_PUBLIC_API_URL` build anında JS paketine gömülür; bu web panelinin
kimlik doğrulama jetonlarını tarayıcıda tutmasını (localStorage) gerektiriyordu
ve API'nin tarayıcıdan doğrudan erişilebilir olmasını zorunlu kılıyordu.
Bunun yerine web paneli artık kendi Next.js route handler'ları üzerinden bir
BFF proxy kullanır:

- `apps/web/src/app/api/bff/[...path]/route.ts` -- tek bir yakalayıcı (catch-all)
  route. Tarayıcıdan gelen her `/api/bff/<path>` isteğini, yalnızca sunucu
  tarafında bilinen sabit bir adrese (`API_INTERNAL_URL`, örn.
  `http://api:4000`) iletir. `path` segmentleri `sanitizeApiPath()`
  (`apps/web/src/lib/bff/path.ts`) ile doğrulanır: `..`, boş segment, `/`
  veya `\` içeren segment reddedilir -- istemci asla farklı bir host'a veya
  API'nin path uzayı dışına yönlendiremez.
- Erişim ve yenileme jetonları yalnızca httpOnly çerezlerdedir
  (`pw_access`, `pw_refresh`; bkz. `apps/web/src/lib/bff/cookies.ts`).
  Tarayıcı JS'i bu jetonları hiçbir zaman görmez. `auth/login`,
  `auth/otp/verify`, `auth/pin/login` ve `PUT auth/pin` (PIN değişikliği
  eski yenileme jetonunu iptal edip yeni bir çift döner) yanıtlarındaki
  `accessToken`/`refreshToken` alanları BFF tarafından çerezlere yazılır ve
  yanıt gövdesinden çıkarılır.
- Aktif işletme (`pw_studio`) ve aktif şube (`pw_branch`) seçimleri sır
  değildir; düz (httpOnly olmayan) çerezlerdir, böylece istemci tarafı da
  okuyup `x-studio-id` başlığını gönderebilir.
- 401 alan bir istek, `pw_refresh` çerezi varsa BFF içinde bir kez
  `/auth/refresh` ile yenilenir ve orijinal istek yeni jetonla tekrarlanır.
  Oturum çerezleri yalnızca yenileme ucu 401/403 döndüğünde temizlenir; 429,
  5xx veya API'ye ulaşılamaması durumunda çerezler korunur ve tarayıcı 429
  ya da 503 alır (`common.error.sessionRefreshUnavailable`). Korunan bir
  sayfaya erişim jetonu olmadan gelindiğinde middleware de aynı kuralı
  uygular: yenileme reddedilirse giriş sayfasına yönlendirir ve yenileme
  çerezini siler, geçici bir hatada çerezlere dokunmadan 503/429 döner
  (`apps/web/src/lib/bff/refresh.ts`).
- CSRF: her GET/HEAD/OPTIONS dışı çağrı, aynı origin'den gelen `Origin`
  başlığı ve özel `x-requested-with: platform-web` başlığı ister
  (`apps/web/src/lib/bff/csrf.ts`). Bu ikisi eksikse istek 403 ile reddedilir.
- Hop-by-hop başlıklar (`connection`, `transfer-encoding`, `cookie`,
  `authorization`, ...) iki yön arasında asla ham kopyalanmaz
  (`apps/web/src/lib/bff/headers.ts`); proxy bunları açıkça yeniden kurar.

Herkese açık rezervasyon sayfası (`apps/web/src/app/(app)/(public)/booking/[studioSlug]/book/page.tsx`,
T6) gömülebilir widget ile aynı kimliksiz, salt okunur embed uç noktalarını
(`config`, `branches`, `service-types`, `schedules`) `apps/web/src/lib/public-booking.ts`
üzerinden çağırır: işletme adı, logosu ve markası config'ten, hizmet türleri,
şubeler ve önümüzdeki 14 günün kalan kontenjanlı seansları API'den gelir;
tarih ve saatler `Intl` ile etkin dilde, tüm metin `booking.*` i18n anahtarlarıyla
yazılır ve dil seçici çerez modunda çalışır. Sayfa rezervasyon oluşturmaz
(kimliksiz yazma ucu yoktur): üye "uygulamada rezervasyon yapacağım" ile mobil
uygulamanın seans ekranına derin bağlantı açar, ilk kez gelen ziyaretçi herkese
açık aday formunu gönderir. Sabit örnek veri yoktur. Playwright:
`apps/web/e2e/public-booking.e2e.ts`.

Tarayıcının doğrudan çağırdığı kimliksiz herkese açık uç noktalar (embed
widget'ı `apps/web/src/app/(app)/embed/[studioSlug]/page.tsx`, sayfa motorunun
aday formu, ziyaretçi izleme ve reklam pikseli ayarı) jeton taşımaz ve API
adresini **çalışma anında** alır (D1): sunucu tarafı (`middleware.ts`, sunucu
bileşenleri) `PUBLIC_API_URL` ortam değişkenini okur, kök layout bu değeri
`<meta name="platform-public-api-url">` etiketine yazar ve istemci kodu
`apps/web/src/lib/public-api-url.ts` içindeki `publicApiBaseUrl()` ile istek
anında okur (satır içi script yok, nonce CSP etkilenmez; herkese açık
sayfaların `connect-src` listesine bu origin eklenir). Böylece commit başına
bir kez build edilen aynı image hem preprod hem production'da çalışır.
`NEXT_PUBLIC_API_URL` artık yalnızca yerel geliştirme yedeğidir; production
image'ında hiçbir şey ona dayanmaz. Embed CSP için stüdyo bilgisi iç ağdan
(`API_INTERNAL_URL`) okunur.

## Sunucu ortam değişkenleri

`apps/web/src/lib/server-env.ts`, Zod ile doğrulanan tek sunucu-taraflı env
modülüdür:

- `API_INTERNAL_URL` (zorunlu üretimde, varsayılan `http://localhost:4000`
  yerel geliştirmede): API'nin docker ağı içindeki adresi. `NEXT_PUBLIC_`
  öneki yoktur, bu yüzden istemci paketine asla gömülmez.

`deploy/docker-compose.prod.yml`, `web` servisini `internal_net`'e de bağlar
ve `API_INTERNAL_URL=http://api:4000` verir; `web`'in dışarıya açık tek
portu yine 3000'dir, API'ye erişimi yalnızca iç ağ üzerindendir.

## Oturum

- `apps/web/src/lib/session/server-session.ts` -- sunucu bileşenlerinde
  (`(dashboard)/layout.tsx`) çalışır: `pw_access` çerezini okur, API'nin
  `GET /auth/me` uç noktasını çağırır, aktif işletmeyi (`pw_studio` çerezi
  veya ilk aktif üyelik) ve aktif şubeyi (`pw_branch`) belirler. Oturum yoksa
  `null` döner ve layout `/giris`'e yönlendirir.
- `apps/web/src/middleware.ts` -- korunan sayfalara (`/dashboard`,
  `/calendar`, `/members`, `/packages`, `/trainers`) erişimde `pw_access`
  çerezinin varlığına bakar; jetonun geçerliliği yine sunucu bileşeninde
  `GET /auth/me` ile doğrulanır. `/embed/<slug>` için mevcut
  `frame-ancestors` CSP mantığı olduğu gibi korunur.
- `apps/web/src/components/session/DashboardSessionProvider.tsx` -- istemci
  bileşenlerinin (sayfalar) aktif işletme id'sine ve etkin izin kümesine
  erişmesini sağlayan bir React context.
- `apps/web/src/lib/session/client.ts` (`bffFetch`) -- istemci
  bileşenlerinin API ile konuştuğu tek yol; her zaman `/api/bff/...`
  üzerinden, aynı origin, çerez tabanlı kimlik doğrulamayla.

## İzne göre menü ve sayfa koruması

`apps/web/src/lib/nav.ts` tek nav yapılandırmasıdır: her giriş bir route'u
`packages/shared/src/permissions.ts` kataloğundaki izin anahtarlarına
eşler. `filterNavByPermissions()` menüde neyin görüneceğine karar verir
(`Sidebar.tsx`), `hasAnyPermission()` ise sayfa seviyesinde kullanılır
(`components/common/PageGuard.tsx`): izin yoksa sayfa içeriği yerine
`Forbidden` (403) görünümü render edilir. İşletme sahibi (`isOwner`) her
zaman her şeyi görür.

## Tema

Tasarım sistemi Perfect UI'dır; token'lar, bileşen kütüphanesi ve kurallar
için bkz. `docs/TASARIM.md`. Özet:

`(dashboard)/layout.tsx`, aktif üyeliğin `theme` alanını (işletmenin
`themePrimary`/`logoUrl`'si; saklanan `themeFamily` ve `gradientPresetKey`
kabul edilir ama çizimi değiştirmez) ve kullanıcının `appearance` tercihini
(`GET /auth/me` yanıtındaki `appearance`, `GET /me/appearance` ile aynı veri)
`ThemeRoot` bileşenine geçirir. `ThemeRoot` `resolveTheme()`/
`themeCssVariables()` (packages/shared) ile `--pui-*` değişkenlerini (işletme
rengi `--pui-theme`) ve eski `--color-*` takma adlarını yalnızca dashboard alt
ağacına uygular; modu sarmalayıcıda `data-pui-mode` ve `color-scheme` ile
taşır (sistem seçiminde işletim sistemini izler). Herkese açık rezervasyon
sayfası ve embed widget'ı kendi temasını kendi kiracısından çözer; süper
admin ve pazarlama panelleri `AdminTheme` ile kit varsayılanlarını ve
platform kiracısının rengini alır.

Kit CSS'i `app/(app)/layout.tsx` içinde bir kez, `globals.css`'ten sonra içe
aktarılır (katman sırası `globals.css`'in ilk satırındadır); Tailwind
preflight'ı kapalıdır ve yalnızca yerleşim için kullanılır. Yazı tipi Inter
`@fontsource/inter` ile derlemeye gömülür (latin ve latin-ext, 400-700);
derleme sırasında ağ erişimi, çalışma zamanında Google Fonts isteği yoktur.
Gradyan yalnızca üye kartı ve paket kartında (`ui-gradient-member-card`,
`ui-gradient-package-card`) kullanılır; birincil butonlar ve kabuk düzdür.
Üst bardaki kullanıcı menüsünde "Koyu mod" anahtarı (`PUT /me/appearance`)
vardır; çıkış butonu menünün dışında, her zaman görünür kalır.

## Takvim, üye kartı, paket satışı, yoklama (W2.2)

- `/calendar` -- gün/hafta/ay görünümü (`lib/calendar/range.ts`: her görünüm
  için sorgu aralığı, ay görünümü tam haftalara genişler). Şube, kaynak,
  eğitmen ve hizmet türü filtreleri `GET /schedules/studio/:studioId`
  sorgusuna (`branchId`/`resourceId`/`trainerId`) veya istemci tarafı
  filtrelemeye (`serviceTypeId`) gider. Gün/hafta ızgarası
  (`components/calendar/CalendarBoard.tsx`) saati piksele eşler; bir seans
  bloğu `draggable`, native HTML5 sürükle-bırak olayları (`onDragStart`/
  `onDragOver`/`onDrop`) yeni saati `lib/calendar/range.ts`'deki
  `snapToSlot()` ile 5 dakikaya yuvarlar. Bırakma anında önce yerel state
  iyimser olarak güncellenir, ardından `PATCH /schedules/:scheduleId`
  çağrılır; istek başarısız olursa önceki state'e geri dönülür. Seçili
  seans, tablet/masaüstünde takvimin yanında iki panelli düzende
  (`SessionDetailPanel`) açılır: roster, kontenjan, bekleme listesi
  (`GET /schedules/waitlist/:scheduleId`), giriş yap/gelmedi/rezervasyon
  iptali/seansı iptal et/eğitmen ikamesi, hepsi ilgili izinle gizlenen
  (`PermissionButton`) aksiyon düğmeleri. Yeni seans formu
  (`SessionForm.tsx`) `CreateScheduleSchema`, düzenleme formu
  (`EditSessionForm.tsx`) yeni eklenen `UpdateScheduleSchema` ile doğrulanır
  (`packages/shared`).
- `/members/[memberId]` -- üye kartı: profil, iletişim (`members.contact.view`
  ile maskelenir), ana şube, aktif paketler (kalan birim, bitiş tarihi,
  dondur/dondurmayı kaldır -- yeni `POST /members/packages/:packageId/unfreeze`
  uç noktası), rezervasyon geçmişi, katılım istatistiği, ödemeler, notlar,
  W12 churn risk rozeti (`GET /churn/studio/:id/members/:memberId`, henüz
  puan hesaplanmamışsa bölüm sessizce gizlenir), `isPartnerGuest` etiketi,
  W17 oyunlaştırma özeti (`GET /gamification/studio/:id/achievements`
  listesinden üyeye göre filtrelenir). `/members` listesine arama
  (`?search=`) ve ana şube filtresi eklendi, satırlar üye kartına bağlanır.
- Paket satışı: üye kartından `PackageSaleDialog.tsx`,
  `POST /payments/sell` ile fiyat, promosyon kodu, hediye kartı,
  nakit/kart/havale ödeme yöntemini gönderir; satış tamamlanınca W8'in
  otomatik kestiği faturayı bulmak için `GET /invoices?from=<bugün>`
  sorgusu `paymentId` ile eşleştirilir (yalnızca `finance.view` varsa).
- `/attendance` -- resepsiyon için bugünün seanslarında tek dokunuşla giriş
  listesi (`PATCH /schedules/check-in/:bookingId`); takvim panelinden de
  bir düğmeyle açılır.
- Yeni API uç noktaları (ikisi de e2e testli,
  `apps/api/test/e2e/web-panel-2-2.e2e-spec.ts`): `PATCH /schedules/:scheduleId`
  (`schedule.manage`, `UpdateScheduleSchema`, aynı çakışma/şube kontrolleri
  seans oluşturmadaki gibi) ve `POST /members/packages/:packageId/unfreeze`
  (`packages.sell`, açık dondurma kaydını kapatır, `endDate`'i kullanılmayan
  dondurma süresi kadar kısaltır).

### Paket dondurma, seans programı ve rezervasyon kuralları (düzeltmeler)

- **Dondurma**: yalnızca `ACTIVE` paket dondurulabilir (`FROZEN`, `EXPIRED`,
  `DEPLETED` reddedilir). Geçiş koşullu `updateMany` ile yapılır, çift
  gönderim `endDate`'i iki kez uzatmaz. `freezeDaysAllowed` paketin ömrü
  boyunca kümülatiftir: önceki dondurmalar (erken kaldırılanlar fiili
  süreleriyle) `packageFreezeHistory` üzerinden toplanır. `frozenUntil`
  geçen paketleri 15 dakikalık kalp atışı (`MembersService.releaseElapsedFreezes`)
  `ACTIVE` durumuna ve `frozenUntil = null` değerine döndürür; `endDate`
  dondurma başlarken zaten uzatılmıştır.
- **Haftalık tekrar**: tekrarlanan seanslar şube (yoksa işletme) saat diliminde
  aynı yerel saatte kurulur; yaz/kış saati değişiminde saat kaymaz
  (`addZonedDays`, `packages/shared`).
- **Çakışma kontrolü**: seans oluşturma, taşıma ve eğitmen ikamesi işletme
  başına `pg_advisory_xact_lock` altında, çakışma kontrolü işlemin içinde
  yapılır; eşzamanlı iki oluşturma aynı eğitmeni/odayı çift rezerve edemez
  (biri `409` alır). Şema değişikliği yoktur.
- **Seans taşıma**: `PATCH /schedules/:id` ile zaman değişince seansın
  rezervasyonlarındaki yer/ekipman tutmaları (`BookingResource`) aynı
  işlemde yeni saate taşınır; dışlama kısıtı ihlali `409` döner. Kapasite
  artırılırsa bekleme listesi hemen doldurulur.
- **Rezervasyon zamanı**: üye kendi rezervasyonunu başlamış bir seansa
  yapamaz; personel (resepsiyon, `bookings.manage`) devam eden bir seansa
  walk-in rezervasyon yapabilir ama bitmiş seansa yapamaz (geçmiş yoklama
  düzeltmesi rezervasyon değil `attendance.manage` ile yapılır).
- **Asgari tekrar aralığı**: hizmetin `minRepeatIntervalDays` değeri varsa
  üyenin aynı hizmette `CONFIRMED`/`ATTENDED` bir rezervasyonu seans başlangıcının
  her iki yanında N günden yakınsa rezervasyon reddedilir (bekleme listesinden
  terfi de aynı kuralı geçer; terfi edemeyen kayıt gerekçesiyle `EXPIRED` olur).
  `NO_SHOW` rezervasyonlar kurala **sayılmaz**; ancak aralıkta gelinmeyen bir seans varsa rezervasyon
  başarılı olur ve yanıt `notices: [{ code: 'apiTexts.schedules.noShowInWindowNotice', message, params: { date } }]`
  taşır (metin `Accept-Language` diliyle; boşsa `notices: []`). İstemci bunu engelleyici olmayan bir bilgi
  olarak gösterir.
- **Personel aşımı**: kural reddettiğinde `400` yanıtı `code: 'apiErrors.schedules.minRepeatIntervalNotElapsed'`
  ve `params: { count, date }` taşır (`date`, çakışan seansın ISO başlangıcı). `bookings.manage` sahibi personel
  `POST /schedules/book` gövdesine `overrideRepeatInterval: true` ekleyerek rezervasyonu yine de yapabilir;
  bu durumda `AuditLog` satırı `booking.repeat_interval_override` yazılır (`entityId` yeni rezervasyon;
  `metadata`: `serviceTypeId`, `memberId`, `scheduleId`, `conflictingBookingId`, `conflictingSessionStart`,
  `minRepeatIntervalDays`). Üye (`POST /schedules/book/self`) bayrağı gönderirse `403`
  (`apiErrors.schedules.repeatOverrideNotAllowed`) alır; bekleme listesi terfisi (sistem) kuralı aşamaz.
  Not: web panelinde henüz personel rezervasyon ekranı ve hizmet türü formu yoktur; onay penceresi
  (`useConfirm`) ve form yardım metni bu ekranlar eklenirken `mWalkIn.repeatOverride.*` ile aynı
  anlamda eklenmelidir. Mobil personel akışı `docs/MOBILE_APP.md` içinde anlatılır.

## Finans, hakediş, raporlar, adaylar, riskli üyeler (W2.4)

- `/finans` -- sekmeli tek sayfa (`components/finance/*Tab.tsx`): Ödemeler
  (tarih aralığı/yöntem/durum/şube filtresi, `finance.manage` ile kısmi/tam
  iade onaylı diyalogla, bekleyen havale ödemeleri için `POST
  /payments/bank-transfer/confirm`; üye sütunu artık kısaltılmış UUID yerine
  görünen adı gösterir -- `PaymentDTO.memberDisplayName`, `members.contact.view`
  yoksa ad + soyadın ilk harfi (`maskLeaderboardName`), varsa tam ad --
  e2e testli), Giderler (liste/oluştur/sil; API'de yeni
  `apps/api/src/modules/expenses` modülü -- `Expense` modeli şemada zaten
  vardı, migration gerekmedi -- `GET /expenses/studio/:studioId`
  `finance.view`, `POST /expenses` ve `DELETE /expenses/:id/studio/:studioId`
  `finance.manage`, her yazma `audit_logs`'a düşer), Faturalar (durum
  filtresi, `FAILED` için `POST /invoices/:id/retry`, `GET /invoices/export`
  BFF üzerinden CSV indirme bağlantısı), Promosyon ve Hediye Kartı (promosyon
  kodu oluşturma/aç-kapa, hediye kartı listesi ve bakiyesi; yeni kart kesme
  akışı üye kartındaki paket satışı diyaloguna gömülüdür, burada yalnızca
  yönetim listesi vardır).
- `/finans/bordro` -- W14 bordro uç noktalarına bağlanır: `payroll.manage`
  veya `commissions.view.all` iznine sahip personel dönem taslağı
  oluşturur/yeniden hesaplar, satır bazlı manuel düzeltme yapar, onaylar,
  ödendi işaretler, CSV indirir (`components/finance/PayrollRuns.tsx`);
  yalnızca `commissions.view.own` iznine sahip bir eğitmen aynı rotada kendi
  onaylı/ödenmiş satırlarını görür (`components/finance/PayrollMyLines.tsx`,
  `GET /payroll/studio/:studioId/me/lines`).
- `/raporlar` -- sekmeli: Doluluk (hizmet türüne göre çubuk, gün x saat ısı
  haritası, güne göre tablo), Gelir (granülerlik seçilebilir dönem çubuğu,
  yönteme ve pakete göre kırılım, brüt/iade/net), Üyeler (KPI kutuları),
  Yenileme (oran çubuğu), Kohortlar (ay x ay elde tutma matrisi, tarih
  filtresi almaz), Eğitmenler (performans tablosu). Şube ve tarih aralığı
  filtreleri (kohort hariç) ve `?format=csv` ile BFF üzerinden CSV indirme
  her sekmede ortak. Grafik kütüphanesi kullanılmaz: `components/reports/Bar.tsx`
  yalnızca CSS ile çizilen basit çubuk ve KPI kutusu, ısı haritası ve kohort
  matrisi inline `div` ızgarasıdır (CLAUDE.md tasarım kuralı: iç içe kart
  yok, jenerik "AI dashboard" görünümünden kaçınma).
- `/adaylar` -- W11 aşamalarına göre pano (`NEW/CONTACTED/TRIAL_BOOKED/
  TRIAL_DONE/WON/LOST` sütunları), aday kartına tıklayınca detay çekmecesi
  (`components/leads/LeadDetailDrawer.tsx`): geçmiş, not ekleme, izin verilen
  aşama geçişleri (`LEAD_STAGE_TRANSITIONS`, `packages/shared`), üyeliğe
  dönüştürme, deneme dersi planlama (`POST /leads/:id/trial`): elle seans
  kimliği girmek yerine önümüzdeki 14 gün içindeki uygun seansları listeleyen
  bir seçici (`GET /schedules/studio/:studioId`'den, aday şubesine göre
  filtreli, iptal edilmiş ve dolu seanslar elenir; saf filtre fonksiyonu
  `apps/web/src/lib/leads/trial-sessions.ts`, birim testli).
- `/riskli-uyeler` -- W12 churn uç noktalarına bağlanır: seviye başına özet
  (güncel ve geçen haftaki sayı), filtreli liste (seviye/şube/arama/ertelenmiş
  dahil), her üyenin ilk üç risk gerekçesi, "Görüşüldü" (not zorunlu) ve
  "N gün ertele" aksiyonları, elle yeniden hesaplama, BFF üzerinden CSV.
- Tüm CSV/PDF indirmeleri (`invoices/export`, raporlar `?format=csv`,
  `churn/.../members?format=csv`, `payroll/.../export.csv`) tarayıcıdan
  doğrudan `/api/bff/...` bağlantısına gider: BFF, JSON olmayan yanıtları
  (Content-Type, Content-Disposition dahil) baytı baytına ve hop-by-hop
  olmayan tüm başlıklarıyla olduğu gibi iletir (`apps/web/src/lib/bff/
  proxy-response.ts`, `apps/web/src/app/api/bff/[...path]/route.ts`), token
  yalnızca httpOnly çerezde kalır. `proxy-response.spec.ts` bu davranışı
  birim testler.
- Para tutarları her zaman API'nin ondalık dizgisinden
  `apps/web/src/lib/money.ts` (`formatMoney`) ile, yalnızca görüntüleme için
  `Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' })`
  kullanılarak biçimlendirilir; istemci tarafında toplama gereken tek yer
  (gider listesi toplamı) `sumMoney()` ile tam sayı (BigInt) kuruş toplamı
  yapar, kayan noktalı toplama hiçbir yerde kullanılmaz. Tarih aralığı ön
  ayarları (`bugün/bu hafta/son 7 gün/bu ay/son 30 gün/bu yıl`)
  `apps/web/src/lib/date-range.ts`'dedir, rapor/finans/churn filtrelerinin
  hepsi aynı `components/common/DateRangeFilter.tsx` ve
  `components/common/BranchSelect.tsx`'i paylaşır.

## Genel bakış kartları

Sahibin isteği: işletmenin genel bakış sayfası (`/dashboard`) sürükle bırak
kartlardan oluşan bir panodur; sağ üstte "Kart ekle" ile genel kartların
kataloğu açılır, kartlar ızgarada taşınır, büyütülüp küçültülür ve her kartın
içeriği bozulmasın diye büyüme ve küçülme sınırları vardır. Mobil uygulamadaki
karşılığı `docs/MOBILE_APP.md` "Genel bakış panosu (mobil)" bölümündedir.

**Tek doğruluk kaynağı** `packages/shared/src/dashboard`:
`DASHBOARD_GRID` (12 sütun, 72 px satır, 16 px boşluk (`spacing[4]`), en fazla
30 kart), `DASHBOARD_WIDGETS` (katalog: kategori, başlık ve açıklama anahtarı,
gereken izinler, boyut sınırları, tekil/çoklu, dönem ayarı),
`DashboardLayoutSchema` (saklanan düzen), `DashboardDataRequestSchema` ve kart
verisi DTO'ları, saf ızgara motoru (`clampToWidget`, `moveItem`, `nudgeItem`,
`resizeItem`, `compact`, `placeNewItem`, `scaleForColumns`, `reorderItem`) ve
rol bazlı varsayılan pano (`buildDefaultDashboardLayout`). Dönemler işletmenin
saat diliminde hesaplanır (`dashboardPeriodRange`): Bugün (gece yarısından
beri, dünün aynı saatine kadarki bölümle karşılaştırılır), Bu hafta
(pazartesiden beri), Bu ay (ayın 1'inden beri, geçen ayın aynı gününe kadar),
Son 30 gün (önceki 30 günle).

### Katalog

Boyutlar 12 sütunlu ızgarada "sütun x satır"dır. İzin sütunundaki her izin
gerekir; işletme sahibi her kartı görür.

| Kart | Anahtar | Kategori | İzin | En küçük | En büyük | Varsayılan | Panoda | Dönem |
|------|---------|----------|------|----------|----------|------------|--------|-------|
| Ciro | `revenue` | Göstergeler | `reports.view` | 2x2 | 4x3 | 3x2 | çoklu | Bugün, Bu hafta, Bu ay, Son 30 gün (varsayılan: Bu ay) |
| Aktif üye sayısı | `activeMembers` | Göstergeler | `reports.view` | 2x2 | 4x3 | 3x2 | tek | - |
| Yeni üyeler | `newMembers` | Göstergeler | `reports.view` | 2x2 | 4x3 | 3x2 | çoklu | Bugün, Bu hafta, Bu ay, Son 30 gün (varsayılan: Bu ay) |
| Büyüme hızı | `memberGrowth` | Göstergeler | `reports.view` | 2x2 | 4x3 | 3x2 | çoklu | Bu hafta, Bu ay, Son 30 gün (varsayılan: Bu ay) |
| Doluluk oranı | `occupancy` | Göstergeler | `reports.view` | 2x2 | 4x3 | 3x2 | çoklu | Bugün, Bu hafta, Bu ay, Son 30 gün (varsayılan: Bu hafta) |
| Bugünkü seanslar | `todaySessions` | Göstergeler | `schedule.view` | 2x2 | 4x3 | 3x2 | tek | - |
| Yenileme oranı | `renewalRate` | Göstergeler | `reports.view` | 2x2 | 4x3 | 3x2 | çoklu | Bu ay, Son 30 gün (varsayılan: Son 30 gün) |
| Riskli üyeler | `churnRisk` | Göstergeler | `reports.view` | 2x2 | 4x3 | 3x2 | tek | - |
| Yeni adaylar | `newLeads` | Göstergeler | `leads.view` | 2x2 | 4x3 | 3x2 | çoklu | Bugün, Bu hafta, Bu ay, Son 30 gün (varsayılan: Bu hafta) |
| Ciro trendi | `revenueTrend` | Grafikler | `reports.view` | 4x3 | 12x6 | 6x4 | çoklu | Bu hafta, Bu ay, Son 30 gün (varsayılan: Son 30 gün) |
| Doluluk trendi | `occupancyTrend` | Grafikler | `reports.view` | 4x3 | 12x6 | 6x4 | çoklu | Bu hafta, Bu ay, Son 30 gün (varsayılan: Son 30 gün) |
| Üye büyüme grafiği | `memberGrowthChart` | Grafikler | `reports.view` | 4x3 | 12x6 | 6x4 | tek | - |
| Bugünün programı | `todaySchedule` | Tablolar | `schedule.view` | 4x4 | 12x8 | 6x5 | tek | - |
| Yaklaşan seanslar | `upcomingSessions` | Tablolar | `schedule.view` | 4x4 | 12x8 | 6x5 | tek | - |
| Son ödemeler | `recentPayments` | Tablolar | `finance.view` | 4x4 | 12x8 | 6x5 | tek | - |
| Süresi dolan paketler | `expiringPackages` | Tablolar | `members.view` | 4x4 | 12x8 | 6x5 | tek | - |
| Eğitmen performansı | `trainerPerformance` | Tablolar | `reports.view` | 4x4 | 12x8 | 6x5 | çoklu | Bu hafta, Bu ay, Son 30 gün (varsayılan: Bu ay) |
| Haftalık takvim | `weekCalendar` | Takvim | `schedule.view` | 6x4 | 12x8 | 8x5 | tek | - |
| Şubeler | `branches` | İşletme | yok (her üyelik) | 3x3 | 8x6 | 4x4 | tek | - |
| Stoku azalan ürünler | `lowStock` | İşletme | `retail.view` | 3x3 | 8x6 | 4x4 | tek | - |
| Yaklaşan etkinlikler | `upcomingEvents` | İşletme | `events.view` | 3x3 | 8x6 | 4x4 | tek | - |
| Hızlı işlemler | `quickActions` | İşletme | yok (her üyelik) | 6x1 | 12x3 | 12x1 | tek | - |

Ciro iadeler düşülmüş net tutardır (gelir raporunun "net" satırı) ve her
zaman işletmenin para birimiyle gösterilir. Büyüme hızı (katılan - ayrılan) /
dönem başındaki üye sayısıdır (`memberGrowthRate`). Riskli üyeler kartı da
seçili şubeye göre süzülür: `ChurnService.summary(tenant, branchId)` yalnızca
ana şubesi (`homeBranchId`) o şube olan aktif üyeleri sayar (üye listesi ve
diğer şube süzgeçleriyle aynı tanım); şube verilmezse personelin şube
kapsamındaki tüm üyeler sayılır ve çağıranın şube kısıtı her durumda geçerlidir.

**Varsayılan pano** tek bir sıralı listeden (`DASHBOARD_DEFAULT_ORDER`)
üyeliğin görebildiği kartlarla kurulur: sahip için hızlı işlemler, ciro,
aktif üye, doluluk, bugünkü seanslar, bugünün programı, şubeler, ciro ve
doluluk trendi, son ödemeler, stok ve etkinlikler; resepsiyon için hızlı
işlemler, bugünkü seanslar, yeni adaylar, program, ödemeler, süresi dolan
paketler, haftalık takvim, stok ve etkinlikler; eğitmen için hızlı işlemler,
bugünkü seanslar, program, şubeler ve haftalık takvim.

### Etkileşim

- Başlığın sağında "Kart ekle" (birincil), "Düzenle"/"Bitti" ve "Diğer
  işlemler" menüsünde "Varsayılana dön" (onaylı) vardır.
- Kart ekle diyaloğu kartları kategoriye göre gruplar, arama yapılabilir; her
  satırda başlık, kısa açıklama ve varsayılan boyut görünür. Üyeliğin görme
  izni olmayan kartlar listelenmez; panoda zaten olan tekil kartlar devre dışı
  ve "Panoda zaten var" notuyla görünür; 30 kartta ekleme kapanır. Eklenen
  kart ilk uygun boşluğa yerleşir, görünür alana kaydırılır ve odak alır.
- Sürükleme ve boyutlandırma yalnızca düzenleme modunda ve geniş ekranda
  çalışır (yanlışlıkla taşımayı önlemek için); düzenleme dışında pano
  durağandır. Kart başlığındaki tutamaktan sürüklenir; hedef hücre kesik
  çizgili yer tutucuyla gösterilir, diğer kartlar aşağı itilir ve boşluklar
  yukarı kapanır. Sağ alt köşeden boyutlandırılır; boyut ızgara birimine
  oturur ve kartın en küçük ve en büyük sınırında durur (sınıra dayanınca
  kart uyarı renginde çerçevelenir, anlık boyut köşede yazar). İşaretçi
  olayları (fare, dokunma, kalem) ve işaretçi yakalama kullanılır; konum
  hesabı her animasyon karesinde bir kez yapılır, ızgara hareket başında bir
  kez ölçülür. Escape sürüklemeyi iptal eder.
- Başlık alanının üzerine fare gelince (veya başlık içinde klavye odağı
  olunca) kartın sağ üst köşesinde küçük bir kapatma düğmesi (X) belirir;
  "..." menüsü onun soluna kayar. Düzenleme modu gerekmez, normal
  görünümde de çalışır. Düğme yalnızca `@media (hover: hover)` cihazlarda
  hover ile görünür (`ui-dash-close`, yeri ayrılı olduğundan başlık
  kaymaz); yalnızca dokunmatik cihazlarda gizlidir ve kaldırma kartın
  menüsünden yapılır. Erişilebilir adı "{başlık} kartını kaldır"dır ve odak
  alınca görünür. Tıklayınca kart onay sorulmadan kaldırılır (iyimser
  güncelleme, 800 ms sonra tek PUT, `aria-live` duyurusu); ekranda yaklaşık 6
  saniye "Kart kaldırıldı" ve "Geri al" içeren bir bildirim kalır. "Geri al"
  kartı eski konumuna koyar (`restoreItem`: aralarda o yere gelen kartlar
  aşağı itilir) ve bekleyen kayıt geri yüklenen düzeni saklar. Düğmeye
  basmak sürüklemeyi başlatmaz (sürükleme yalnızca tutamaktandır).
- Kartın menüsünde dönem seçimi (dönemi olan kartlarda her zaman), düzenleme
  modunda ayrıca "Yukarı taşı", "Aşağı taşı" ve "Kartı kaldır" vardır. Menüdeki "Kartı kaldır" ve Delete tuşu önce "Kartı kaldırmak istediğinize emin misiniz?" diye sorar; kart yalnızca onaydan sonra kalkar.
- Ekran genişliği 1280 px ve üstünde 12 sütun; 768-1279 px arasında 6 sütun
  (tablet düzeni); 768 px altında tek sütun (kartlar okuma sırasıyla alt alta,
  tam genişlik). Tablet düzeninde boyutlandırma yoktur; her kart saklanan
  12 sütunluk genişliğinden türetilen 2, 4 veya 6 sütun kaplar
  (`tabletLayout`, `packages/shared/src/dashboard/engine.ts`): genişlik 4 ve
  altı 2, 8 ve altı 4, daha fazlası 6 olur ve kartın kendi alt sınırının
  (katalog `minW`: 3 ve altı 2, 4 ise 4, 6 ise 6 sütun; yani göstergeler ve
  listeler 2, grafikler ve tablolar en az 4, haftalık takvim ve hızlı
  işlemler 6) altına inmez. Yükseklik saklanan değerdir, kartın sınırlarına
  kırpılır. Kartlar saklanan okuma sırasıyla ilk boş yuvaya yerleşir; böylece
  sonraki daha dar bir kart öncekinin yanındaki boşluğu doldurur ve
  sığabilecek bir kart için delik kalmaz. Dar ekranlar yalnızca türetilmiş
  görünümdür, saklanan düzen her zaman 12 sütunludur; burada sürükleme ve
  boyutlandırma (tutamaçlar dahil) kapalıdır, sıra menüden veya klavyeden
  değişir.

### Klavye ve ekran okuyucu

Düzenleme modunda her kart odaklanabilir (`tabIndex=0`) ve açıklaması klavye
kısayollarını anlatır:

| Tuş | Geniş ekran | Dar ekran |
|-----|-------------|-----------|
| Ok tuşları | Kartı bir birim taşır (yerçekimi geri alırsa bir sonraki konuma kadar) | Yukarı/aşağı sırayı değiştirir |
| Shift + ok tuşları | Bir birim büyütür/küçültür, sınırda durur | Yok (duyurulur) |
| Delete / Backspace | Kaldırma onayını açar | Aynı |
| Escape | Süren sürüklemeyi iptal eder | Aynı |

Her taşıma, boyutlandırma, ekleme, kaldırma ve sınıra ulaşma `aria-live`
bölgesinde duyurulur ("Ciro: sütun 2, satır 2."). Bütün düğmelerin
erişilebilir adı vardır; kartlar başlıklarıyla adlandırılmış bölgelerdir.

### Kalıcılık ve veri

- `GET /studios/:studioId/dashboard/layout`: kayıtlı düzen veya rol bazlı
  varsayılan (`customized: false`); görülemeyen kartlar çıkarılır.
- `PUT` aynı yol: `DashboardLayoutSchema` ile doğrulanır (bilinmeyen kart,
  ikinci tekil kart, sağ kenarı aşan kart, kesirli konum, kartın sunmadığı
  dönem, 30'dan fazla kart 400 döner); sınır dışı boyutlar kırpılır, çakışan
  kartlar sıkıştırılarak düzeltilir, görülemeyen kartlar çıkarılır, kayıt
  `dashboard.layout.update` olarak denetim kaydına yazılır.
- `DELETE` aynı yol: varsayılana döner (`dashboard.layout.reset`).
- `POST /studios/:studioId/dashboard/data`: `{ widgets: [{ id, widget,
  settings }], branchId? }`; her kartın izni ayrı denetlenir, izinsiz kart tüm
  isteği düşürmek yerine `forbidden` döner. Her sorgu `studioId` ve personelin
  şube kapsamıyla (verilmişse seçili şubeyle) süzülür; başka işletmenin şubesi
  404 döner. Veri mevcut servislerden gelir (`ReportsService`,
  `BranchesService`, `ChurnService`, `RetailCatalogService`); hiçbir servisin
  vermediği yerlerde (günün seansları ve sayıları, son ödemeler, süresi dolan
  paketler, yeni adaylar, aylık katılım, yaklaşan etkinlikler) ince sorgular
  vardır. Sonuçlar API sürecinde 45 saniye önbelleklenir (işletme, şube,
  personel kapsamı, kart ve dönem anahtarıyla).
- Dört uç nokta da `dashboard.view` izni ister. Bu izin yeni eklendi:
  varsayılan resepsiyon ve eğitmen rollerinde vardır, sahip her izne zaten
  sahiptir, migration mevcut tüm üye dışı rollere ekler; işletmenin sonradan
  oluşturduğu rollere rol düzenleyicisinden ("Genel bakış" alanı) verilir.
  Yazma uçları faturalama kısıtlı modunda da açıktır (kişisel ekran tercihi
  ve salt okuma).
- Web düzeni anında uygular, son düzenlemeden 800 ms sonra `PUT` ile kaydeder;
  kayıt başarısız olursa son kaydedilen düzene döner ve uyarı gösterir. Sayfa
  kapanırken bekleyen kayıt `keepalive` ile gönderilir. Kart verisi tek
  istekle yüklenir; taşıma ve boyutlandırma veriyi yeniden istemez, dönem veya
  şube değişince yalnızca etkilenen kartlar istenir.

Testler: `packages/shared/src/dashboard/*.spec.ts` (motor, şema, varsayılan
pano, dönemler), `apps/api/src/modules/dashboard/dashboard-cache.spec.ts`,
`apps/api/test/e2e/dashboard.e2e-spec.ts` (kiracı ve üyelik yalıtımı, eğitmen
için kart çıkarma, doğrulama ve düzeltme, gerçek ciro ve üye sayısı),
`apps/web/src/lib/dashboard/*.spec.ts`, `apps/web/e2e/dashboard-grid.e2e.ts`.

## Reklam performansı ve reklam bağlantıları (G2b)

- `/reklam-performansi` (izin `ads.view`) -- atıf raporunu (`GET /crm/studios/:studioId/attribution`) model, gruplama (kaynak/kampanya/reklam seti/reklam) ve tarih aralığı seçicileriyle tablo olarak gösterir: her satırda harcama, aday, satış, gelir, CPL, CAC, ROAS; alt satırda toplam ve etiketsiz ücretli trafik sayısı. `components/common/DateRangeFilter.tsx` yeniden kullanılır.
- `/ayarlar/reklam` (izin `ads.manage`) -- üç bölüm: **reklam platformu bağlantıları** (Meta/Google/TikTok CRUD, platforma göre değişen kimlik bilgisi formu, "bağlantıyı test et", kimlik bilgileri asla görüntülenmez, yalnızca son 4 karakter), **UTM oluşturucu** (`buildCampaignName()` ve `AD_URL_TEMPLATES` doğrudan `@platform/shared`'dan; pazar/dil/sektör/amaç/ay girilir, kampanya adı ve platforma göre URL parametre dizgesi + örnek URL üretilir, kopyala düğmeleri), **adlandırma denetimi** (`GET .../ads/naming-check`, senkronize kampanyalardan standarda uymayanları listeler). `ayarlar/page.tsx`'teki kart listesine ve nav'a (`Reklam performansı`) eklendi.
- Tarayıcı pikselleri (`apps/web/src/lib/tracking/pixels.ts`): `TrackingProvider` reklam izni verildiğinde `GET /public/studios/:slug/ads/pixels`'i sorgular ve yalnızca bağlı platformların pixel'ini yükler; panelde hiç çalışmaz (yalnızca herkese açık sayfa ağacında bağlı). `middleware.ts`'teki `publicAdsCsp()` yalnızca herkese açık stüdyo sayfalarında (`/<slug>`, `/<slug>/book`) `script-src`/`connect-src` yönergelerine pixel host'larını ekler. Ayrıntılar: `docs/REKLAM_ENTEGRASYONU.md`.

## Yerelde çalıştırma

1. `pnpm install`
2. API'yi çalıştırın (`pnpm --filter @platform/api dev`, `4000` portu).
3. `apps/web/.env.local` içine `API_INTERNAL_URL=http://localhost:4000`
   yazın (varsayılan zaten budur, yalnızca API farklı bir portta ise gerekir).
4. `pnpm --filter @platform/web dev` (`3000` portu), `http://localhost:3000/giris`
   adresinden giriş yapın.

## Ayarlar (2.3)

`apps/web/src/app/(app)/(dashboard)/ayarlar/` altında sekiz sayfa; hepsi
`PageGuard` ile korunur ve içindeki her aksiyon (buton, form bölümü)
`useDashboardSession()`'dan okuduğu izinlere göre gizlenir. Nav'da tek bir
"Ayarlar" girişi vardır (`lib/nav.ts`), görünürlüğü sekiz sayfanın izinlerinin
birleşimidir; sayfa içindeki bölümler kendi izinlerine göre ayrıca gizlenir
(ör. `/ayarlar/isletme` yalnızca `notifications.manage` olan bir kullanıcıya
sadece bildirim kanalları bölümünü gösterir).

- `ayarlar/` -- izin verilen bölümlere giden kartların olduğu giriş sayfası.
- `ayarlar/roller/` -- rol tanımları (`roles.manage`): izin kataloğu alan
  bazlı gruplanmış (`packages/shared/src/permissions.ts` -- `PERMISSION_AREAS`)
  checkbox editörüyle oluşturma/düzenleme/silme, personel rol ataması. Bunun
  için eksik olan `role-templates` API modülü eklendi
  (`apps/api/src/modules/role-templates`): rol CRUD, personel listesi, rol
  atama; hepsi `roles.manage` + `studioId` kapsamı + audit log ile. İşletme
  sahibi rolü salt okunur ve her zaman tüm izinlere sahiptir (CLAUDE.md kural
  5); `member` anahtarı `MembersService` içinde sabit arandığından silinemez.
  Sahip veya süper admin olmayan biri, kendisinde olmayan bir izni taşıyan
  bir rolü ne atayabilir ne de o role davet oluşturabilir (`POST /invites`
  rol atamasıyla aynı `assertCanGrant`/`assertNotLocked` kontrolünden geçer,
  aksi halde `403`).
- `ayarlar/gorunum/` -- işletme teması (`studio.settings.view`/`manage`):
  logo ve birincil renk (renk seçici + #RRGGBB alanı); `lib/settings/theme-preview.ts`
  `resolveTheme()`'i doğrudan kullanarak kaydedilmeden önce üye kartı, paket
  kartı ve düz birincil butonla canlı önizleme üretir. Saklanan aile ve
  gradyan anahtarı değiştirilmeden geri gönderilir. Kişisel görünüm (açık /
  koyu / cihazla aynı) herkese açıktır (`/me/appearance`); aile seçimi T1'de
  arayüzden kalktı.
- `ayarlar/subeler/` -- şube CRUD, personelin şube erişimi, son 30 gün şube
  özeti (`branches.manage` / `reports.view`).
- `ayarlar/isletme/` -- yalnızca uç noktası var olan ayarlar bölüm bölüm:
  **bölge ve para birimi** (aşağıya bakın), iptal politikası
  (`catalog.manage`), check-in penceresi
  (`studio.settings.manage`), bildirim kanal sırası + SMS bakiyesi
  (`notifications.manage`), oyunlaştırma aç/kapa (`studio.settings.manage`),
  Google yorum linki + tavsiye ödül birimi (`studio.settings.manage`), gömülü
  widget izinli kökenler (`integrations.manage`; eksik olan `GET
  /studios/:studioId/embed-settings` eklendi, form artık mevcut listeyi
  yükleyip düzenler, üzerine yazmaz).

- `ayarlar/mesaj-sablonlari/` -- **Mesaj şablonları** (G1c, `notifications.manage`):
  gönderim ayarları (kişi başına günlük/haftalık ticari mesaj sınırı, SMS
  sağlayıcısı sabitleme, e-posta gönderen adı ve yanıt adresi), anahtar x
  kanal x dil şablon listesi (kaynak: işletmeye özel / platform varsayılanı /
  yerleşik; WhatsApp Meta onay rozeti), SMS/WhatsApp/e-posta düzenleyicisi,
  e-posta blok düzenleyicisi (başlık, paragraf, buton, görsel, ayırıcı, alt
  bilgi) ve API'nin gönderirken kullandığı `renderEmail()` ile üretilen canlı
  önizleme (`sandbox=""` ile korumalı `iframe`), işletme şablonunu silip
  varsayılana dönme. Ekranın tüm metinleri `messaging.*` i18n anahtarlarıdır.

## Kişiler, segmentler, kampanyalar ve akışlar (G2a)

Menüde dört yeni giriş: "Kişiler" (`crm.view`), "Segmentler" (`segments.view`), "Kampanyalar" (`campaigns.view`), "Otomatik akışlar" (`journeys.view`). Sayfalar `PageGuard` ile korunur, eylemler `PermissionButton` ile gizlenir, tüm veri BFF (`bffFetch`) üzerinden gelir, metinler `crm`, `segments`, `campaigns`, `journeys` ve `nav` i18n ad alanlarındadır. Ortak yardımcılar `apps/web/src/components/growth/` altındadır (`ui.tsx`, `SegmentBuilder.tsx`, `SegmentEditor.tsx`, `CampaignEditor.tsx`, `JourneyEditor.tsx`).

- `kisiler/page.tsx`: arama, yaşam döngüsü, aşama ve etiket filtreli, sayfalı kişi tablosu.
- `kisiler/[contactId]/page.tsx`: kişi kartı (bilgiler, etiketler, özel alanlar, ticari izin, görevler, etkinlik geçmişi, atıf özeti).
- `kisiler/satis-hatti/page.tsx`: aşama sütunlu satış hattı panosu; sürükle-bırak ve her kartta erişilebilir "aşamaya taşı" seçimi.
- `segmentler/...`: liste, iç içe VE/VEYA kural oluşturucu, canlı önizleme (sayı + örnek kişiler), statik üyeler.
- `kampanyalar/...`: liste, düzenleyici (segment, kanal, şablon, hemen/ileri tarihli), kendine test gönderimi, iptal, sonuçlar ve alıcılar.
- `akislar/...`: liste, şablon galerisi (`akislar/sablonlar`), dikey adım düzenleyici (bekle, mesaj, dal, kişiyi güncelle, görev), hedef ve tekrar giriş, başlat/durdur/arşivle, istatistikler.

Ayrıntılar: `docs/KAMPANYA_VE_AKISLAR.md`. Tarayıcı testleri: `e2e/crm-contacts.e2e.ts`, `e2e/segments-campaigns.e2e.ts`.

## Gelen kutusu (G1c)

`apps/web/src/app/(app)/(dashboard)/gelen-kutusu/page.tsx`, menüde "Gelen Kutusu"
(`inbox.view`). Durum, atama, kanal ve kişi araması filtreli konuşma listesi
ile seçili konuşma yan yana (dar ekranda alt alta). Cevap kutusu ve hazır
cevaplar `inbox.reply` ister; WhatsApp 24 saatlik penceresi kapalıysa serbest
metin yerine onaylı şablon seçimi ve değişken alanları görünür. Bana ata /
atamayı kaldır, kapat / yeniden aç ve hazır cevap yönetimi `inbox.manage`
ister. Kiracı ve izin kontrolleri API'dedir; arayüz yalnızca kullanılamayan
eylemleri gizler.

Herkese açık iki mesajlaşma rotası vardır (oturum gerektirmez):

- `m/u/[token]/page.tsx` -- abonelikten çıkma sayfası (tr + en, dil seçici);
  bilgiyi ve tek tık çıkışı BFF üzerinden `GET/POST /m/u/:token`'a sorar.
- `m/c/[token]/route.ts` -- e-posta tıklama bağlantısı: belirteci biçim
  kontrolünden sonra API'ye (`POST /m/c/:token`) sorar, `pw_vid` çerezini ve
  User-Agent'ı iletir, yalnızca API'nin döndürdüğü saklı http(s) hedefe 302
  ile yönlendirir; aksi hâlde sitenin kökü. Ayrıntılar: `docs/MESAJLASMA.md`.

### Global ayarlar: bölge ve para birimi (G1a)

`/ayarlar/isletme` içindeki "Bölge ve para birimi" bölümü (`studio.settings.view`/`manage`)
`GET/PUT /studios/:studioId/region` üzerinden ülke kodu (ISO 3166-1), para
birimi (ISO 4217), saat dilimi ve vergi rejimini (`TR_KDV`/`EU_VAT`/`UK_VAT`/
`US_SALES_TAX`/`NONE`) ve paket fiyatlarının vergi dahil girilip girilmediğini
düzenler; şema `packages/shared/src/growth/regions.ts` (`StudioRegionSchema`).
Stüdyoda kayıtlı bir ödeme varsa para birimi değişikliği API'de 409 ile
reddedilir (tutarlar otomatik dönüştürülmez). Süper admin panelinde
(`/admin/tenants`) yeni işletme oluşturma formu bir ülke seçicisi içerir;
seçilen ülkeye göre para birimi, saat dilimi, vergi rejimi ve varsayılan dil
`countryDefaultsOf()` ile türetilir (bilinmeyen ülkeler USD/UTC/NONE/en'e
düşer, admin daha sonra tamamlar).

Para ve yüzde biçimlendirmesi artık hiçbir yerde sabit `'TRY'` veya `'tr-TR'`
kullanmaz: `apps/web/src/components/session/DashboardSessionProvider.tsx`
içindeki `useFormatMoney()` hook'u, oturumdaki aktif stüdyonun para birimini
(`activeMembership.currency`, `/auth/me`'den gelir) ve görüntüleyenin
`useLocale()`'dan çözülen dilini birleştirerek `packages/shared`'daki
`formatMoney()`'i çağırır; `apps/web/src/lib/money.ts`'teki `formatPercent()`
de aynı şekilde dil parametresi alır. Finans, rapor ve satış ekranları bu
hook'u kullanır.
- `ayarlar/rozetler/` -- W16 rozet tanımları: küresel (`studioId: null`) ve
  işletmeye özel rozetleri listeler (`reports.view`), işletmeye özel rozet
  oluşturma/düzenleme/etkin-pasif geçişi/silme (`studio.settings.manage`);
  küresel rozetler salt okunur olarak işaretlenir. Rozet türüne göre değişen
  eşik alanları (`threshold`) için saf yardımcılar
  `apps/web/src/lib/settings/badge-threshold.ts`'te (varsayılan eşik, tek
  satır özet), birim testli.
- `ayarlar/entegrasyonlar/` -- API anahtarları (`integrations.manage`: oluştur
  -- gizli anahtar tek seferlik gösterim + kopyala --, listele, iptal et),
  webhook'lar (oluştur, listele, gizli anahtar döndür, teslimat geçmişi,
  yeniden gönder, test olayı), partner platform bağlantıları
  (`integrations.partners.manage`: listele, oluştur, aç/kapa; kimlik bilgisi
  her zaman yalnızca yazılır, hiçbir uç nokta geri döndürmez).
- `ayarlar/reklam/` -- reklam platformu bağlantıları, UTM oluşturucu ve
  adlandırma denetimi (`ads.manage`); ayrıntılar yukarıda "Reklam performansı
  ve reklam bağlantıları (G2b)" bölümünde.
- `ayarlar/web-sitem/` -- G2c sayfa motoru, kiracının kendi sitesi
  (`site.view`/`site.manage`, sahip varsayılan): sayfa listesi, dil bazlı
  blok editörü, yayınla/yayından kaldır, sürüm geçmişi + geri alma, özel
  alan adı ekleme ve DNS doğrulama (TXT + CNAME). Süper admin panelinde aynı
  bileşen (`components/sites/SiteEditor.tsx`), platform sitesi için
  `/admin/web-sitesi`'nde çalışır (ayrıca sektör açılış sayfası sihirbazı ve
  şirket bilgisi formu ekler). Ayrıntılar: `docs/SAYFA_MOTORU.md`.

Ortak sunum bileşenleri `apps/web/src/components/settings/ui.tsx`'te (düz
yüzey + ince çizgi, iç içe kart yok; birincil buton gradyan slotlarından
biridir). Saf yardımcılar ve testleri `apps/web/src/lib/settings/`:
`role-permission-grouping.ts` (izin gruplama, rol fark özeti),
`theme-preview.ts` (form durumundan `resolveTheme()` önizlemesi),
`url-validation.ts` (webhook/embed/Google yorum linki doğrulamasını shared
şemalardan yeniden kullanır, böylece istemci hata mesajı API'ninkiyle
çakışmaz).

## Testler

`apps/web/src/lib/bff/*.spec.ts` ve `apps/web/src/lib/nav.spec.ts`, saf
fonksiyonları kapsar: path sanitizer, çerez seçenekleri, CSRF/origin
kontrolü ve izin->menü filtrelemesi. `apps/web/src/lib/calendar/*.spec.ts`
takvim görünüm aralığı matematiğini (gün/hafta/ay, ay tam haftaya genişleme),
sürükle-bırak zaman yuvarlamayı (`snapToSlot`/`moveByMinutes`) ve seans
formlarının paylaşılan Zod şemalarıyla (`CreateScheduleSchema`,
`UpdateScheduleSchema`) doğrulanmasını kapsar. W2.4 ile eklenenler:
`apps/web/src/lib/money.spec.ts` (para biçimlendirme ve `sumMoney` -- kayan
noktalı toplamanın vereceği hatalı sonuçları -- `0.1 + 0.2 !== 0.3` -- önlediğini
doğrular), `apps/web/src/lib/date-range.spec.ts` (tarih aralığı ön ayarları),
`apps/web/src/lib/reports/query.spec.ts` (rapor sorgu dizgisi kurma),
`apps/web/src/lib/bff/proxy-response.spec.ts` (BFF'nin CSV/PDF gibi JSON
olmayan yanıtları Content-Type/Content-Disposition'ı koruyarak ve hop-by-hop
başlıkları süzerek ilettiğini doğrular). `pnpm --filter @platform/web test`
(veya kökten `pnpm turbo run test`).
kontrolü ve izin->menü filtrelemesi. `apps/web/src/lib/settings/*.spec.ts`
(2.3) izin gruplama/rol farkı, tema önizleme eşlemesi ve webhook/embed/Google
yorum linki doğrulamasını kapsar. `pnpm --filter @platform/web test` (veya
kökten `pnpm turbo run test`). API tarafında yeni `role-templates` uç
noktaları `apps/api/test/e2e/role-templates.e2e-spec.ts` ile test edilir.

### Tarayıcı e2e testleri (Playwright)

`apps/web/e2e/` altında, gerçek bir Chromium tarayıcısında çalışan, tam
yığını (build edilmiş API + build edilip başlatılmış Next.js) seed'lenmiş
bir Postgres'e karşı süren uçtan uca testler var (`@playwright/test`,
`apps/web/playwright.config.ts`). Birim testlerin aksine sahte fetch değil,
gerçek tarayıcı, gerçek çerezler ve gerçek BFF/API isteği kullanılır. Kapsam:

- `auth.e2e.ts` -- `/giris` üzerinden giriş jetonların httpOnly çerezlere
  yazıldığını ve tarayıcı JS'inin (`document.cookie`) bunları hiç
  göremediğini, `/api/bff/auth/me`'nin çerezle başarılı döndüğünü, çıkışın
  çerezleri temizlediğini, kimliksiz `/dashboard` erişiminin `/giris`'e
  yönlendirdiğini doğrular.
- `nav.e2e.ts` -- işletme sahibinin tüm nav'ı gördüğünü, eğitmen rolünün
  daraltılmış bir nav gördüğünü ve `/ayarlar/roller` ile `/finans`'ta 403
  görünümüyle karşılaştığını doğrular.
- `calendar.e2e.ts` -- yeni bir seans oluşturur, hafta görünümünde
  göründüğünü ve yan panelin açıldığını doğrular.
- `member-package-sale.e2e.ts` -- `/members`'tan bir üye açar, nakit
  ödemeyle paket satar, satışın aktif paketlerde göründüğünü doğrular.
- `settings-roles.e2e.ts` -- iki izinli bir rol oluşturur, ardından siler.
- `reports.e2e.ts` -- rapor sekmeleri arasında geçiş yapar, CSV indirmenin
  BFF üzerinden `text/csv` içerikle döndüğünü doğrular.
- `csrf.e2e.ts` -- özel `x-requested-with` başlığı olmadan `/api/bff`'e
  yapılan bir POST'un 403 ile reddedildiğini doğrular.

Testler arasında paylaşılan durum yok: her test kendi rastgele son ekiyle
(`apps/web/e2e/support/ids.ts`) benzersiz isimler üretir; oluşturduğu veriyi
mümkün olduğunda kendi akışı içinde (ör. rol testinde oluşturup silerek)
temizler. Seed'lenmiş demo girişleri kullanılır (sahip
`+905321000002`, resepsiyon `+905321000003`, eğitmen `+905321000004`, üye
`+905321000016`; şifre `Demo1234!`).

**Yerelde çalıştırma** (bu ortamda Chromium `/opt/pw-browsers` altında
önceden kurulu; `playwright install` çalıştırmayın):

```bash
# 1. Taze, seed'lenmiş bir veritabanı oluşturun
docker exec t-pg psql -U u -d postgres -qc "create database pw_x"
cd packages/database
DATABASE_URL=postgresql://u:pw@localhost:5432/pw_x pnpm exec prisma generate
DATABASE_URL=postgresql://u:pw@localhost:5432/pw_x pnpm exec prisma migrate deploy
DATABASE_URL=postgresql://u:pw@localhost:5432/pw_x pnpm db:seed
cd ../..

# 2. API ve bağımlılıklarını (shared, database) build edin -- web'in kendi
#    build'ini apps/web/playwright.config.ts'deki webServer zaten yapar
pnpm turbo run build --filter=@platform/api...

# 3. Testleri çalıştırın
DATABASE_URL=postgresql://u:pw@localhost:5432/pw_x pnpm --filter @platform/web test:e2e

# 4. Veritabanını temizleyin
docker exec t-pg psql -U u -d postgres -qc "drop database pw_x"
```

`DATABASE_URL` zorunludur (varsayılan yoktur, çünkü hangi yerel Postgres'in
kullanılacağı ortamdan ortama değişir); `JWT_SECRET` ve `OTP_TEST_CODE`
verilmezse zararsız yerel varsayılanlarla çalışır (bkz.
`apps/web/playwright.config.ts`). `packages/database`'in tip denetimi
Prisma export'larından şikayet ederse önce orada `pnpm exec prisma
generate` çalıştırın. `pnpm --filter @platform/web test:e2e`, kök
`pnpm turbo run test`'e dahil DEĞİLDİR -- CI'da ayrı bir `web-e2e` job'u
olarak çalışır (bkz. `docs/CICD_GUIDE.md`), çünkü tam bir tarayıcı +
API + web sunucusu gerektirir ve birim testlerden çok daha yavaştır.
