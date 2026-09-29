# Yapay Zeka Çekirdeği (G3b)

Bu belge platformun yapay zeka katmanını anlatır: anahtarın nereye girildiği, maliyetin nasıl kontrol edildiği, otomatik dil çevirisinin nasıl çalıştığı ve makine çevirilerinin nasıl onaylandığı. Bağlayıcı tasarım `docs/BUYUME_VE_GLOBAL_MIMARI.md` bölüm 3.10'dur.

## Özet

- Tek sağlayıcı katmanı: `apps/api/src/modules/ai`. Bütün model çağrıları `AiService.run()` üzerinden geçer; sağlayıcı bir adaptördür (`AiProviderAdapter`). Şu an tek adaptör resmi `@anthropic-ai/sdk` paketiyle Anthropic Claude'dur (`AnthropicAiAdapter`). Testler ve web e2e ortamı gerçek sağlayıcıyı hiç çağırmaz; yerine deterministik `FakeAiAdapter` kullanılır.
- Anahtar yoksa her şey kapalıdır. Yapay zeka düğmeleri "Yapay zeka henüz yapılandırılmadı" hatası verir (`AI_NOT_CONFIGURED`, HTTP 503); platformun geri kalanı etkilenmez.
- Görevler: dil çevirisi (`TRANSLATION`), metin yazımı (`COPYWRITING`), gelen kutusu cevap önerisi (`REPLY_SUGGESTION`). Her görevin modeli süper admin ayarıdır.
- Her çağrı `ai_usage` tablosuna token ve tahmini maliyetle yazılır; işletme başına aylık limit her çağrıdan önce kontrol edilir.

## Kurulum: anahtar nereye girilir

1. [Anthropic Console](https://console.anthropic.com) üzerinden bir API anahtarı oluşturun (`sk-ant-...`). Kuruluşunuzda harcama limiti tanımlamanız önerilir; platformdaki limitler buna ek bir güvenliktir.
2. Süper admin panelinde **Yapay Zeka** sayfasını açın (`/admin/ai`).
3. **API anahtarı** alanına anahtarı yapıştırıp **Anahtarı kaydet** deyin. Anahtar `INTEGRATION_ENCRYPTION_KEY` ile AES-256-GCM kullanılarak şifrelenir (`CredentialCipher`, reklam bağlantılarıyla aynı düzen). Veritabanında yalnızca şifreli metin ve son dört karakter durur; API anahtarı hiçbir yanıtta, logda veya denetim kaydında geri döndürmez.
4. **Bağlantıyı test et**: en ucuz modelle tek, çok küçük bir çağrı yapar ve sonucu (ör. "anahtar kabul edilmedi") gösterir. Test çağrısı da platform kullanımına yazılır.
5. Anahtarı değiştirmek için yenisini yapıştırmanız yeterlidir; **Anahtarı sil** bütün yapay zeka özelliklerini kapatır.

Üretimde `INTEGRATION_ENCRYPTION_KEY` tanımlı değilse anahtar kaydedilmez (`AI_ENCRYPTION_UNAVAILABLE`). Anahtarı sunucu ortam değişkeni olarak vermek isterseniz `ANTHROPIC_API_KEY` kullanılabilir; panelden kaydedilmiş bir anahtar her zaman önceliklidir. Ortam değişkeni Zod env şemasında isteğe bağlıdır.

`INTEGRATION_ENCRYPTION_KEY` değiştirilirse kayıtlı anahtar çözülemez; o durumda anahtarı panelden yeniden kaydedin.

## Modeller

Varsayılanlar işi iyi yapan en ucuz modeldir:

| Görev | Varsayılan model | Neden |
|---|---|---|
| Dil çevirisi | `claude-sonnet-5` | Arayüz metinlerinde doğruluk ve tutarlılık gerekir |
| Metin yazımı | `claude-sonnet-5` | Pazarlama metni kalite ister |
| Cevap önerisi | `claude-haiku-4-5-20251001` | Kısa cevap, en düşük maliyet |

Süper admin **Görev başına model** bölümünden her görevin model kimliğini değiştirebilir. Yeni modellerde (Sonnet 5, Opus 5 ailesi vb.) istek düşük "effort" ile gönderilir, böylece gereksiz düşünme maliyeti oluşmaz; eski modellerde bu alan gönderilmez.

## Maliyet kontrolü

- **Fiyat tablosu**: `packages/shared/src/ai/models.ts` içindeki `AI_PRICE_TABLE`, milyon token başına USD fiyatlarını tutar (girdi, çıktı, önbelleğe yazma, önbellekten okuma). Sağlayıcı fiyat değiştirirse süper admin **Fiyat tablosu** bölümünden satırı günceller; özel fiyat kaydedilir ve varsayılana döndürülebilir. Tabloda olmayan bir model bilerek yüksek bir fiyatla (`AI_FALLBACK_PRICE`) hesaplanır.
- **Ölçüm**: her çağrı (başarılı veya başarısız) `ai_usage` satırıdır: işletme (platform işleri için boş), görev, model, girdi/çıktı/önbellek tokenları ve tahmini maliyet. Maliyet mikro-dolar (1e-6 USD) olarak tam sayı saklanır, çünkü kısa bir cevap önerisi bir sentten çok daha ucuzdur ve sente yuvarlamak onu sıfır gösterirdi. Limitler ve ekranlar sent/dolar cinsindendir.
- **İşletme başına aylık limit** (UTC takvim ayı), öncelik sırasıyla:
  1. Süper adminin işletmeye özel limiti (`studios.ai_monthly_budget_cents`, **Kullanım ve maliyet > İşletmelere göre > Limiti değiştir**),
  2. İşletmenin planındaki `aiMonthlyBudgetCents` (**Planlar** sayfası),
  3. Platform varsayılanı (**Varsayılan aylık limit**, başlangıçta 5 USD).
  Limit 0 ise o işletmede yapay zeka kapalıdır. Limit dolunca istek sağlayıcıya gitmeden reddedilir (HTTP 429, `AI_MONTHLY_LIMIT_REACHED`). Aynı anda yapılan çağrılar limiti en fazla kendi maliyetleri kadar aşabilir.
- **Dil çevirisi platform işidir**: hiçbir işletmenin limitinden düşmez, panoda "Platform (dil çevirisi)" satırında görünür.
- **Önbellek**: sabit sistem talimatları ve sözlük, istem önbelleği (prompt caching) ile gönderilir; bir çeviri işinin her grubunda aynı kalan bu kısım önbellekten okunur ve yaklaşık onda bir fiyatla ücretlendirilir.
- **Pano**: aylara, görevlere ve işletmelere göre çağrı, başarısız çağrı, token ve maliyet; işletme satırında bu ayın harcaması ve geçerli limit (özel/plan/varsayılan).

## Otomatik dil çevirisi nasıl çalışır

Yeni bir dil gerektiğinde: **Diller** sayfasında dili ekleyin (devre dışı başlar), dilin düzenleyicisini açın ve **Yapay zeka ile çevir** bölümünü kullanın.

1. **Kapsam**: tüm bölümler veya seçilen bölümler (ad alanları, ör. `common`, `nav`). Varsayılan olarak yalnızca **eksik** anahtarlar çevrilir. **Mevcut çevirilerin üzerine yaz** seçilirse (elle düzenlenenler dahil) onay istenir.
2. **İş oluşturma**: `POST /admin/i18n/languages/:code/ai-translate` çevrilecek anahtarları iş kalemi olarak kaydeder (`ai_translation_jobs`, `ai_translation_job_items`). Aynı dil için ikinci bir iş, ilki bitmeden başlatılamaz (409). Türkçe kaynak dildir, çevrilmez.
3. **Arka plan**: Redis varsa (üretim) iş BullMQ `ai` kuyruğunda hemen başlar ve bitene kadar kendini yeniden kuyruğa alır. Redis yoksa (yerel geliştirme, e2e) 15 dakikalık zamanlayıcı kalp atışı (`POST /admin/scheduler/run`) işi ilerletir; kalp atışı üretimde de kayıp bir kuyruk işine karşı güvenlik ağıdır.
4. **Gruplar**: anahtarlar 50'lik gruplar halinde tek istekte gönderilir. Kaynak Türkçedir; İngilizce değeri varsa ikinci referans olarak eklenir. Dilin sözlüğü ve kurallar sabit sistem talimatındadır.
5. **Doğrulama**: dönen her değer kaydedilmeden önce mevcut yer tutucu doğrulamasından (`validatePackMessages`) geçer: `{isim}` gibi yer tutucular birebir korunmalı, değer boş olmamalı, HTML içermemeli, 2000 karakteri aşmamalıdır. Geçemeyen anahtar bir kez daha denenir (sonraki bir grupta); ikinci denemede de geçemezse iş kaleminde neden kaydıyla "çevrilemedi" olarak işaretlenir.
6. **Çoğullar**: `x.one`/`x.other` gibi çoğul anahtarlar tek birim olarak gönderilir ve hedef dilin `Intl.PluralRules` kategorilerinin hepsi istenir. Örneğin Lehçe veya Rusça için `x.few` ve `x.many` de üretilir; bu ek biçimler de override olarak saklanır ve çevirmen (`createTranslator`) onları doğrudan kullanır.
7. **Kayıt**: kabul edilen değerler `translation_overrides` satırı olarak `source = AI`, `reviewed_at = NULL` ile yazılır. Üzerine yazma seçilmemişse, iş sürerken bir kişinin girdiği değer korunur (kalem "atlandı" sayılır).
8. **İlerleme**: CMS her iki saniyede bir işi sorgular: tamamlanan/toplam, çevrilemeyen ve atlanan sayısı, tahmini maliyet, çevrilemeyen anahtarların listesi. **Çeviriyi iptal et** işi durdurur (o anda süren grup tamamlanıp kaydedilir).
9. **Dayanıklılık**: iş kalemleri kendi durumunu taşır ve bir işçi süreli bir kilit alır; süreç çökerse veya zaman dilimi dolarsa kalan kalemlerle devam edilir. Sağlayıcı geçici hata verirse (429, 5xx, zaman aşımı) iş bekletilir ve artan aralıklarla yeniden denenir; art arda 5 geçici hatada veya anahtar/model hatasında iş "başarısız" olur.

### Sözlük

Her dilin **Sözlük** bölümünde terimler tanımlanır: "aynen kalsın" (ürün ve marka adları) veya sabit bir çeviri. Sözlük her istekte zorunlu kural olarak gönderilir.

## Onay (review) akışı

- Düzenleyicide **Kaynak** filtresi: Tümü, "Yapay zeka, onay bekliyor", Yapay zeka, Elle, Paket.
- Onay bekleyen satırda **Onayla** düğmesi tek anahtarı onaylar; **Görünen yapay zeka çevirilerini onayla** listedeki hepsini onaylar (`POST /admin/i18n/languages/:code/review`, gövde `{ keys }` veya boş = dilin tüm onay bekleyenleri).
- Bir yapay zeka değerini elle düzenlemek onu "Elle" kaynağına çevirir ve onaylanmış sayar. Dil paketi yüklemesi "Paket" kaynağıdır.
- Önerilen sıra: işi bitirin, onay bekleyenleri gözden geçirip onaylayın, sonra dili **Etkinleştir**in.

## İşletme tarafı: metin yazımı ve cevap önerisi

- İzin: `ai.use` (varsayılan olarak yalnızca işletme sahibi; rol şablonlarından verilebilir).
- **AI ile yaz**: kampanya düzenleyicisinde ve mesaj şablonu düzenleyicisinde. Kısa bir açıklama, metin türü (kampanya, e-posta, SMS, sayfa bölümü), ton ve dil seçilir; düz metin taslak döner. Şablon düzenleyicisinde **Metne ekle** taslağı gövdeye (e-postada konuya da) yerleştirir; kampanyada taslak kopyalanıp kampanyanın kullandığı şablona eklenir. `POST /studios/:studioId/ai/draft`.
- **Cevap öner**: gelen kutusunda cevap kutusunun yanında. Konuşmanın son 10 mesajı gönderilir, öneri cevap kutusuna yazılır; personel düzenleyip kendisi gönderir. `POST /studios/:studioId/inbox/conversations/:conversationId/suggest-reply` (`inbox.view` + `inbox.reply` + `ai.use`).
- `GET /studios/:studioId/ai/status`: yapılandırma, bu ayki harcama ve limit durumu.
- Hiçbir taslak otomatik gönderilmez. Konuşma ve açıklama metinleri modele talimat olarak değil veri olarak verilir.

## API uçları

Süper admin (`/admin/ai`, `SuperAdminOnly`):

| Uç | İş |
|---|---|
| `GET /admin/ai/settings` | Ayarlar (anahtar yalnızca son dört karakter) |
| `PATCH /admin/ai/settings` | Görev başına model, fiyat özelleştirmeleri, varsayılan aylık limit |
| `PUT /admin/ai/settings/key` | Anahtarı kaydet veya değiştir |
| `DELETE /admin/ai/settings/key` | Anahtarı sil |
| `POST /admin/ai/settings/test` | Bağlantı testi |
| `GET /admin/ai/usage?months=6` | Kullanım panosu |
| `PUT /admin/ai/tenants/:studioId/limit` | İşletmeye özel aylık limit (`null` kaldırır) |
| `GET /admin/ai/translation-jobs/:jobId` | Çeviri işi durumu |
| `POST /admin/ai/translation-jobs/:jobId/cancel` | Çeviri işini iptal et |
| `POST /admin/i18n/languages/:code/ai-translate` | Çeviri işi başlat |
| `GET /admin/i18n/languages/:code/ai-translate/jobs` | Dilin son işleri |
| `GET/POST /admin/i18n/languages/:code/glossary`, `DELETE .../glossary/:termId` | Sözlük |
| `POST /admin/i18n/languages/:code/review` | Yapay zeka çevirilerini onayla |

Hata gövdeleri `code` alanı taşır (`AI_NOT_CONFIGURED` 503, `AI_MONTHLY_LIMIT_REACHED` 429, `AI_AUTH_FAILED` 502, `AI_RATE_LIMITED` 503, `AI_PROVIDER_UNAVAILABLE` 503, `AI_TIMEOUT` 504, `AI_BAD_REQUEST` 502, `AI_REFUSED` 422, `AI_INVALID_OUTPUT` 502, `AI_ENCRYPTION_UNAVAILABLE` 503); web bunları `ai.error.<kod>` anahtarlarıyla kullanıcının dilinde gösterir.

## Sağlayıcı katmanı ayrıntıları

- `AnthropicAiAdapter`: anahtar başına bir SDK istemcisi (anahtarın özetiyle eşlenir), ortamdaki başka kimlik bilgileri devre dışı, SDK logları kapalı. İstek zaman aşımı görev başınadır (cevap önerisi 30 sn, metin 45 sn, çeviri grubu 120 sn); SDK 408/409/429/5xx ve bağlantı hatalarını üstel geri çekilmeyle 2 kez yeniden dener.
- SDK hataları tipli kodlara çevrilir (en özelden genele): kimlik doğrulama/izin, hız sınırı, zaman aşımı, bağlantı, geçersiz istek, sunucu hatası. `refusal` ve `max_tokens` durma nedenleri de ayrı kodlardır.
- Sabit sistem talimatları tarih veya kimlik içermez; önbellek kırılmasın diye değişen her şey kullanıcı mesajındadır.

## Test ve geliştirme

- Birim testleri gerçek API'yi çağırmaz: gruplama, yer tutucu koruma, çoğul üretimi, limit uygulama, maliyet hesabı, anahtar şifreleme gidiş-dönüşü (`packages/shared/src/ai/ai.spec.ts`, `apps/api/src/modules/ai/**/*.spec.ts`).
- API e2e (`apps/api/test/e2e/ai.e2e-spec.ts`) sahte adaptörü `overrideProvider` ile enjekte eder.
- Web e2e yığını API'yi `AI_FAKE_PROVIDER=1` ile başlatır (`apps/web/e2e/ai-translate.e2e.ts`). Bu değişken `NODE_ENV=production` iken hem env doğrulamasında hem modül fabrikasında reddedilir.
- Yerel geliştirmede Redis yoksa çeviri işini ilerletmek için süper admin olarak `POST /admin/scheduler/run` çağırın.

## Bilinen sınırlar

- Aylık limit kontrolü çağrıdan öncedir; eşzamanlı çağrılar limiti en fazla kendi maliyetleri kadar aşabilir.
- Kişiye özel geri kazanma mesajı ve segment tarifinden kural üretme (bölüm 3.10) bu çekirdeği kullanacak sonraki işlerdir.
- Mobil uygulamada henüz yapay zeka düğmesi yoktur; uçlar hazırdır.
