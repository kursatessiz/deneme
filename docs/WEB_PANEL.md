# Web paneli (apps/web) mimarisi

Bu doküman W2.1 kapsamında kurulan temeli anlatır: kimlik doğrulama, oturum,
izne göre menü ve tema. Takvim sürükle-bırak, üye kartı, paket satışı, rol
ekranı ve finans gibi ekranlar sonraki backlog öğelerinde (2.2-2.4) gelir.

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

## Testler

`apps/web/src/lib/bff/*.spec.ts` ve `apps/web/src/lib/nav.spec.ts`, saf
fonksiyonları kapsar: path sanitizer, çerez seçenekleri, CSRF/origin
kontrolü ve izin->menü filtrelemesi. `pnpm --filter @platform/web test`
(veya kökten `pnpm turbo run test`).
