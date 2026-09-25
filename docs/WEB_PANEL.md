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
  `auth/otp/verify` ve `auth/pin/login` yanıtlarındaki `accessToken`/
  `refreshToken` alanları BFF tarafından çerezlere yazılır ve yanıt
  gövdesinden çıkarılır.
- Aktif işletme (`pw_studio`) ve aktif şube (`pw_branch`) seçimleri sır
  değildir; düz (httpOnly olmayan) çerezlerdir, böylece istemci tarafı da
  okuyup `x-studio-id` başlığını gönderebilir.
- 401 alan bir istek, `pw_refresh` çerezi varsa BFF içinde bir kez
  `/auth/refresh` ile yenilenir ve orijinal istek yeni jetonla tekrarlanır;
  yenileme de başarısız olursa oturum çerezleri temizlenir.
- CSRF: her GET/HEAD/OPTIONS dışı çağrı, aynı origin'den gelen `Origin`
  başlığı ve özel `x-requested-with: platform-web` başlığı ister
  (`apps/web/src/lib/bff/csrf.ts`). Bu ikisi eksikse istek 403 ile reddedilir.
- Hop-by-hop başlıklar (`connection`, `transfer-encoding`, `cookie`,
  `authorization`, ...) iki yön arasında asla ham kopyalanmaz
  (`apps/web/src/lib/bff/headers.ts`); proxy bunları açıkça yeniden kurar.

`NEXT_PUBLIC_API_URL`, yalnızca sunucu tarafında derlenen `apps/web/src/middleware.ts`
(embed CSP için studio'yu okur) ve `apps/web/src/app/embed/[studioSlug]/page.tsx`
(herkese açık, kimliksiz embed widget'ı, salt okunur uç noktalar) içinde
kullanılmaya devam eder -- bunlar zaten kimliksiz herkese açık uç noktalar
kullanır, jeton taşımaz.

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

`(dashboard)/layout.tsx`, aktif üyeliğin `theme` alanını (işletmenin
`themeFamily`/`themePrimary`/`gradientPresetKey`/`logoUrl`) ve kullanıcının
`appearance` tercihini (`GET /auth/me` yanıtındaki `appearance`, W3'teki
`GET /me/appearance` ile aynı veri) `ThemeRoot` bileşenine geçirir. `ThemeRoot`
istemci tarafında `resolveTheme()`/`themeCssVariables()` (packages/shared)
çağırır, `prefers-color-scheme` değişikliklerini dinler ve sonucu CSS
custom property olarak yalnızca dashboard alt ağacına uygular -- herkese açık
rezervasyon sayfası ve embed widget'ı kendi temasını kendi kiracısından
çözer. Dört tema ailesinin (Stüdyo Noir, Nefes, Saha, Atölye) yazı tipleri
`@fontsource` paketlerinden gelir (`apps/web/src/app/(dashboard)/fonts.css`),
derlemeye gömülür; derleme sırasında ağ erişimi, çalışma zamanında Google
Fonts isteği yoktur. Türkçe karakterler (latin-ext) aynı yazı tipiyle
görüntülenir, tarayıcı yalnızca sayfada kullanılan karakter aralıklarını
indirir. Aktif ailenin yazı tipi adları `apps/web/src/lib/fonts.ts`'den
seçilir. Gradyan yalnızca uygulama başlık bandında (`Sidebar`), paket
kartında (`packages` sayfası ve üye kartındaki aktif paket kartları) ve
birincil butonda (`PermissionButton` `variant="primary"`) kullanılır; başka
hiçbir yerde gradyan yoktur.

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

## Finans, hakediş, raporlar, adaylar, riskli üyeler (W2.4)

- `/finans` -- sekmeli tek sayfa (`components/finance/*Tab.tsx`): Ödemeler
  (tarih aralığı/yöntem/durum/şube filtresi, `finance.manage` ile kısmi/tam
  iade onaylı diyalogla, bekleyen havale ödemeleri için `POST
  /payments/bank-transfer/confirm`), Giderler (liste/oluştur/sil; API'de yeni
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
  dönüştürme, deneme dersi planlama (`POST /leads/:id/trial`, seans kimliği
  takvim ekranından kopyalanır -- ayrı bir seans seçici bu sürümde yok).
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

## Yerelde çalıştırma

1. `pnpm install`
2. API'yi çalıştırın (`pnpm --filter @platform/api dev`, `4000` portu).
3. `apps/web/.env.local` içine `API_INTERNAL_URL=http://localhost:4000`
   yazın (varsayılan zaten budur, yalnızca API farklı bir portta ise gerekir).
4. `pnpm --filter @platform/web dev` (`3000` portu), `http://localhost:3000/giris`
   adresinden giriş yapın.

## Ayarlar (2.3)

`apps/web/src/app/(dashboard)/ayarlar/` altında altı sayfa; hepsi
`PageGuard` ile korunur ve içindeki her aksiyon (buton, form bölümü)
`useDashboardSession()`'dan okuduğu izinlere göre gizlenir. Nav'da tek bir
"Ayarlar" girişi vardır (`lib/nav.ts`), görünürlüğü altı sayfanın izinlerinin
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
- `ayarlar/gorunum/` -- işletme teması (`studio.settings.view`/`manage`):
  aile, logo, birincil renk, aileye ait gradyan seçimi; `lib/settings/theme-preview.ts`
  `resolveTheme()`'i doğrudan kullanarak kaydedilmeden önce canlı önizleme
  üretir. Kişisel görünüm (aile geçersiz kılma + açık/koyu/sistem) herkese
  açıktır (`/me/appearance`).
- `ayarlar/subeler/` -- şube CRUD, personelin şube erişimi, son 30 gün şube
  özeti (`branches.manage` / `reports.view`).
- `ayarlar/isletme/` -- yalnızca uç noktası var olan ayarlar bölüm bölüm:
  iptal politikası (`catalog.manage`), check-in penceresi
  (`studio.settings.manage`), bildirim kanal sırası + SMS bakiyesi
  (`notifications.manage`), oyunlaştırma aç/kapa (`studio.settings.manage`),
  Google yorum linki + tavsiye ödül birimi (`studio.settings.manage`), gömülü
  widget izinli kökenler (`integrations.manage`; okuma uç noktası yok, form
  kaydettiğinde listenin tamamını değiştirir).
- `ayarlar/entegrasyonlar/` -- API anahtarları (`integrations.manage`: oluştur
  -- gizli anahtar tek seferlik gösterim + kopyala --, listele, iptal et),
  webhook'lar (oluştur, listele, gizli anahtar döndür, teslimat geçmişi,
  yeniden gönder, test olayı), partner platform bağlantıları
  (`integrations.partners.manage`: listele, oluştur, aç/kapa; kimlik bilgisi
  her zaman yalnızca yazılır, hiçbir uç nokta geri döndürmez).

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
