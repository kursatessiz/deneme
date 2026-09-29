import { MarketingPlaceholder } from '@/components/marketing/MarketingPlaceholder';

/** AI studio (M2b). */
export default function Page() {
  return (
    <MarketingPlaceholder
      titleKey="marketing.placeholder.aiStudio.title"
      descriptionKey="marketing.placeholder.aiStudio.description"
      required={['platform.ai.use']}
    />
  );
}
