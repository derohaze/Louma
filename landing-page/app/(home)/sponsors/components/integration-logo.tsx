import Image from 'next/image';
import type { Integration } from '../data';

export function IntegrationLogo({ integration }: { integration: Integration }) {
  if (!integration.logo) return null;

  return (
    <Image
      src={integration.logo}
      alt={`${integration.name} logo`}
      width={112}
      height={64}
      className="h-12 w-auto max-w-28 object-contain"
    />
  );
}
