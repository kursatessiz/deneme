import type { trMarketingInsights } from '../tr/marketingInsights';

export const enMarketingInsights = {
  'marketingInsights.title': 'Weekly summary',
  'marketingInsights.subtitle': 'Prepared once a week from the aggregate figures of the last complete week.',
  'marketingInsights.loading': 'Loading',
  'marketingInsights.loadFailed': 'The weekly summary could not be loaded.',
  'marketingInsights.empty': 'No weekly summary yet. Once a super admin turns the weekly summary on in the marketing settings, one is created every Monday.',
  'marketingInsights.period': '{from} - {to}',
  'marketingInsights.earlier': 'Earlier weeks',
  'marketingInsights.noData': 'There is not enough data to summarise this week.',
  'marketingInsights.hidden': 'Hidden: fewer than {min} people',

  'marketingInsights.actions.title': 'Suggested actions',
  'marketingInsights.actions.basis': 'Based on: {metric}',

  'marketingInsights.metrics.title': 'Figures',
  'marketingInsights.metrics.metric': 'Figure',
  'marketingInsights.metrics.thisWeek': 'This week',
  'marketingInsights.metrics.previousWeek': 'Previous week',
  'marketingInsights.metrics.change': 'Change',

  'marketingInsights.metric.leads': 'Leads',
  'marketingInsights.metric.studioPaid': 'Paying businesses',
  'marketingInsights.metric.trials': 'Trials started',
  'marketingInsights.metric.converted': 'Converted to paid',
  'marketingInsights.metric.trialRate': 'Trial to paid rate',
  'marketingInsights.metric.spend': 'Ad spend',
  'marketingInsights.metric.revenue': 'Revenue',
  'marketingInsights.metric.cac': 'Acquisition cost',
  'marketingInsights.metric.cpl': 'Cost per lead',
  'marketingInsights.metric.roas': 'Return on ad spend (ROAS)',
} as const satisfies Record<keyof typeof trMarketingInsights, string>;
