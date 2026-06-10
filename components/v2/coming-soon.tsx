import { OneViewHeader } from './oneview-header';

// Placeholder for nav destinations being delivered in later build weeks.
export function ComingSoon({
  title, subtitle, week, blurb, Icon,
}: {
  title: string;
  subtitle?: string;
  week: string;
  blurb: string;
  Icon: React.ComponentType<{ size?: number }>;
}) {
  return (
    <>
      <OneViewHeader title={title} subtitle={subtitle} />
      <div className="flex-1 flex items-center justify-center p-7">
        <div className="ov-card max-w-md p-9 text-center">
          <div
            className="mx-auto flex items-center justify-center w-14 h-14 rounded-2xl"
            style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
          >
            <Icon size={26} />
          </div>
          <span
            className="mt-5 inline-block rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.16em]"
            style={{ background: 'var(--card)', color: 'var(--text-secondary)' }}
          >
            Arriving · {week}
          </span>
          <h2 className="mt-4 text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{blurb}</p>
        </div>
      </div>
    </>
  );
}
