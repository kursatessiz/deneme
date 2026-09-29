import type { trAdminWebSitesi } from '../tr/admin-web-sitesi';

export const enAdminWebSitesi = {
  'adminWebSitesi.title': 'Website',
  'adminWebSitesi.subtitle': "The platform's corporate and marketing site: home page, sector landing pages, legal texts",
  'adminWebSitesi.notFound': 'Platform site not found',
  'adminWebSitesi.companyInfo.title': 'Company details',
  'adminWebSitesi.companyInfo.description': 'The platform identity used in legal texts and contact blocks',
  'adminWebSitesi.companyInfo.legalName': 'Legal name',
  'adminWebSitesi.companyInfo.taxOffice': 'Tax office',
  'adminWebSitesi.companyInfo.taxNumber': 'Tax number',
  'adminWebSitesi.companyInfo.tradeRegistryNo': 'Trade registry no',
  'adminWebSitesi.companyInfo.mersisNo': 'MERSIS no',
  'adminWebSitesi.companyInfo.email': 'Email',
  'adminWebSitesi.companyInfo.phone': 'Phone',
  'adminWebSitesi.companyInfo.address': 'Address',
  'adminWebSitesi.companyInfo.loadFailed': 'Could not load',
  'adminWebSitesi.companyInfo.saved': 'Company details saved',
  'adminWebSitesi.companyInfo.saveFailed': 'Could not save',
  'adminWebSitesi.companyInfo.submit': 'Save',
} as const satisfies Record<keyof typeof trAdminWebSitesi, string>;
