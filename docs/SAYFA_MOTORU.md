# Sayfa Motoru (G2c)

Bu belge, `docs/BUYUME_VE_GLOBAL_MIMARI.md` bölüm 3.9 (sayfa motoru) ve bölüm 5 (platform açılış sayfaları) maddelerinin G2c fazında nasıl uygulandığını anlatır. Bağlayıcı tasarım o belgedir; bu belge uygulamanın ayrıntısıdır.

## 1. Özet

- `Site` -> `Page` -> `Block` modeli: her kiracının en fazla bir sitesi vardır (`kind`: `PLATFORM` platform kiracısı için, `TENANT` diğer her kiracı için). Platform sitesi `docs/CRM_VE_ATIF.md`'deki platform kiracısı (`Studio.isPlatform`) üzerinde yaşar.
- Sayfa (`Page`) bir tür (`HOME`, `LANDING`, `CORPORATE`, `LEGAL`, `CUSTOM`), isteğe bağlı sektör ve teklif (offer) anahtarı taşır; her dilde ayrı bir `PageLocale` (slug, SEO alanları, hukuki onay) vardır. İçerik dilden bağımsız blok yapılandırması + dile göre metinlerden (`Block.text[locale]`) oluşur.
- Yayınlama (`publish`) o anki blok kümesinin değişmez bir anlık görüntüsünü (`PageVersion`) yazar; geri alma (rollback) bir önceki sürümü yeniden yayınlar.
- Bloklar `packages/shared/src/sites/blocks.ts` içinde Zod ile tipli ve doğrulanmıştır; metin her zaman düz metin olarak render edilir (asla HTML), görseller yalnızca kendi yükleme deposundan gelen URL'lerdir.
- Formlar mevcut herkese açık aday ucunu (`POST /public/studios/:slug/leads`, `docs/CRM_VE_ATIF.md`) kullanır; KVKK/GDPR onay metni, gizli alan ve hız sınırı zaten o uçta vardır.
- A/B varyantı ziyaretçiye birinci taraf çerezle (analiz izni varsa `pw_vid`, yoksa istek imzasından türetilen oturumluk bir kimlikle) sabitlenir; dönüşüm `TouchpointInput.pageVariant` ile taşınır.

## 2. Veri modeli

| Model | Açıklama |
|---|---|
| `Site` | `studioId` (benzersiz, bir kiracının en fazla bir sitesi olur), `kind`, `primaryDomain`, `defaultLocale`, `enabledLocales` (string dizisi) |
| `SiteDomain` | `siteId`, `domain`, `status` (`PENDING`/`VERIFIED`/`FAILED`), `verificationToken` (DNS TXT değeri), `verifiedAt` |
| `Page` | `siteId`, `kind`, `sectorKey`, `offerKey`, `internalLabel` (yalnızca yönetim panelinde görünür, çevrilmez), `status` (`DRAFT`/`PUBLISHED`), `abGroupKey` (varyant grubu), `publishedAt` |
| `PageLocale` | `pageId`, `locale`, `slug` (dile göre benzersiz yol), `seoTitle`, `seoDescription`, `ogImageUrl`, `legalApproved`, `legalApprovedAt` |
| `Block` | `pageId`, `type` (bkz. bölüm 3), `position`, `abVariantKey` (aynı pozisyonda birden çok varyant), `data` (JSON; `config` dilden bağımsız, `text` dile göre haritalanmış) |
| `PageVersion` | Yayınlanan anın değişmez anlık görüntüsü: `pageId`, `version` (artan), `snapshot` (JSON: o andaki tüm `PageLocale` + `Block` verisi), `publishedAt`, `publishedByUserId` |
| `CompanyInfo` | Tekil satır (platform şirket bilgisi): unvan, adres, MERSIS, ticaret sicil no, vergi dairesi/no, e-posta, telefon, sosyal medya bağlantıları (JSON) |

Kısıtlar: `Site.studioId` benzersiz; `(Site.id, PageLocale.locale, PageLocale.slug)` benzersiz (aynı dilde iki sayfa aynı yolu paylaşamaz); `SiteDomain.domain` genel benzersiz. Migration: `20260930000000_sites` (mevcut tüm migration'lardan sonra sıralanır, yalnızca ileri yönlü, drift kontrolünden temiz geçer).

İzinler: `site.view` (görüntüleme), `site.manage` (düzenleme, yayınlama, alan adı ayarlama); katalogda Türkçe etiketle (`packages/shared/src/permissions.ts`), "Web sitem" grubunda, kiracı sahibi varsayılan olarak ikisine de sahiptir (CLAUDE.md kural 5). Platform sitesi de aynı uçlar üzerinden, platform kiracısının `studioId`'siyle, yalnızca süper admin tarafından yönetilir (`StudioTenantGuard` süper admin'e her `studioId` üzerinde her izni verir).

## 3. Bloklar

`packages/shared/src/sites/blocks.ts`, her tür için ayrı bir Zod şeması ve tek bir `BLOCK_SCHEMAS` haritası tanımlar; `validateBlockData(type, data)` API'de her yazımda çalışır.

| Tür | Kullanım |
|---|---|
| `hero` | Başlık bandı: eyebrow, başlık, alt başlık, birincil/ikincil CTA, arka plan görseli |
| `feature_grid` | Özellik listesi (başlık + açıklama, en fazla 12) |
| `sector_cards` | Sektör kartları; `config.sectorKeys` hangi `BusinessTypeTemplate` anahtarlarının hangi sırada gösterileceğini seçer, metinler o şablonun kelime dağarcığından ve i18n'den üretilir |
| `how_it_works` | Adım listesi |
| `pricing` | Platform sitesinde `Plan`, işletme sitesinde `PackageDefinition` okur; `config.hidden` fiyatları gizler |
| `testimonials` | Yorumlar (veri, kodda sabit metin değil) |
| `faq` | Soru/cevap; ayrıca `FAQPage` JSON-LD üretir |
| `stats` | Etiket/değer çiftleri |
| `cta` | Tek eylem çağrısı |
| `lead_form` | `POST /public/studios/:slug/leads`'e gönderir; bölge onay metni ve bot koruması var olan uçtan miras alınır |
| `booking_widget` | Yalnızca işletme siteleri; mevcut herkese açık rezervasyon akışına bağlanır |
| `trainers` | Yalnızca işletme siteleri; elle girilmiş eğitmen listesi |
| `contact` | `CompanyInfo` (platform) veya kiracının iletişim bilgileri (işletme sitesi) |
| `legal_text` | Serbest metin (paragraf), yalnızca düz metin |

`TENANT_ONLY_BLOCK_TYPES` (`booking_widget`, `trainers`) platform sitesinde reddedilir (API 400, editör bu türleri göstermez).

## 4. Yayınlama ve render

Rota yapısı (`apps/web/src/app/[locale]/[[...slug]]/page.tsx`, platform sitesi):

- `/{dil}` -> `HOME`
- `/{dil}/{sektör}` -> sektör `LANDING`
- `/{dil}/{sektör}/{teklif}` -> kampanya varyantı
- `/{dil}/{slug}` -> `CORPORATE` / `LEGAL` / `CUSTOM`

İşletme siteleri aynı motoru `apps/web/src/app/tenant-site/[studioSlug]/[locale]/[[...slug]]/page.tsx` üzerinden, `<slug>.<platform-alan-adı>` alt alan adında veya doğrulanmış özel alan adında, `middleware.ts`'in host çözümlemesiyle (`/public/sites/resolve`) sunar.

- Yalnızca yayınlanan (`PUBLISHED`) diller render edilir; olmayan veya yayınlanmamış bir dil/slug kombinasyonu 404'tür (`resolvePageLocale`, `packages/shared/src/sites/site.ts`).
- Statik üretim + 300 saniyelik zaman tabanlı yeniden doğrulama (`revalidate`); `generateStaticParams` derleme sırasında API'ye ulaşamazsa (örn. CI'da web API'den önce derlenir) boş liste döner ve build kesintiye uğramaz -- sayfalar isteğe bağlı (on-demand) render ile ilk istekte üretilir.
- `hreflang`, `canonical`, Open Graph/Twitter etiketleri ve `Organization`/`LocalBusiness`/`FAQPage`/`Offer` JSON-LD `apps/web/src/lib/sites/jsonld.ts` ve `SitePage.tsx`'te üretilir; `hreflang` yalnızca o sayfanın yayınlanmış dil varyantları için yazılır.
- `sitemap.xml` ve `robots.txt` (`apps/web/src/app/sitemap.xml/route.ts`, `.../robots.txt/route.ts`) istek host'una göre platform veya ilgili işletme sitesi için üretilir.
- `/` platformun en iyi dile yönlendiren kökü olarak sayfa motoruna devredilmiştir (mevcut sabit kodlu içerik kaldırıldı).

### A/B testi

`packages/shared/src/sites/ab.ts` + `apps/web/src/lib/sites/ab.ts`: bir sayfanın bloklarında birden çok `abVariantKey` varsa, ziyaretçinin sticky kimliği (izin varsa `pw_vid`/`pw_sid` çerezi, yoksa istekten türetilmiş, hiçbir yerde saklanmayan bir özet) üzerinden deterministik olarak bir varyant seçilir (FNV-1a tabanlı, kriptografik olmayan dağıtım). Seçilen varyant `TouchpointInput.pageVariant` alanıyla izleme istemcisine iletilir, böylece dönüşüm raporları varyanta göre kırılabilir.

## 5. Editörler

**Süper admin -- "Web sitesi"** (`apps/web/src/app/admin/web-sitesi/page.tsx`): platform sitesinin sayfaları (dil bazlı durum), blok editörü (ekle/sırala/kaldır, her blok için dil sekmeleri, çevrilmemiş alanlar işaretlenir), canlı önizleme, yayınla/yayından kaldır, sürüm geçmişi + geri alma, şirket bilgisi formu (`CompanyInfo`), sektör açılış sayfası sihirbazı (`POST sites/studio/:studioId/pages/wizard`: sektör + teklif + dil listesi seçilir, `BusinessTypeTemplate` kelime dağarcığından önceden doldurulmuş bir `LANDING` sayfası oluşturur).

**Kiracı -- "Web sitem"** (`apps/web/src/app/(dashboard)/ayarlar/web-sitem/page.tsx`, `site.manage`/`site.view`, sahip varsayılan): yalnızca kendi sitesi, özel alan adı kurulumu ve doğrulaması (DNS TXT + CNAME), rezervasyon/eğitmen/fiyat blokları dahil aynı editör bileşeni (`components/sites/SiteEditor.tsx`).

Ortak bileşen `SiteEditor.tsx` her iki panelde de kullanılır; `TENANT_ONLY_BLOCK_TYPES` platform sitesinde gizlenir.

## 6. Uçlar

Tüm kiracı uçları `sites/studio/:studioId` altında, `JwtAuthGuard` + `StudioTenantGuard` + `PermissionGuard` ile korunur (`apps/api/src/modules/sites/sites-tenant.controller.ts`):

| Uç nokta | İzin |
|---|---|
| `GET /sites/studio/:studioId` (siteyi tembel oluşturur yoksa) | `site.view` |
| `PATCH /sites/studio/:studioId` (varsayılan/etkin diller, birincil alan adı) | `site.manage` |
| `POST/DELETE .../domains`, `POST .../domains/:domainId/verify` | `site.manage` |
| `GET/POST .../pages`, `POST .../pages/wizard` | `site.view` / `site.manage` |
| `GET/DELETE .../pages/:pageId` | `site.view` / `site.manage` |
| `PUT/DELETE .../pages/:pageId/locales/:locale` | `site.manage` |
| `PATCH .../pages/:pageId/locales/:locale/legal-approval` (yalnızca `LEGAL` sayfalarda) | `site.manage` |
| `PUT .../pages/:pageId/blocks` (tüm blok kümesini değiştirir, tür başına şema doğrulaması) | `site.manage` |
| `POST .../pages/:pageId/publish` \| `unpublish` | `site.manage` |
| `GET .../pages/:pageId/versions`, `POST .../versions/:versionId/rollback` | `site.view` / `site.manage` |
| `GET/PUT /admin/company-info`, `GET /admin/company-info/platform-studio-id` | yalnızca süper admin |

Herkese açık, kimliksiz uçlar (`apps/api/src/modules/sites/public-sites.controller.ts`):

| Uç nokta | Amaç |
|---|---|
| `GET /public/sites/resolve?host=` | Web middleware'i: bir Host başlığı hangi siteye ait |
| `GET /public/sites/:studioSlug/pages?locale=&slug=` | Bir sayfanın yayınlanmış tek dil hali; yayınlanmamış/bilinmeyen 404 |
| `GET /public/sites/:studioSlug/sitemap-entries` | `sitemap.xml` için yayınlanmış sayfa listesi |
| `GET /public/domains/ask?domain=` | Caddy on-demand TLS "ask" uç noktası; hız sınırlıdır (`SitesPublicRateLimitGuard`), yalnızca aktif bir kiracının doğrulanmış özel alan adı veya `<slug>.<SITES_DOMAIN>` alt alan adı için 200 döner, başka her şey 404 |

## 7. Özel alan adları

Akış: kiracı alan adını ekler (`POST .../domains`) -> API bir `verificationToken` üretir ve beklenen DNS kayıtlarını döner (`expectedDnsRecords`, `packages/shared/src/sites/domain.ts`: TXT doğrulama kaydı + CNAME hedefi platformun alan adı) -> kiracı DNS'te bu kayıtları ekler -> `POST .../domains/:domainId/verify` DNS'i sorgular (`DnsVerificationService`, gerçek `dns.resolveTxt`/`resolveCname`) ve durumu `VERIFIED`/`FAILED` yapar.

`deploy/caddy/Caddyfile`, `on_demand_tls` ile `ask http://api:4000/public/domains/ask` çağıran genel bir ayar ve `WEB_DOMAIN`/`API_DOMAIN` ile eşleşmeyen her host için `web:3000`'e yönlenen bir `:443` yakalayıcı (catch-all) bloğu içerir; böylece hem `<slug>.{$SITES_DOMAIN}` alt alan adları hem de doğrulanmış özel alan adları ilk istekte otomatik sertifika alır. `SITES_DOMAIN` ortam değişkeni ayarlanmazsa `WEB_DOMAIN`'e düşer.

**Sahibin sağlaması gereken**: `SITES_DOMAIN` DNS'inde `*.{$SITES_DOMAIN}` için (veya alt alan adı başına) Caddy sunucusuna işaret eden bir A/AAAA kaydı; joker (wildcard) bir kapsayıcı sertifika istenirse ayrıca bir DNS-01 sağlayıcı eklentisi ve API anahtarı gerekir (şu an kurulu değildir, on-demand HTTP-01 her alt alan adı için ayrı sertifika alır, bu 6 GB RAM'lik sunucuda beklenen kiracı sayısı için yeterlidir).

## 8. Kampanya açılış sayfası oluşturma

1. Süper admin panelinde "Web sitesi" -> "Sektör açılış sayfası oluştur" sihirbazını aç.
2. Sektör anahtarını (`BusinessTypeTemplate.key`), isteğe bağlı bir teklif anahtarı (örn. `ucretsiz-deneme`) ve yayınlanacak dilleri seç.
3. Sihirbaz `hero`, `feature_grid`, `sector_cards`, `lead_form`, `faq`, `cta` bloklarıyla önceden doldurulmuş bir `LANDING` sayfası oluşturur; metinler seçilen sektörün kelime dağarcığından ve i18n'den gelir.
4. Blok editöründe metni düzenle, gerekirse `abVariantKey` ile bir varyant ekle, yayınla.
5. Sonuç URL'si `/{dil}/{sektör}` veya teklif verildiyse `/{dil}/{sektör}/{teklif}` olur; bu tam URL, `docs/BUYUME_VE_GLOBAL_MIMARI.md` bölüm 4'teki UTM oluşturucuya açılış sayfası olarak girilir (oluşturucu URL'nin var olduğunu ve dilin etkin olduğunu doğrular).

## 9. Kararlar ve sınırlar

- **Hukuki taslak bandı**: yasal sayfalar (`kind = LEGAL`) her zaman `legalApproved = false` olarak başlar (seed dahil); süper admin panelden dil başına onaylamadan görünür bir "taslak, hukuki incelemeden geçmeli" bandıyla render edilir. Onay `PageLocale` düzeyindedir (bir dil onaylı, diğeri taslak olabilir).
- **Görsel kaynağı**: bloklardaki her görsel alanı yalnızca kendi yükleme deposu URL'sini kabul eder (Zod `url()` + iş kuralı; dışarıdan rastgele bir görsel URL'si yazılamaz); metin alanları HTML olarak asla render edilmez.
- **Fiyat gizleme**: `pricing` bloğunun `config.hidden` anahtarı, kampanya sayfalarında fiyatın gösterilmemesi istendiğinde bloğu tutar ama render etmez.
- **AB test raporlaması**: bu fazda yalnızca varyant ataması ve `pageVariant`'ın izleme istemcisine iletilmesi vardır; varyant başına dönüşüm oranı raporu `docs/CRM_VE_ATIF.md`'deki atıf raporunun `pageVariant` kırılımıyla ileride eklenecektir.
- **Joker sertifika**: yukarıda bölüm 7'de açıklandığı gibi, şimdilik alt alan adı başına on-demand sertifika; ölçek büyüdükçe bir DNS-01 sağlayıcısına geçiş sahibin kararıdır.

## 10. Nasıl test edilir

```bash
pnpm install --frozen-lockfile
pnpm turbo run build typecheck test          # birim testleri (shared: blok şemaları, dil düşümü, hreflang/sitemap; api: sites servisleri)

# Postgres + Redis çalışırken
export DATABASE_URL=postgresql://u:pw@localhost:5432/g2c_test
cd packages/database
pnpm exec prisma migrate deploy
pnpm exec prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
pnpm db:seed                                 # platform sitesi: 2 dilde kurumsal + yasal sayfalar, en az iki sektör açılış sayfası

cd ../../apps/api
JWT_SECRET=... OTP_TEST_CODE=482915 NODE_ENV=test npx jest -c test/jest-e2e.config.js

cd ../web
pnpm exec playwright test --reporter=list    # platform ana sayfa (tr/en), bir sektör sayfası, form akışı, yasal taslak bandı, yayınlanmamış dil 404'ü
```

İlgili testler:

- Birim: `packages/shared/src/sites/sites.spec.ts` (blok şemaları, `resolveBlockText` dil düşümü, `buildHreflangAlternates`, `assignVariant` determinizmi, `expectedDnsRecords`).
- API e2e: `apps/api/test/e2e/sites.e2e-spec.ts` (izin ve kiracı izolasyonu, sayfa yaşam döngüsü, yayınlama/sürüm/geri alma, sektör sihirbazı, özel alan adı doğrulama akışı ve `ask` uç noktası, herkese açık render + sitemap girdileri + host çözümleme, yayınlanmış bir açılış sayfasından form gönderimi -> `Contact` + `lead` dönüşümü, şirket bilgisi).
- Web e2e (Playwright, CI'da çalışır, bu ortamda `playwright install` engellendiği için burada koşulmamıştır): `apps/web/e2e/sites.e2e.ts`.

Test paketleri oluşturdukları her şeyi siler; art arda iki kez geçer.
