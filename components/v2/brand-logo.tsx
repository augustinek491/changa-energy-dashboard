import Image from 'next/image';

const RATIO = 42.611 / 156.158; // native logo aspect ratio

/**
 * Changa wordmark. Uses the real logo.svg on light surfaces and a
 * white-wordmark variant on dark — swapped via the `.dark` CSS variant
 * so there is no hydration flash.
 */
export function BrandLogo({ width = 134, className = '' }: { width?: number; className?: string }) {
  const height = Math.round(width * RATIO);
  return (
    <span className={`inline-flex items-center ${className}`} style={{ height }}>
      <Image
        src="/changa-logo.svg"
        alt="Changa Energy"
        width={width}
        height={height}
        priority
        className="block dark:hidden"
      />
      <Image
        src="/changa-logo-white.svg"
        alt="Changa Energy"
        width={width}
        height={height}
        priority
        className="hidden dark:block"
      />
    </span>
  );
}
