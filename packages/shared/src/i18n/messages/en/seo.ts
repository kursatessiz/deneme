import type { trSeo } from '../tr/seo';

export const enSeo: Record<keyof typeof trSeo, string> = {
  'seo.root.title': '{product} | Smart Booking and Membership Management',
  'seo.root.description': 'A platform for bookings, membership credits, staff and customer management',
  'seo.login.title': 'Sign in | {product}',
  'seo.token.title': 'Secure link | {product}',
  'seo.panel.title': 'Management panel | {product}',
  'seo.booking.title': '{studio} | {booking}',
  'seo.booking.description': 'Online booking for {studio}: choose a service and a time that suits you.',
};
