import type { trMMessaging } from '../tr/mMessaging';

export const enMMessaging = {
  'mMessaging.chat.title': 'Message the studio',
  'mMessaging.chat.empty': 'Write to the studio and the team will answer you here.',
  'mMessaging.chat.placeholder': 'Your message',
  'mMessaging.chat.send': 'Send',
  'mMessaging.chat.sendError': 'The message could not be sent.',
  'mMessaging.chat.you': 'You',
  'mMessaging.chat.studio': 'Studio',
  'mMessaging.chat.announcements': 'Announcements',
  'mMessaging.inbox.title': 'Inbox',
  'mMessaging.inbox.empty': 'No open conversations.',
  'mMessaging.inbox.back': 'Conversations',
  'mMessaging.inbox.reply': 'Write a reply',
  'mMessaging.inbox.send': 'Send',
  'mMessaging.inbox.close': 'Close conversation',
  'mMessaging.inbox.assignToMe': 'Assign to me',
  'mMessaging.inbox.windowClosed': 'The 24-hour WhatsApp window has closed; a reply can be sent from the web panel with an approved template.',
  'mMessaging.loadError': 'Could not load.',
} as const satisfies Record<keyof typeof trMMessaging, string>;
