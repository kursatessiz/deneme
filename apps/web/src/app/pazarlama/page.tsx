import { MarketingPlaceholder } from '@/components/marketing/MarketingPlaceholder';

/** Marketing dashboard (M3 fills it; doc 3.3). */
export default function Page() {
  return (
    <MarketingPlaceholder
      titleKey="marketing.placeholder.dashboard.title"
      descriptionKey="marketing.placeholder.dashboard.description"
      required={['platform.marketing.view']}
    />
  );
}
