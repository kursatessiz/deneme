import { MarketingPlaceholder } from '@/components/marketing/MarketingPlaceholder';

/** Content calendar (M2c). */
export default function Page() {
  return (
    <MarketingPlaceholder
      titleKey="marketing.placeholder.calendar.title"
      descriptionKey="marketing.placeholder.calendar.description"
      required={['platform.marketing.manage']}
    />
  );
}
