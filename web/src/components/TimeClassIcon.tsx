import { useTranslation } from 'react-i18next';
import {
  CalendarDays, Hourglass, Infinity as InfinityIcon, Rocket, Timer, Zap, type LucideIcon,
} from 'lucide-react';
import type { TimeClass } from '../types';
import { cn } from '../lib/utils';

/** Rated classes plus the two speeds Play offers without a rating: `classical`
 *  and `untimed` (a friendly bot game on no clock). */
export type SpeedClass = TimeClass | 'classical' | 'untimed';

// chess.com's speed column: a rocket for bullet, a bolt for blitz, a stopwatch
// for rapid, a calendar for correspondence. Icons, not bitmaps, so they follow
// the theme and cost no extra request.
const STYLES: Record<SpeedClass, { icon: LucideIcon; tone: string }> = {
  bullet: { icon: Rocket, tone: 'text-gold-500' },
  blitz: { icon: Zap, tone: 'text-gold-500' },
  rapid: { icon: Timer, tone: 'text-green-500' },
  daily: { icon: CalendarDays, tone: 'text-sky-500' },
  classical: { icon: Hourglass, tone: 'text-sky-500' },
  untimed: { icon: InfinityIcon, tone: 'text-chesscom-400' },
};

export default function TimeClassIcon({ timeClass, label, orientation = 'column', className, iconClassName }: {
  /** Loose on purpose: imported games carry whatever chess.com calls the
   *  speed, and an unknown value should render nothing instead of crashing. */
  timeClass: string | null | undefined;
  /** Time control text shown under (or beside) the icon, e.g. "3+2". */
  label?: string;
  orientation?: 'column' | 'inline';
  className?: string;
  /** Override the glyph size where the surrounding text is smaller. */
  iconClassName?: string;
}) {
  const { t } = useTranslation();
  const style = timeClass ? STYLES[timeClass as SpeedClass] : undefined;
  if (!style) return null;
  const { icon: Icon, tone } = style;
  const name = t(`review.tc.${timeClass}`, { defaultValue: timeClass });
  const inline = orientation === 'inline';

  return (
    <div
      title={label ? `${name} · ${label}` : name}
      className={cn(
        'shrink-0',
        inline ? 'inline-flex items-center gap-1' : 'flex w-10 flex-col items-center gap-0.5',
        className,
      )}
    >
      <Icon className={cn(inline ? 'h-3.5 w-3.5' : 'h-5 w-5', tone, iconClassName)} aria-hidden />
      {label && (
        <span className={cn('tabular-nums text-chesscom-400', inline ? 'text-xs' : 'text-[10px] font-medium')}>
          {label}
        </span>
      )}
    </div>
  );
}
