/**
 * Page engine (G2c) chrome text: the small amount of UI text that is not
 * part of a page's own editable blocks (legal draft banner, lead form field
 * labels, booking widget default button). Rendered in the *page's own*
 * locale (from the URL), not the viewer's app-locale preference -- see
 * apps/web/src/lib/i18n/getT.ts getTFor() and
 * apps/web/src/components/sites/BlockRenderer.tsx.
 */
export const trSites = {
  'sites.legalDraftBanner': 'Taslak: bu metin hukuki incelemeden geçmelidir.',
  'sites.leadForm.fullName': 'Ad soyad',
  'sites.leadForm.phone': 'Telefon',
  'sites.leadForm.email': 'E-posta',
  'sites.leadForm.message': 'Mesajınız',
  'sites.leadForm.defaultConsent': 'İletişim bilgilerimin bu işletme tarafından aranmak için kullanılmasına izin veriyorum.',
  'sites.leadForm.submit': 'Gönder',
  'sites.leadForm.sent': 'Teşekkürler, en kısa sürede sizinle iletişime geçeceğiz.',
  'sites.leadForm.error': 'Gönderilemedi, lütfen tekrar deneyin.',
  'sites.bookingWidget.defaultButton': 'Randevu al',
  'sites.footer.cookiePreferences': 'Çerez tercihleri',
} as const satisfies Record<string, string>;
