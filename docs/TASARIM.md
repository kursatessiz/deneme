# Tasarım sistemi (Perfect UI)

Sahibin kararı (T1): ürünün tek görsel dili açık kaynak **Perfect UI** kitidir
(https://perfectui.dev, npm `@chrissgon/perfectui` 1.0.0, MIT). Web paneli,
süper admin paneli, herkese açık sayfalar ve daha sonra mobil uygulama bu dili
kullanır. Yetkili görsel referanslar `docs/design-refs/perfectui-overview.png`
ve `perfectui-overview-thumb.png` dosyalarıdır.

Bu belge şunları anlatır: token'lar ve nerede yaşadıkları, üç sınıf kuralı,
bileşen kütüphanesi ve kit sınıflarına eşlemesi, işletme markası ile açık/koyu
modun `ThemeRoot` üzerinden akışı, iki gradyan alanı, Tailwind'in hâlâ neye
kullanılabildiği, yeni bir ekranın nasıl yazılacağı, ekran görüntüsü artefaktı
ve sonraki fazlarda neyin taşınacağı.

## 1. Alınmış kararlar

1. **Tek tasarım dili.** Dört tema ailesi (Stüdyo Noir, Nefes, Saha, Atölye)
   kaldırıldı. `THEME_FAMILY_KEYS` artık yalnızca `['perfect']`;
   `getThemeFamily()` bilinmeyen veya eski her anahtarı bu aileye eşler.
   Veritabanındaki değerler olduğu gibi kalır (migration yok). API sözleşmesi
   değişmedi: `PUT /studios/:id/theme` ve `PUT /me/appearance` eski aile
   anahtarlarını (`noir`, `nefes`, `saha`, `atolye`) ve eski gradyan
   anahtarlarını kabul eder, eski bir aile için gradyanın o aileye ait olması
   kuralı da korunur; ancak bu alanlar ekranda hiçbir şeyi değiştirmez
   (render tarafında normalize edilir). Web'de `/ayarlar/gorunum` ve üst
   bardaki kullanıcı menüsü yalnızca açık / koyu / cihazla aynı seçimini
   sunar; aile seçimi arayüzden kalktı.
2. **İşletme markası kalır.** Logo ve birincil renk (`themePrimary`)
   işletmenindir; birincil renk o işletmenin alt ağacında `--pui-theme` olur.
   Kullanıcının açık/koyu/sistem tercihi `data-pui-mode` olur.
3. **Gradyan yalnızca iki yerde.** Kit düzdür (flat). `GRADIENT_SLOTS` artık
   `['memberCard', 'packageCard']`: üye kartı ve paket kartı. Gradyan
   birincil renkten türetilen tek bir iki duraklı gradyandır
   (`brandGradient()`: renk, %37 koyulaştırılmış hali, 135 derece).
   `gradientPresetKey` kabul edilir ve yok sayılır. Birincil butonlar ve
   başlık bandı düz `pui-solid pui-theme`'dir.
4. **Yazı tipi Inter**, `@fontsource/inter` (400, 500, 600, 700; latin ve
   latin-ext) ile derlemeye gömülür; çalışma zamanında harici font isteği
   yoktur. İkonlar Lucide, 16 px, çizgi rengi metin rengine bağlı
   (`lucide-react`, `ui-icon` sınıfı).

## 2. Token'lar ve tek doğruluk kaynağı

Token'lar `packages/shared/src/design` içinde yaşar ve iki platform için
tektir:

- `themes.ts`: `PERFECT_UI_TOKENS` (kitin `dist/css/core.css` değerlerinin
  birebir kopyası), `THEME_FAMILIES.perfect` (yazı tipi, köşe, nötr renkler,
  anlamsal roller, varsayılan gradyan), eski anahtar listeleri
  (`LEGACY_THEME_FAMILY_KEYS`, `STORED_THEME_FAMILY_KEYS`).
- `tokens.ts`: `palette`, `semanticColors`, `spacing`, `radii`, `typography`,
  `GRADIENT_SLOTS`, şemalar (`TenantThemeSchema`, `AppearancePreferenceSchema`),
  `resolveTheme()`, `themeCssVariables()`, `brandGradient()`, `onColor()`,
  `contrastRatio()`.

| Token | Açık | Koyu | CSS değişkeni |
|-------|------|------|---------------|
| Zemin | `#ffffff` | `#000000` | `--pui-bg` |
| Soluk zemin | `#f3f4f6` | `#111827` | `--pui-bg-muted` |
| Vurgu zemini | `#e5e7eb` | `#1f2937` | `--pui-bg-emphasis` |
| Metin | `#000000` | `#ffffff` | `--pui-text` |
| Soluk metin | `#676d7b` | `#9ca3af` | `--pui-text-muted` |
| Çizgi | `#d1d5db` | `#374151` | `--pui-border` |
| Marka (varsayılan) | `#0092cd` | `#07b6f0` | `--pui-theme` |
| Başarı | `#16a34a` | `#22c55e` | `--pui-success` |
| Uyarı | `#d97706` | `#f59e0b` | `--pui-warn` |
| Hata | `#dc2626` | `#ef4444` | `--pui-error` |
| Nötr | `#6b7280` | `#9ca3af` | `--pui-muted` |

Ölçüler: köşe 6 px (`--pui-radius`, kartlarda 1,5 katı = 9 px), boşluk birimi
4 px (`--pui-space`), yazı boyutu 14 px (`--pui-font-size`), çizgi 1 px
(`--pui-border-width`). Renkler `light-dark()` çiftleri olarak yayılır ve
`color-scheme`'e göre çözülür.

`themeCssVariables()` iki şey üretir:

- `--pui-*` değişkenleri: nötrler ve roller kit çiftleri olarak; `--pui-theme`
  işletmenin birincil rengi (renk kitin varsayılanıysa kitin açık/koyu
  çifti); `--pui-on-theme` marka rengi üzerindeki metin rengi (kitte zemin
  rengi, işletme renginde `onColor()` ile kontrastı denetlenmiş renk).
- Eski adlar (takma ad, alias): `--color-background`, `--color-surface`,
  `--color-surface-muted`, `--color-border`, `--color-text-primary`,
  `--color-text-secondary` (metnin %80'i), `--color-text-muted`,
  `--color-primary`, `--color-on-primary`, `--color-success`,
  `--color-warning`, `--color-danger`, `--gradient-brand`,
  `--gradient-brand-on`, `--font-display`, `--font-body`, `--radius-card`
  (9 px), `--radius-button` (6 px), `--radius-chip` (9999 px),
  `--radius-input` (6 px). Henüz taşınmamış ekranlar bu adları kullanmaya
  devam eder ve yeni paleti dokunulmadan alır.

Mobil aynı hex değerlerini `resolveTheme()` üzerinden okur; e-posta şablonları
(`emailBrandOf()`) da aynı nötrleri ve Inter yığınını kullanır.

## 3. Üç sınıf kuralı

Kitte her öğe birbirinden bağımsız üç sınıftan oluşur:

- **Şekil:** `pui-btn`, `pui-badge`, `pui-chip`, `pui-input`, `pui-card`
  (`pui-card-header`, `pui-card-content`), `pui-field-group`,
  `pui-input-group` + `pui-addon`, `pui-checkbox`, `pui-radio`, `pui-switch`,
  `pui-table`, `pui-list` + `pui-list-item`, `pui-dropdown`, `pui-tooltip`,
  `pui-modal`, `pui-accordion`, `pui-timeline` + `pui-checkpoint`, `pui-float`,
  `pui-group-row`/`pui-group-col`.
- **Stil:** `pui-solid`, `pui-soft`, `pui-outline`, `pui-link`.
- **Renk rolü:** `pui-theme`, `pui-success`, `pui-warn`, `pui-error`,
  `pui-muted`, `pui-surface`, `pui-inverse`.

Örnek: `<button class="pui-btn pui-solid pui-theme">`. Ekranlar bu sınıfları
doğrudan yazmaz; aşağıdaki bileşenleri kullanır.

## 4. Bileşen kütüphanesi (`apps/web/src/components/ui`)

Her bileşen ayrı dosyadadır, prop'ları tiplidir, `any` yoktur; DOM düğümünün
işe yaradığı yerde `forwardRef` kullanılır. Ortak sözlük `types.ts` içindedir
(`UiVariant`, `UiTone`, `UiSize`, `cx()`, `look()`).

| Bileşen | Kit sınıfları | Not |
|---------|---------------|-----|
| `Button` | `pui-btn` + stil + renk | `variant` solid/soft/outline/link, `tone` yedi rol, `size` sm/md, `loading`, `icon`, `iconOnly` (aria-label ile), `block` |
| `LinkButton` | `pui-btn` + stil + renk | Next `Link`, buton görünümlü gezinme |
| `AnchorButton` | `pui-btn` + stil + renk | Düz `<a>`, buton görünümlü dosya indirme ve harici bağlantı (Next yönlendiricisinden geçmez) |
| `Card`, `CardHeader`, `CardContent` | `pui-card`, `pui-card-header`, `pui-card-content` | Kart içinde kart yok |
| `Badge` | `pui-badge pui-soft pui-muted` (varsayılan) | Durum etiketi |
| `Chip`, `ChipButton` | `pui-chip pui-rounded-full` | Etiket ve filtre; `ChipButton` `aria-pressed` taşır |
| `Input`, `Select`, `Textarea` | `pui-input` | `invalid` -> `aria-invalid` (kit hata rengine boyar) |
| `FieldGroup` | `pui-field-group` | `<label>` sarmalayıcı: etiket, kontrol, ipucu/hata |
| `InputGroup`, `Addon` | `pui-input-group`, `pui-addon` | Arama ikonu, para birimi, birim |
| `Checkbox`, `Radio` | `pui-checkbox`, `pui-radio` | İsteğe bağlı `label` |
| `Switch` | `pui-switch` | `role="switch"` ve açık `aria-checked`; satır etiketi kitin "Dark mode" satırı gibi solda |
| `Table`, `Thead`, `Tbody`, `Tr`, `Th`, `Td` | `pui-table` (+ `pui-striped`, `pui-hoverable`) | Dış çizgi için `pui-card` içine konur |
| `List`, `ListItem` | `pui-list`, `pui-list-item` | |
| `Dropdown`, `DropdownItem`, `DropdownSection` | `pui-dropdown` | Yerel `popover="auto"` + `popovertarget`, CSS anchor positioning |
| `Tooltip` | `pui-tooltip` | `popover="manual"`, üzerine gelince ve odakta |
| `Modal` | `pui-modal` + `pui-card` | Yerel `<dialog>` + `showModal()`; Escape `onClose`'a gider |
| `Accordion`, `AccordionItem` | `pui-accordion`, `pui-accordion-item` | `<details>` |
| `Timeline`, `TimelineItem` | `pui-timeline`, `pui-checkpoint`, `pui-checkpoint-icon` | `horizontal` -> `pui-group-row` |
| `Float`, `Toast` | `pui-float` | `role="status"` |
| `Avatar` | `ui-avatar` + `pui-solid` + renk | 32 px, baş harfler veya görsel |
| `Tabs` | `pui-btn ui-tab` | `aria-pressed` taşıyan butonlar (butona rolüyle erişilir) |
| `EmptyState` | `ui-empty` | Kesik çizgili, ortalanmış |
| `PageHeader` | `ui-title` | Başlık (h2), açıklama, eylemler |
| `StatTile` | `pui-card` + `ui-stat-value` | Etiket, değer, ipucu, ikon rozeti |
| `Skeleton` | `ui-skeleton` | Yükleniyor yer tutucusu |

Kitin şekillerine eklenen birkaç yardımcı sınıf (`ui-btn-sm`, `ui-btn-icon`,
`ui-icon`, `ui-avatar`, `ui-title`, `ui-display`, `ui-lead`, `ui-heading`,
`ui-caption`, `ui-text-muted`, `ui-stat-value`, `ui-tabs`, `ui-tab`,
`ui-skeleton`, `ui-empty`, `ui-nav-link`, `ui-gradient-member-card`,
`ui-gradient-package-card`) `apps/web/src/app/globals.css` içinde `ui`
katmanında tanımlıdır; yalnızca token'ları kullanırlar.

T2a'da eklenen yardımcı sınıflar (hepsi `ui` katmanında, yalnızca token'larla):

| Sınıf | Ne için |
|-------|---------|
| `ui-text-error`, `ui-text-success`, `ui-text-warn`, `ui-text-theme` | Rol rengiyle metin (satır içi hata, tutar değişimi). `ui-caption`'dan sonra tanımlıdır, birlikte kullanılabilir |
| `ui-strong` | Yarı kalın (600) metin |
| `ui-panel` | Soluk zeminli, köşeli iç blok (not, önizleme, çubuk izi); kart içinde kart yerine kullanılır |
| `ui-rule`, `ui-divide` | Tek bir üst çizgi; ya da alt öğeler arasında ince çizgi (`List` ile) |
| `ui-card-link` | Tamamı bağlantı olan kart (ayarlar ana sayfası); üzerine gelince soluk zemin |
| `ui-alert` | Hata kutusu (`ErrorState`): hata renginde metin ve çizgi |
| `ui-bar-fill` | Grafik çubuğu dolgusu: `--pui-theme` zemin, `--pui-on-theme` metin; genişlik satır içi verilir |
| `ui-heat`, `ui-heat-cell` | Isı haritası: `--ui-heat` (yüzde) satır içi verilir, marka rengi soluk zeminle karışır |
| `ui-cal`, `ui-cal-gutter`, `ui-cal-head`, `ui-cal-hour`, `ui-cal-col`, `ui-cal-line`, `ui-cal-chip`, `ui-cal-month`, `ui-cal-weekhead`, `ui-cal-cell`, `ui-cal-mini` | Takvim ızgarası (gün/hafta/ay). `data-load` (`full`, `busy`, `normal`) seansı doluluğa göre boyar, `data-selected`, `data-cancelled`, `data-drop`, `data-outside` durumları |

T2b'de (CRM ve pazarlama) eklenen yardımcı sınıflar (hepsi `ui` katmanında, yalnızca token'larla):

| Sınıf | Ne için |
|-------|---------|
| `ui-small` | Mevcut rengi koruyan küçük metin (soluk renkli karşılığı `ui-caption`). Tailwind `text-xs` yerine |
| `ui-rail` | Liste öğesi veya alıntının solunda ince dikey çizgi (etkinlik akışı, iç içe segment grubu, kaynak alıntısı) |
| `ui-drop-col`, `ui-draggable` | Satış hattı sütunu: `data-drop="true"` iken kesik marka çerçevesi; `draggable` kart `grab` imleci alır |
| `ui-drawer-backdrop`, `ui-drawer` | Soluklaştırılmış sayfa üstünde sağdan açılan panel (onay kuyruğu detayı) |
| `ui-banner` | Solunda marka renkli şerit olan bildirim kartı (`pui-card` ile birlikte; abonelik bandı). `data-urgent="true"` çerçeveyi de boyar |
| `ui-pick` | Seçilebilir satır (konuşma listesi): üzerine gelince ve `aria-current="true"` iken soluk zemin |
| `ui-rule-b`, `ui-split-start` | Tek alt çizgi (panel başlığı); iki panelli görünümde ilk panelin çizgisi (dar ekranda altta, 1024 px'den sonra sağda) |
| `ui-bar-fill[data-level]` | Bütçeyi aşan ölçer: `warning` uyarı, `exceeded` hata renginde dolar |
| `ui-status-item`, `ui-status-dot` | İçerik takvimi öğesi ve gösterge noktası; `data-status` (`PLANNED`, `DRAFTED`, `APPROVED`, `SENT`, `CANCELLED`) sol kenar rengini seçer |
| `ui-dashed-item`, `ui-dashed-swatch` | Kesik çizgili satır (takvimde kampanya) ve göstergedeki küçük örneği |

T3'te (süper admin paneli) eklenen yardımcı sınıflar (hepsi `ui` katmanında, yalnızca token'larla):

| Sınıf | Ne için |
|-------|---------|
| `ui-mono` | Anahtar, kod, kimlik, sürüm ve yığın izi gibi tek aralıklı metin (küçük boyutlu). Tailwind `font-mono` yerine |
| `ui-bar-fill[data-level='complete']` | Tamamlanmış ölçer (çeviri tamamlanma çubuğu yüzde yüzde): başarı renginde dolar |

T4'te (mağaza, etkinlikler, topluluk, abonelik, herkese açık sayfalar) eklenen yardımcı sınıflar (hepsi `ui` katmanında, yalnızca token'larla):

| Sınıf | Ne için |
|-------|---------|
| `ui-choice` | Seçilebilir satır (abonelik planı, rezervasyon saati): çizgili, köşeli, içindeki radyo seçiliyken (`:has(input:checked)`) marka renginde çerçeveli. `<label>` üzerine konur |
| `ui-eyebrow` | Grup etiketinde büyük harf ve harf aralığı (Tailwind `uppercase`/`tracking-*` yerine) |
| `ui-capitalize` | İlk harfi büyütür (yerel biçimli tarih; Tailwind `capitalize` yerine) |

Bunlara ek olarak mağaza, etkinlik ve topluluk ekranları yeni sınıf gerektirmeden mevcut
bileşenlerle yazıldı. Küçük herkese açık ekranların (abonelikten çık, çift onay,
paylaşılan gönderi) ortak çerçevesi `components/common/PublicShell.tsx`'tir: kit zemini
üzerinde ortalanmış tek `Card`.

Kalıplar (süper admin): formlar `Card` içinde `<form className="pui-card-content">`
(kart başlığı `h3.ui-heading`); yer tutucuyla çalışan kısa alanlar `Input`/`Select`,
etiketli alanlar `FieldGroup`; liste ve çizelgeler `Card` + `Table`
(`overflow-x-auto`); durum rozetleri `Badge` (etkin `muted`, askıda `solid error`);
kapanıp açılan ayrıntılar (hata olayları, yığın izi) `Accordion`; yığın izi ve
günlük blokları `<pre className="ui-panel ui-mono">`; sayfa içi geri bağlantısı
`LinkButton variant="link" tone="surface"`. `global-error.tsx` kök düzen yokken
çalıştığı için kit CSS'ini kendisi içe aktarır.

Kalıplar: sekme şeridi gibi görünen gezinme `ui-tabs` + `LinkButton`
(`solid theme` etkin, `link surface` diğerleri); filtre düğmeleri `ChipButton`;
panelin içindeki ikincil blok (adım, çıktı, kod) `ui-panel`; metin içi
bağlantılar `pui-link pui-surface`; satır içi kaldır/aç eylemleri
`Button variant="link"`. `components/growth/ui.tsx` (`Panel`, `Field`,
`Notice`, `Muted`, `PageHeader`) bileşen kütüphanesinin üstüne yazıldı;
eski `inputClass`/`inputStyle` (`legacy-controls.ts`) T4'te kaldırıldı, alanlar
`Input`/`Select`/`Textarea` ile yazılır.

`components/common` (Badge, Modal, Tabs, DataState, PermissionButton,
Forbidden, DateRangeFilter, BranchSelect) ve `components/settings/ui.tsx` bu
kütüphanenin üstüne yeniden yazıldı; dışa açılan API'leri aynı kaldığı için
mevcut çağrı noktaları değişmeden derlenir.

## 5. Web entegrasyonu: katmanlar, reset, Tailwind

- Kit CSS'i (`@chrissgon/perfectui/perfectui.css`) `app/layout.tsx` içinde bir
  kez içe aktarılır. Kit CSS katmanları (cascade layers) kullanır. Katman
  sırası `globals.css`'in ilk satırındadır:
  `@layer reset, pui.tokens, pui.components, ui, pui.utilities, pui.styles, pui.colors, pui.states;`
  Bu satırın kitten önce görülmesi gerektiği için `globals.css` kitten
  **önce** içe aktarılır (sıra derleme çıktısında doğrulandı).
- Tailwind'in preflight'ı kapalıdır (`tailwind.config.ts`,
  `corePlugins.preflight: false`): katmansız preflight kitin katmanlarını
  ezerdi. Yerine `globals.css` içindeki `@layer reset` en alttaki katmanda
  küçük bir sıfırlama yapar (box-sizing, margin, liste, görsel, form
  öğelerinde font mirası, varsayılan çizgi stili).
- Tailwind yardımcı sınıfları katmansız kalır ve yalnızca **yerleşim** için
  kullanılır: flex, grid, gap, padding, margin, genişlik, görünürlük, kırpma.
  **Renk, çizgi rengi, köşe (rounded), gölge ve tipografi için Tailwind
  kullanılmaz.** `tailwind.config.ts`'deki `brand` ve `studio` renk
  ölçekleri silindi. Bu fazda dokunulan dosyalardan `bg-*`, `text-*` (renk ve
  boyut), `border-*` rengi, `rounded-*`, `shadow-*` sınıfları kaldırıldı;
  diğer dosyalar sonraki fazlarda taşınır.
- `body` zemini ve metni `--pui-bg` / `--pui-text`, yazı tipi Inter.
  Makbuz yazdırma kuralı ve kaydırma çubukları korunur.
- Kitin JavaScript'i (eksik tarayıcı özellikleri için yedekler, `mode.js`)
  yüklenmez: modu `ThemeRoot` yönetir; anchor positioning ve `popover`
  güncel Chromium/Safari/Firefox'ta yereldir.

## 6. İşletme markası ve açık/koyu mod: `ThemeRoot`

`apps/web/src/components/theme/ThemeRoot.tsx` bir alt ağacı temalandırır:

1. `resolveTheme({ tenant, appearance, systemMode })` her zaman Perfect UI
   ailesini, kullanıcının modunu ve işletmenin rengini/logosunu döndürür.
2. `themeCssVariables()` sonucu sarmalayıcı `div`'in `style`'ına yazılır.
3. `<html>` sarmalayıcının dışında olduğu için mod sarmalayıcının kendisinde
   taşınır: `data-pui-mode="light|dark"` (sistem seçiminde yok) ve
   `color-scheme: light | dark | light dark`. Token'lar `light-dark()`
   çiftleri olduğundan, değeri kullanan öğenin `color-scheme`'ine göre
   çözülür; diyaloglar ve açılır menüler de DOM'da sarmalayıcının içinde
   kaldığı için aynı modu izler.

Kullanıldığı yerler: tenant paneli (`(dashboard)/layout.tsx`, kullanıcının
`appearance` tercihiyle), sayfa motoru sayfaları (`SitePage`, sistem modu).
Süper admin paneli, pazarlama paneli, güvenlik ekranları ve davet sayfası
`AdminTheme` ile kit varsayılanlarını alır (işletme yok); süper admin ve
pazarlama düzenleri platform kiracısının (`slug: platform`) birincil rengini
`fetchPlatformBrand()` ile geçirir ve işletim sistemi modunu izler. Giriş
sayfası ve `/` açılış sayfası kit varsayılanlarıyla, işletim sistemi
moduyla çalışır.

Kullanıcı modunu iki yerden değiştirir: üst bardaki kullanıcı menüsündeki
"Koyu mod" anahtarı (`PUT /me/appearance`, ardından sayfa yenilenir) ve
`/ayarlar/gorunum` (açık / koyu / cihazla aynı). İşletme sahibi aynı sayfada
logo ve birincil rengi değiştirir; önizleme üye kartı, paket kartı ve düz
birincil butonu gösterir.

## 7. İki gradyan alanı

Gradyan yalnızca `ui-gradient-member-card` (üye kartı başlığı) ve
`ui-gradient-package-card` (aktif paket kartları) sınıflarında görünür;
ikisi de `--gradient-brand` ve üzerindeki metin için `--gradient-brand-on`
kullanır. Başka hiçbir yerde gradyan yazılmaz. Mobil `GradientSurface`
yalnızca bu iki alanı kabul eder; mobil birincil buton ve başlık bandı düz
işletme rengine geçti.

## 8. Yeni bir ekran nasıl yazılır

1. Sayfa başlığı için `PageHeader`, bölümler için `Card`/`CardHeader`/
   `CardContent` (ya da tek seviye `pui-card`), listeler için `List` veya
   `Table`, boş durum için `EmptyState` (veya `common/DataState`).
2. Eylemler `Button`/`LinkButton`; yetkiye bağlı eylemler
   `common/PermissionButton`. Birincil eylem `solid theme`, ikincil
   `outline surface`, yıkıcı `outline error`.
3. Formlar `FieldGroup` + `Input`/`Select`/`Textarea`; açık/kapalı
   ayarlar `Switch`.
4. Yerleşim için Tailwind (flex, grid, gap, padding). Renk gerektiğinde
   bileşenin `tone`'u; çok nadiren satır içi `style` yalnızca token
   değişkeniyle (`var(--pui-error)` gibi). Hex renk, Tailwind renk sınıfı,
   gölge yok.
5. Her metin `useT()` / `getT()` ile i18n anahtarından (tr + en aynı PR'da);
   tarih, sayı ve para `Intl` ile etkin dilde.
6. Playwright'ın kullandığı `data-testid`, görünür Türkçe etiket ve
   erişilebilir rol/adlar korunur; değiştirmeden önce `apps/web/e2e` içinde
   aranır.

## 9. Ekran görüntüleri (sahip için görsel kayıt)

`apps/web/e2e/screenshots.e2e.ts` CI'daki web e2e işinde çalışır ve şu
ekranların 1440x900, tam sayfa PNG'lerini açık ve koyu modda
`apps/web/screenshots/<ad>-<mod>.png` olarak kaydeder: açılış (`landing`),
giriş (`login`), genel bakış (`dashboard`), takvim (`calendar`), üye listesi
(`members`), bir üye kartı (`member-card`), ayarlar (`settings`), süper admin
genel bakış (`admin-home`), işletmeler (`admin-tenants`), pazarlama panosu
(`marketing-dashboard`). Tenant ekranlarında koyu mod uygulamanın yaptığı
gibi kullanıcının görünüm tercihiyle ayarlanır ve test sonunda eski değere
döner; herkese açık sayfalar ve süper admin işletim sistemi modunu izlediği
için orada mod taklit edilir. Yalnızca gezinme hatası testi düşürür;
çekilemeyen bir görüntü açıklama (annotation) olarak kaydedilir.

GitHub Actions'ta `web-e2e` işi her koşuda (`if: always()`)
`web-screenshots` artefaktını yükler (14 gün saklanır). Klasör `.gitignore`
içindedir.

## 10. Sonraki fazlar

T1'de kitle tamamen yeniden yazılan ekranlar: tenant paneli kabuğu (yan menü,
üst bar, kullanıcı menüsü), süper admin kabuğu ve genel bakışı, giriş sayfası,
`/` açılış sayfası, genel bakış (istatistikler, hızlı işlemler, bugünün
programı, şubeler), üye listesi, üye kartı, takvim kabuğu (araç çubuğu,
filtreler, yan panel), `/ayarlar/gorunum` ve `components/common` +
`components/settings/ui.tsx` üzerinden onları kullanan her ekran.

T2a'da tenant panelinin operasyon ekranları taşındı: ayarlar ana sayfası ve
tüm alt sayfaları (`web-sitem` içindeki `SiteEditor` hariç), finans (ödemeler,
faturalar, giderler, promosyonlar, banka ödemeleri, bordro, muhasebe dışa
aktarımı), raporlar, takvim ızgarası (gün/hafta/ay) ve seans formları,
yoklama, paketler, antrenörler, paket satış diyaloğu, sadakat paneli ve
düşük stok bileşeni.

T2b'de CRM ve pazarlama ekranları taşındı: kişiler (liste, kart, satış hattı),
adaylar, gelen kutusu, riskli üyeler, tavsiye, reklam performansı, segmentler,
kampanyalar (A/B ve gönderim zamanı bölümleri dahil), akışlar (şablonlar ve
editör), entegrasyon merkezi (OAuth, aday reklamları, SMS gönderici,
otomasyon) ve platform pazarlama paneli (pano, marka kiti, yapay zeka
stüdyosu, içerik takvimi, onaylar, sosyal gönderiler, içgörüler, reklam
sekmeleri) ile bunların kullandığı `components/growth`, `components/marketing`,
`components/leads`, `components/churn`, `components/integrations`,
`components/ai` ve `components/billing` bileşenleri.

T3'te süper admin paneli taşındı: yapay zeka, benchmark, iş türleri, içerik,
denetim, entegrasyonlar kabuğu, özellik bayrakları, hatalar (liste, uyarılar,
ayarlar, ayrıntı), sağlık, dil yönetimi (liste ve çeviri düzenleyici), pazarlama
ayarları, planlar, platform kullanıcıları, tavsiye, SMS paketleri, işletmeler
(`TenantBillingActions` dahil), uygulama pazarı, web sitesi sayfa kabuğu ve
yedekler; bunların kullandığı `components/admin` (`AiTranslatePanel`,
`GlossaryPanel`, `TenantBillingActions`) ve `components/errors` bileşenleri.

T4'te kalan tenant ekranları ve tüm herkese açık sayfalar taşındı: mağaza (ürünler,
satışlar, stok hareketleri, rapor, ayarlar, hızlı satış, satış fişi ve iade
diyaloğu; fiş yazdırma kuralı `globals.css`'te aynı kaldı), etkinlikler (liste,
yeni etkinlik, düzenleyici: ayrıntılar, oturumlar, biletler, kayıtlar), topluluk,
abonelik, çerez izni bandı ve çerez tercihleri düğmesi, abonelikten çık (`/m/u`),
çift onay (`/onay`), paylaşılan gönderi (`/paylasim`), davet sayfası (`/j`),
iki adımlı doğrulama (`/guvenlik`), herkese açık rezervasyon sayfası ve gömülebilir
rezervasyon aracı (`/embed`; işletmenin marka rengini kendisi çözmeye devam eder).
`components/retail/styles.ts` ve `components/growth/legacy-controls.ts` silindi.
Tailwind `font-mono`, `uppercase`, `italic` ve `capitalize` sınıfları tüm
ekranlarda `ui-mono`, `ui-eyebrow`, `ui-capitalize` yardımcılarına çevrildi.

T5'te mobil uygulama taşındı (ayrıntı: `docs/MOBILE_APP.md`, "Tasarım dili"): yedi eski
yazı tipi paketi kalktı ve yazı tipi yalnızca Inter (400, 500, 600, 700); `PERFECT_UI_TOKENS`
tek renk, köşe, boşluk ve boyut kaynağı oldu; `Button`, `Card`, `Badge`, `Chip`, `ListRow`,
`EmptyState`, `SectionTitle`, `StatTile`, `Skeleton` ilkelleri eklendi ve eski bileşenler (`PrimaryButton`,
`TextField`, `ChoiceRow`, `SwitchRow`, `DateTimeField`, `SessionDetail`, `MemberCard`, `PackageCard`,
`PermissionGate`) bunların üzerine yeniden yazıldı; sekme çubuğu ve tüm yığın başlıkları token'dan stil
alıyor; Görünüm ekranı yalnızca açık/koyu/sistem, İşletme teması ekranı yalnızca logo ve ana renk
düzenliyor (aile ve gradyan seçicileri ile `Swatches` kalktı); gradyan yalnızca üye ve paket kartında.

Kalan: sayfa motoru blokları ve sayfaları (`components/sites/*`) T6'da taşınır. Mobilde
kalanlar: durum renkleri (`palette.danger/success/warning`) ekranlarda açık moddaki kit değerleriyle
kullanılıyor, koyu modda rol rengine (`theme.roles`) geçiş ve ekranların `Card`/`ListRow` ilkellerine tam
taşınması (şu an yalnızca ana ekran ve Hesabım menüsü; diğer ekranlar token'lı kendi stillerini
kullanıyor) sonraki iştir; Android widget'ı ve kök hata ekranı tema dışı kalır; gerçek cihazda görsel
doğrulama yapılmadı. `apps/web/src` içinde
(`components/sites` hariç) Tailwind renk/köşe/gölge/tipografi sınıfı veya sabit renk
kalmadı; geriye yalnızca değeri `var(--pui-*)` token'ı olan satır içi `style`'lar
(`ThemeRoot`, açılış sayfası, üye kartı gradyan alanı, `Header` zemini), marka rengi
alanının sabit `#0092cd` varsayılanı ve `ui-*` sınıflarıyla çözülemeyen konumlandırma
stilleri (bal tuzağı alanı) var.

## 11. Lisans bildirimi (Perfect UI)

Perfect UI MIT lisansıyla dağıtılır. Kitin lisans metni aşağıdadır.

```
MIT License

Copyright (c) 2022 Christopher Gonçalves

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Kitin Figma dosyası ticari ve kişisel projelerde ücretsiz kullanılabilir
(kitin README'si).
