/** Automation block of the integrations hub (M4c): platform events for Zapier, Make and n8n, and the API key scopes. */
export const trAutomationHub = {
  'automationHub.title': 'Otomasyon (Zapier, Make, n8n)',
  'automationHub.description': 'Platform olayları yalnızca platform kiracısının webhook abonelikleri için yayınlanır. Zapier ve Make, abonelik için POST /v1/public/hooks ucunu kullanır; gelen kişi işlemleri crm.write yetkili API anahtarı ister.',
  'automationHub.events': 'Platform olayları',
  'automationHub.subscriptions': 'Etkin abonelik',
  'automationHub.crmWriteKeys': 'crm.write yetkili etkin anahtar: {count}',
  'automationHub.event.studio_signup': 'Yeni işletme kaydı',
  'automationHub.event.studio_paid': 'İşletme ilk ödemesini yaptı',
  'automationHub.event.studio_trial_expiring': 'Deneme süresi bitmek üzere',
  'automationHub.event.contact_lifecycle_changed': 'Kişi yaşam döngüsü değişti',
  'automationHub.event.campaign_sent': 'Kampanya gönderimi tamamlandı',
  'automationHub.scope.webhooks_manage': 'Webhook abonelikleri (webhooks.manage)',
  'automationHub.scope.crm_write': 'Kişi oluşturma, etiket ve izin (crm.write)',
  'automationHub.scopes': 'Yetkiler',
} as const satisfies Record<string, string>;
