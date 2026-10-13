# Güvenlik Politikası

## Bir güvenlik açığı bildirme

Güvenlik sorunları için herkese açık bir issue açmayın. Bunun yerine
GitHub'ın özel güvenlik açığı bildirimini (private vulnerability reporting)
kullanın: repository'nin Security sekmesi altındaki "Report a vulnerability"
butonu. 5 iş günü içinde bir yanıt alacaksınız.

Lütfen etkilenen bileşeni (api, web, mobile, deploy), yeniden üretme
adımlarını ve beklediğiniz etkiyi (örneğin kiracılar arası veri erişimi)
belirtin.

## Desteklenen sürümler

Yalnızca `main` üzerindeki en son sürüm düzeltme alır.

## Mevcut önlemler

- Dependabot ile 7 günlük bekleme süresiyle bağımlılık güncellemeleri; major sürümler ayrı PR'lar olarak
- Her PR'da `pnpm audit` (high ve üzeri), bağımlılık incelemesi ve lisans kontrolleri
  - Yaması olmayan, yalnızca geliştirme araçlarını etkileyen uyarılar `pnpm.auditConfig.ignoreGhsas` ile gerekçeli olarak geçici geçilir (liste ve gerekçeler: `docs/CICD_GUIDE.md`)
- TypeScript ve GitHub Actions için CodeQL (security-extended)
- Gizli bilgi taraması (TruffleHog) ve workflow denetimi (zizmor, actionlint)
- OpenSSF Scorecard
- Build kaynak doğrulaması (provenance attestation) ve SBOM'lara sahip, salt okunur
  bir dosya sisteminde root olmayan bir kullanıcı olarak çalışan container imajları
- Şifre ve PIN ile girişte kaba kuvvet koruması: yalnızca başarısız denemeler sayılır;
  hesap tanımlayıcısı (normalize telefon veya e-posta) başına 15 dakikada 10, IP başına
  50 başarısız denemeden sonra 429 döner. Başarılı giriş sayacı sıfırlar; SMS kodu ile
  giriş kurtarma yolu olarak açık kalır. PIN için ayrıca hesap kilidi vardır.
- Uygulama loglarında telefon numaraları maskelenir; SMS içeriği ve kodlar loglanmaz
  (yalnızca yerel geliştirmede sahte SMS metni görünür).
- Yenileme jetonu (refresh token) her verilişte rastgele bir `jti` taşır; veritabanında
  jetonun tamamının SHA-256 özeti tutulur ve sabit zamanlı karşılaştırılır (bcrypt
  yalnızca ilk 72 baytı okuduğu için kullanılmaz). Her yenilemede eski jeton geçersiz
  olur. PIN değiştirildiğinde (veya davet kabulünde yeni PIN belirlendiğinde) kayıtlı
  yenileme jetonu silinir; `PUT /auth/pin` çağırana yeni bir jeton çifti döner.
- İstemciler (mobil uygulama, web BFF ve web middleware) oturumu yalnızca
  `/auth/refresh` 401/403 döndüğünde kapatır; 429, 5xx veya ağ hatasında jetonlar
  korunur ve hata gösterilir.
- Hız sınırı sayaçları (giriş denemeleri, herkese açık API, embed, etkinlikler, check-in
  ve diğerleri) Redis'te tek bir Lua betiğiyle artırılır ve süreleri aynı adımda atanır
  (`incrementWithTtl`); süresiz kalmış bir sayaç bir sonraki istekte yeniden süre alır,
  böylece kalıcı kilitlenme oluşmaz.
- `INTEGRATION_ENCRYPTION_KEY` tanımlı değilse üretimde hiçbir kimlik bilgisi
  kaydedilmez (`CredentialCipher.encrypt()` hata verir); düz metin zarfı (`plain:`)
  yalnızca geliştirme/test içindir.
- Web uygulamasında `next/image` kullanılmaz; `/_next/image` optimizasyon ucu
  kapalıdır (`images.unoptimized: true`), açık bir görsel proxy'si olarak kullanılamaz.
