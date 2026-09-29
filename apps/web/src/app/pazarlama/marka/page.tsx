import { MarketingPlaceholder } from '@/components/marketing/MarketingPlaceholder';

/** Brand kit and product facts (M2a). */
export default function Page() {
  return (
    <MarketingPlaceholder
      titleKey="marketing.placeholder.brand.title"
      descriptionKey="marketing.placeholder.brand.description"
      required={['platform.brand.manage']}
    />
  );
}
