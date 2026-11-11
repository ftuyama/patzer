import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown } from 'lucide-react';
import { LANGUAGES, normalizeLanguage, type Language } from '../lib/languages';
import { cn } from '../lib/utils';
import Flag from './Flag';

type Appearance = 'button' | 'ghost' | 'field';
type Tone = 'light' | 'dark';
type Align = 'left' | 'right' | 'center';
type Placement = 'bottom' | 'top';

interface LanguagePickerProps {
  /** Selected language. Defaults to the live i18n language (uncontrolled).
   *  Pass `''` together with `allowNone` to show the "no preference" state. */
  value?: Language | '';
  /** Called with the chosen language (`''` for the none option). */
  onChange?: (lang: Language | '') => void;
  /** Apply the choice to i18n immediately (default true). Set false for
   *  forms that save the language later (Settings, admin dialogs). */
  apply?: boolean;
  appearance?: Appearance;
  /** `dark` is for the always-dark top bar; `light` follows the page theme. */
  tone?: Tone;
  align?: Align;
  /** Open upwards when the trigger sits near the bottom of the screen. */
  placement?: Placement;
  /** Show the native name instead of the two-letter code on the trigger. */
  showNative?: boolean;
  /** Add a leading "no preference" row (invites may not set a language). */
  allowNone?: boolean;
  noneLabel?: string;
  className?: string;
  /** Forwarded to the trigger button so a <label htmlFor> can point at it. */
  id?: string;
  disabled?: boolean;
}

const TRIGGER: Record<Tone, Record<Appearance, string>> = {
  light: {
    button: 'border-chesscom-200 bg-white text-chesscom-700 hover:bg-chesscom-50 dark:border-chesscom-700 dark:bg-chesscom-900 dark:text-chesscom-200 dark:hover:bg-chesscom-800',
    ghost: 'text-chesscom-500 hover:bg-chesscom-100 hover:text-chesscom-800 dark:text-chesscom-300 dark:hover:bg-chesscom-800 dark:hover:text-white',
    field: 'border-chesscom-200 bg-white text-chesscom-900 hover:border-chesscom-300 dark:border-chesscom-700 dark:bg-chesscom-900 dark:text-chesscom-100 dark:hover:border-chesscom-600',
  },
  dark: {
    button: 'border-chesscom-700 bg-chesscom-800/70 text-chesscom-300 hover:bg-chesscom-800 hover:text-white',
    ghost: 'text-chesscom-300 hover:bg-chesscom-800 hover:text-white',
    field: 'border-chesscom-700 bg-chesscom-900 text-chesscom-100 hover:border-chesscom-600',
  },
};

const MENU: Record<Tone, string> = {
  light: 'border-chesscom-200 bg-white text-chesscom-900 dark:border-chesscom-700 dark:bg-chesscom-800 dark:text-chesscom-100',
  dark: 'border-chesscom-700 bg-chesscom-800 text-chesscom-100',
};

const ITEM_ACTIVE: Record<Tone, string> = {
  light: 'bg-chesscom-100 dark:bg-chesscom-700',
  dark: 'bg-chesscom-700',
};

const ALIGN: Record<Align, string> = {
  left: 'left-0',
  right: 'right-0',
  center: 'left-1/2 -translate-x-1/2',
};

const PLACEMENT: Record<Placement, string> = {
  bottom: 'top-full mt-1',
  top: 'bottom-full mb-1',
};

const SIZE: Record<Appearance, string> = {
  button: 'gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium',
  ghost: 'gap-1.5 rounded-md px-2 py-1 text-xs font-medium',
  field: 'w-full justify-between gap-2 rounded-md border px-3 py-2 text-sm',
};

export default function LanguagePicker({
  value,
  onChange,
  apply = true,
  appearance = 'button',
  tone = 'light',
  align = 'left',
  placement = 'bottom',
  showNative = false,
  allowNone = false,
  noneLabel = '—',
  className,
  id,
  disabled,
}: LanguagePickerProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = useId();

  const options = allowNone
    ? [{ code: '' as const, native: noneLabel, short: '' }, ...LANGUAGES]
    : LANGUAGES;
  const selected: Language | '' = value ?? normalizeLanguage(i18n.language);
  const selectedIndex = options.findIndex((l) => l.code === selected);
  const current = options[Math.max(0, selectedIndex)]!;
  const label = t('common.language', { defaultValue: 'Language' });

  // Open on the current language, then move real focus into the menu so arrow
  // keys and screen readers work without a separate roving-tabindex layer.
  useEffect(() => {
    if (open) setActive(Math.max(0, selectedIndex));
  }, [open, selectedIndex]);
  useEffect(() => {
    if (open) itemRefs.current[active]?.focus();
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function commit(lang: Language | '') {
    setOpen(false);
    if (apply && lang) void i18n.changeLanguage(lang);
    onChange?.(lang);
    triggerRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    const last = options.length - 1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i >= last ? 0 : i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? last : i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(last);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      commit(options[active]!.code);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={cn('relative inline-block', appearance === 'field' && 'block', className)} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        title={label}
        className={cn(
          'inline-flex items-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 disabled:pointer-events-none disabled:opacity-50',
          SIZE[appearance],
          TRIGGER[tone][appearance],
        )}
      >
        {selected ? <Flag code={selected} /> : <span className="inline-block h-4 w-6 shrink-0 rounded-[2px] border border-dashed border-current opacity-40" />}
        <span className={cn('truncate', !showNative && 'font-mono uppercase tracking-wide')}>
          {showNative ? current.native : current.short || noneLabel}
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 opacity-60 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className={cn(
            'absolute z-50 max-h-80 w-56 overflow-auto rounded-lg border p-1 shadow-lift',
            PLACEMENT[placement],
            ALIGN[align],
            MENU[tone],
          )}
        >
          {options.map((l, i) => {
            const isSelected = l.code === selected;
            return (
              <li key={l.code || 'none'}>
                <button
                  ref={(el) => { itemRefs.current[i] = el; }}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={-1}
                  onClick={() => commit(l.code)}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                    i === active && ITEM_ACTIVE[tone],
                    isSelected && (tone === 'dark' ? 'font-semibold' : 'font-semibold text-chesscom-900 dark:text-gold-300'),
                  )}
                >
                  {l.code
                    ? <Flag code={l.code} />
                    : <span className="inline-block h-4 w-6 shrink-0 rounded-[2px] border border-dashed border-current opacity-40" />}
                  <span className="min-w-0 flex-1 truncate">{l.native}</span>
                  <span className="font-mono text-[10px] uppercase tracking-wider opacity-50">{l.short}</span>
                  {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-gold-600 dark:text-gold-300" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
