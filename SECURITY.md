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
- TypeScript ve GitHub Actions için CodeQL (security-extended)
- Gizli bilgi taraması (TruffleHog) ve workflow denetimi (zizmor, actionlint)
- OpenSSF Scorecard
- Build kaynak doğrulaması (provenance attestation) ve SBOM'lara sahip, salt okunur
  bir dosya sisteminde root olmayan bir kullanıcı olarak çalışan container imajları
