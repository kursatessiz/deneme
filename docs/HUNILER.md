# Dönüşüm hunileri (G5d-1)

Kişilerin adım adım ilerleyişini gösterir: her adımda kaç kişi kaldı, önceki adımdan ve ilk adımdan dönüşüm oranı, adımlar arası medyan süre; kaynak, kampanya ve şube kırılımı; önceki dönemle karşılaştırma. Bağlayıcı tasarım `docs/BUYUME_VE_GLOBAL_MIMARI.md` bölüm 3.11 "Dönüşüm hunileri" maddesidir; veri kaynağı `docs/CRM_VE_ATIF.md` içindeki `ConversionEvent` ve `Touchpoint` tablolarıdır. Sektörden bağımsızdır: adım adları dönüşüm olayı türleridir (`lead`, `trial_booked`, ...), kiracının kelime dağarcığına bağlı değildir.

## 1. Kavramlar

- **Adım**: bir `ConversionEvent` türü (`CONVERSION_EVENT_TYPES`, `packages/shared/src/growth/conversions.ts`). Hazır hunilerde ek olarak `visit` sözde adımı vardır: kişinin ilk izlenen ziyareti (kişiye bağlı en eski `Touchpoint`). `visit` bir dönüşüm olayı değildir ve kiracı hunilerinde kullanılamaz.
- **Ulaşma**: bir kişi k. adıma, o adımın türünde, (k-1). adıma ulaştığı andan **sonra veya aynı anda** gerçekleşen en erken olay varsa ulaşır. Sıra dışı olaylar (önceki adımdan önce olanlar) sayılmaz. Pencere (`windowDays`) verilmişse olay, önceki adımdan en geç o kadar gün sonra olmalıdır (sınır dahil).
- **Giriş**: kişinin ilk adımın en erken olayı seçilen tarih aralığında (`from` ve `to` dahil) ise huniye girmiştir. Aralık dışında ilk adımı olan kişiler sayılmaz, bir sonraki adımların aralık kısıtı yoktur (giriş dönemine göre kohort mantığı).
- **Hariç tutulanlar**: `isTest` işaretli olaylar, test kişileri (`Contact.isTest`) ve başka kişiyle birleştirilmiş kişiler (`mergedIntoId`).
- **Ölçü**: her adım için ulaşan kişi sayısı, `ulaşan / önceki adım` (önceki 0 ise boş), `ulaşan / ilk adım` (kimse girmediyse boş) ve önceki adımdan bu adıma medyan süre (saniye; adıma ulaşanlar arasında, iki ortadaki değerin ortalaması, `percentile_cont(0.5)` ile aynı).

## 2. Hazır huniler (kod, satır değil)

`packages/shared/src/funnels.ts` içindeki `READY_MADE_FUNNELS`; kimlikleri `ready.<slug>`. Adları ve açıklamaları `funnels.ready.<slug>.*` i18n anahtarlarıdır.

| Kimlik | Adımlar | Not |
|---|---|---|
| `ready.lead-to-member` | `lead` -> `trial_booked` -> `trial_attended` -> `purchase` | Üye = ilk satın alma (`purchase`) |
| `ready.trial-to-member` | `trial_booked` -> `purchase` | |
| `ready.visitor-to-member` | `visit` -> `lead` -> `purchase` | Web sitesi takibi olan işletmeler için (`requiresSiteTracking`); takip verisi yoksa boş durum gösterilir, hata değil |

`purchase` olayı, ödeme COMPLETED olduğunda yazılır (deneme paketi dahil; bkz. `docs/CRM_VE_ATIF.md` bölüm 7). Yalnızca tutarı sıfırdan büyük satın almaları "üye" saymak ayrı bir karardır (bölüm 8).

## 3. Kiracı huniler

`funnels` tablosu (migration `20261011000000_funnels`): `studio_id`, `name`, `steps` (JSON), `window_days` (boş = süre sınırı yok), `created_by_membership_id`, zaman damgaları. `steps`, `TenantFunnelStepsSchema` ile her yazımda ve okumada doğrulanır: 2 ile 6 adım, her tür en fazla bir kez, yalnızca dönüşüm olayı türleri. `windowDays` 1 ile 365 arası tam sayıdır. Şema `packages/shared/src/funnels.ts` içindedir (`CreateFunnelSchema`, `UpdateFunnelSchema`); web ve API aynı şemayı kullanır.

## 4. API

Hepsi `studios/:studioId/funnels` altındadır (`JwtAuthGuard` + `StudioTenantGuard` + `PermissionGuard`); servis her sorguyu `tenant.studioId` ile süzer, yazma işlemleri (`updateMany`/`deleteMany`) `studioId` koşulunu yazmanın kendisinde taşır.

| Uç nokta | İzin |
|---|---|
| `GET /` (hazır huniler + kiracının hunileri) | `reports.view` |
| `GET /:id/report?from&to&breakdown=source\|campaign\|branch&compare=previous&branchId` | `reports.view` |
| `POST /`, `PATCH /:id`, `DELETE /:id` (204) | `funnels.manage` |

- `:id` bir hazır huni kimliği (`ready....`) veya kiracı huninin UUID'sidir; bilinmeyen kimlik ve başka kiracının huni kimliği 404 döner.
- `from`/`to` mevcut `ReportRangeSchema` ile aynıdır: verilmezse son 30 gün, en fazla 366 gün.
- `compare=previous`: aynı uzunlukta, seçilen aralığın hemen öncesindeki pencere (`previousPeriodWindow`, `packages/shared/src/report-compare.ts`; rapor sayfasındaki karşılaştırma yardımcısıyla aynı kod). Yanıttaki `previous` alanı o dönemin adım istatistiklerini taşır.
- `breakdown`: `source` = kişinin ilk kaynağı (`Contact.firstSource`: `utm_source`, yoksa reklam platformu, yoksa yönlendiren host; yoksa `(direct)`); `campaign` = ilk kampanya kimliği (`pw_cid`, `utm_id`), yoksa kampanya adı, yoksa `(none)`, etiket olarak kampanya adı; `branch` = kişinin şubesi (`Contact.branchId`), yoksa `(none)`, etiket olarak şube adı. Kırılım, atıf raporuyla tutarlı olsun diye ilk temas özetine dayanır. En fazla 100 satır, girişe göre azalan sırada.
- Şubeyle kısıtlı personelde yalnızca kendi şubelerindeki ve şubesiz kişiler sayılır; `branchId` süzgeci erişilemeyen şubede 403 döner.
- Denetim kaydı: `funnel.create`, `funnel.update`, `funnel.delete`.

## 5. Hesaplama (SQL)

`apps/api/src/modules/funnels/funnel-sql.ts`, rapor başına **tek** `$queryRaw` (tüm değerler bağlı parametre; yalnızca adım sayısı, 2-6, SQL metnini biçimlendirir):

1. `ev` CTE: `conversion_events` (kiracı + `is_test = false` + test ve birleştirilmiş kişi süzgeci) `unnest(steps) WITH ORDINALITY` ile adım sırasına eşlenir; `visit` adımı varsa `touchpoints` kişi başına en eski kayda indirgenip `UNION ALL` ile eklenir.
2. `p1`: kişi başına ilk adımın en erken zamanı, aralık `HAVING` ile.
3. `p2..pn`: her adım bir önceki CTE'ye `LEFT JOIN ev` ile bağlanır (`e.occurred_at >= önceki`, pencere varsa `<= önceki + N gün`), `MIN(occurred_at)` alınır. Kişi başına yinelenen sorgu yoktur (N+1 yok); birleşimler hash join ile çalışır.
4. Sonuç: `COUNT(t_k)` ve `percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM t_k - t_(k-1)))`; kırılımda `GROUPING SETS ((), (bkey))` ile toplam satırı ve grup satırları aynı sorguda gelir.

Index: `conversion_events (studio_id, type, contact_id, occurred_at)` (migration ile eklendi; adım başına tür taraması ve kişiye göre gruplama için). Mevcut `(studio_id, type, occurred_at)` ve `touchpoints (studio_id, contact_id, occurred_at)` da kullanılır.

Saf kurallar `packages/shared/src/funnels.ts` içindedir ve birim testlidir: `resolveFunnelPath` (bir kişinin adım zamanları: sıra, pencere), `aggregateFunnelPaths` (giriş aralığı, sayı, medyan; SQL'in belirtimi), `medianOf`, `buildFunnelSteps` (oranlar), `compareFunnelSteps` (dönem farkı), `pickDurationUnit`. SQL bu kurallarla aynı sonucu verir; API e2e bunu kurgulanmış veriyle doğrular.

## 6. Web

`/raporlar` sayfasında "Huniler" sekmesi (`apps/web/src/components/reports/FunnelsTab.tsx`): huni seçici (hazır + kendi hunilerim), kırılım seçici, sayfadaki tarih aralığı, şube ve "Önceki dönemle karşılaştır" anahtarı. Adımlar CSS ile çizilen yatay çubuklardır (tasarım token'ları, grafik kütüphanesi yok); her adımda sayı, önceki adımdan ve ilk adımdan oran, medyan süre; karşılaştırmada önceki dönem sayısı ve değişim yüzdesi. Kırılım tablosu adım başına sayı ve ilk adımdan oranı gösterir. Veri yoksa ortak `EmptyState`. "Yeni huni", "Düzenle" ve "Sil" yalnızca `funnels.manage` izni olanlara görünür; düzenleyici (`FunnelEditor.tsx`) ad, 2-6 adım (sıra değiştirme, ekleme, çıkarma), ve isteğe bağlı gün penceresi alır. Tüm metinler `funnels` i18n ad alanıdır (tr + en).

## 7. İzinler

- Görüntüleme ve rapor: mevcut `reports.view`.
- Oluşturma, düzenleme, silme: yeni `funnels.manage` (alan: Bildirim, `reports.view` ile aynı grup). Varsayılan olarak yalnızca sahip; migration mevcut kiracıların sahip rollerine ekler, yeni kiracılar sahip kuralıyla alır. Diğer roller kiracı tarafından verilebilir.

## 8. Kararlar ve sınırlar

- **Kırılım ilk temasa dayanır**; son temas veya doğrusal model yoktur (atıf raporundaki gibi modeller huniye eklenmedi).
- **"Üye" = ilk `purchase` olayı**; ödeme tutarı sıfırdan büyük şartı yoktur. Ücretsiz veya deneme paketi satışı da `purchase` yazar. Sıfır tutarlıları ayırmak istenirse olay türü veya süzgeç eklemek gerekir; sahibin kararı.
- **Adımlar arasında yeniden giriş yok**: bir kişi tüm adımlarda yalnızca en erken geçerli olayıyla sayılır; aynı kişi aynı huniye birden fazla kez girmez.
- **Kişi kimliği**: olaylar `contactId` üzerindendir; birleştirilen kişinin olayları kalan kişiye taşınmıştır, birleştirilmiş kişi hariçtir.
- **`visit` adımı** yalnızca ziyaretçi bir kişiye bağlandıktan (form, deneme, kayıt) sonra oluşur; bağlanmamış ziyaretçiler huniye girmez.
- Ülke, para birimi veya dil varsayımı yoktur; sayılar ve yüzdeler görüntüleyenin diline göre `Intl` ile biçimlenir.
- Dışa aktarma (CSV) ve zamanlanmış huni özeti bu fazda yoktur.

## 9. Nasıl test edilir

```bash
pnpm turbo run build typecheck test          # packages/shared/src/funnels.spec.ts dahil

# Postgres çalışırken
export DATABASE_URL=postgresql://u:pw@localhost:5432/g5d1_test
cd packages/database && pnpm exec prisma migrate deploy && TURBO_ENV_MODE=loose pnpm db:seed
cd ../../apps/api
JWT_SECRET=... OTP_TEST_CODE=482915 NODE_ENV=test npx jest -c test/jest-e2e.config.js funnels
cd ../web && pnpm exec playwright test funnels
```

- `apps/api/test/e2e/funnels.e2e-spec.ts`: iki kişiden fazlasını içeren kurgu (tamamlayan, adım sonrası düşen, sıra dışı olaylı, test kişisi, test olayı, aralık dışı, pencereyi aşan); sayılar, oranlar, medyanlar, kaynak/kampanya/şube kırılımı, önceki dönem, ziyaretçi hunisi, CRUD doğrulaması, kiracı izolasyonu ve izin denetimleri.
- `apps/web/e2e/funnels.e2e.ts`: sekme, huni ve kırılım seçimi, karşılaştırma, kiracı huni oluşturma, düzenleme ve silme (`getByRole('main')` kapsamlı; bu ortamda koşturulamadı).
