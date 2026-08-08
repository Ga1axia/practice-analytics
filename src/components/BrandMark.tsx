type Props = {
  /** dark = on charcoal header; light = on pale surfaces */
  tone?: 'dark' | 'light';
  subtitle?: string;
  compact?: boolean;
};

export function BrandMark({
  tone = 'dark',
  subtitle = 'Practice Analytics',
  compact = false,
}: Props) {
  return (
    <div className={`brand-mark tone-${tone}${compact ? ' compact' : ''}`}>
      <img
        src="/brand/mdesigns-logo.png"
        alt="M·Designs Architects"
        className="brand-mark-logo"
      />
      {subtitle ? <span className="brand-mark-sub">{subtitle}</span> : null}
    </div>
  );
}
