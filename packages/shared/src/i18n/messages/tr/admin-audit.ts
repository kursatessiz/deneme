/** Süper admin denetim görünümü (/admin/denetim, M3d). */
export const trAdminAudit = {
  'adminAudit.nav': 'Denetim',
  'adminAudit.title': 'Denetim kaydı',
  'adminAudit.subtitle': 'Tüm işletmelerdeki yönetim eylemleri, en yeni en üstte. Ayrıntı sütunu kişi bilgisi içermeyecek biçimde kısaltılmıştır.',
  'adminAudit.accessDenied': 'Bu sayfaya erişim yetkiniz yok.',
  'adminAudit.empty': 'Filtrelere uyan kayıt yok.',
  'adminAudit.system': 'Sistem',
  'adminAudit.unknownUser': 'Silinmiş kullanıcı',

  'adminAudit.filter.user': 'Kullanıcı kimliği',
  'adminAudit.filter.userPlaceholder': '00000000-0000-0000-0000-000000000000',
  'adminAudit.filter.userInvalid': 'Kullanıcı kimliği geçerli bir UUID olmalı.',
  'adminAudit.filter.action': 'Eylem',
  'adminAudit.filter.actionPlaceholder': 'marketing.approval',
  'adminAudit.filter.from': 'Başlangıç',
  'adminAudit.filter.to': 'Bitiş',
  'adminAudit.filter.rangeInvalid': 'Başlangıç tarihi bitiş tarihinden sonra olamaz.',
  'adminAudit.filter.apply': 'Filtrele',
  'adminAudit.filter.clear': 'Temizle',

  'adminAudit.col.time': 'Zaman',
  'adminAudit.col.user': 'Kullanıcı',
  'adminAudit.col.action': 'Eylem',
  'adminAudit.col.target': 'Hedef',
  'adminAudit.col.details': 'Ayrıntı',

  'adminAudit.page.previous': 'Önceki',
  'adminAudit.page.next': 'Sonraki',
  'adminAudit.page.info': 'Sayfa {page} / {pages}, toplam {total} kayıt',
} as const satisfies Record<string, string>;
