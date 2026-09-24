# Web paneli (apps/web) mimarisi

Bu doküman W2.1 kapsamında kurulan temeli anlatır: kimlik doğrulama, oturum,
izne göre menü ve tema. Takvim sürükle-bırak, üye kartı ve paket satışı (2.2)
ile finans (2.4) gibi ekranlar sonraki backlog öğelerinde gelir. Ayarlar
ekranları (2.3) aşağıda anlatılıyor.

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
seçilir. Gradyan yalnızca uygulama başlık bandında (`Sidebar`) ve paket
kartında (`packages` sayfası) kullanılır; başka hiçbir yerde gradyan yoktur.

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
kontrolü ve izin->menü filtrelemesi. `apps/web/src/lib/settings/*.spec.ts`
(2.3) izin gruplama/rol farkı, tema önizleme eşlemesi ve webhook/embed/Google
yorum linki doğrulamasını kapsar. `pnpm --filter @platform/web test` (veya
kökten `pnpm turbo run test`). API tarafında yeni `role-templates` uç
noktaları `apps/api/test/e2e/role-templates.e2e-spec.ts` ile test edilir.
