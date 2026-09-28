/** Cookie / tracking consent banner on public pages (apps/web/src/components/consent). */
export const trConsent = {
  'consent.title': 'Çerez tercihleri',
  'consent.optIn.body':
    'Sitemizi geliştirmek ve reklamlarımızın etkisini ölçmek için isteğe bağlı çerezler kullanmak istiyoruz. Onay vermediğiniz sürece bu çerezler yazılmaz.',
  'consent.kvkk.body':
    'Kişisel verileriniz 6698 sayılı KVKK kapsamında, ziyaretinizi ölçmek ve reklamlarımızı iyileştirmek amacıyla, yalnızca onay vermeniz hâlinde çerezlerle işlenir. Onayınızı istediğiniz zaman geri alabilirsiniz.',
  'consent.notice.body':
    'Sitemizi geliştirmek ve reklamlarımızın etkisini ölçmek için çerezler kullanıyoruz. Reklam çerezlerini aşağıdan kapatabilirsiniz.',
  'consent.gpcHonoured': 'Tarayıcınızın Global Privacy Control sinyali nedeniyle reklam çerezleri kapalı.',
  'consent.category.necessary': 'Zorunlu',
  'consent.category.necessaryHint': 'Tercihinizi hatırlamak için gerekli, her zaman açık.',
  'consent.category.analytics': 'Analiz',
  'consent.category.analyticsHint': 'Ziyaretleri ve hangi kaynaktan geldiğinizi ölçer.',
  'consent.category.advertising': 'Reklam',
  'consent.category.advertisingHint': 'Reklam tıklamalarını ölçer ve reklam platformlarıyla paylaşır.',
  'consent.acceptAll': 'Tümünü kabul et',
  'consent.rejectAll': 'Tümünü reddet',
  'consent.customize': 'Tercihleri seç',
  'consent.save': 'Seçimimi kaydet',
  'consent.ok': 'Tamam',
  'consent.optOutAdvertising': 'Reklam çerezlerini kapat',
} as const satisfies Record<string, string>;
