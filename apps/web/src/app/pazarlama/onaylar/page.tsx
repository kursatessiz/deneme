import { MarketingPlaceholder } from '@/components/marketing/MarketingPlaceholder';

/** Approval queue (M3b). */
export default function Page() {
  return (
    <MarketingPlaceholder
      titleKey="marketing.placeholder.approvals.title"
      descriptionKey="marketing.placeholder.approvals.description"
      required={['platform.marketing.send', 'platform.marketing.approve']}
    />
  );
}
