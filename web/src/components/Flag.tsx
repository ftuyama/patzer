import type { Language } from '../lib/languages';

// Crisp inline SVG flags. Emoji flags render as bare letters on Windows, so
// every language control uses these instead. They are intentionally simplified
// (no coats of arms) — at 24×16 px the silhouette and colours are what read.
const FLAGS: Record<Language, React.ReactNode> = {
  en: (
    <>
      <rect width="24" height="16" fill="#012169" />
      <path d="M0 0l24 16M24 0L0 16" stroke="#fff" strokeWidth="3.2" />
      <path d="M0 0l24 16M24 0L0 16" stroke="#C8102E" strokeWidth="1.5" />
      <path d="M12 0v16M0 8h24" stroke="#fff" strokeWidth="5.2" />
      <path d="M12 0v16M0 8h24" stroke="#C8102E" strokeWidth="3.1" />
    </>
  ),
  bg: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <rect y="5.33" width="24" height="5.34" fill="#00966E" />
      <rect y="10.67" width="24" height="5.33" fill="#D62612" />
    </>
  ),
  es: (
    <>
      <rect width="24" height="16" fill="#AA151B" />
      <rect y="4" width="24" height="8" fill="#F1BF00" />
    </>
  ),
  de: (
    <>
      <rect width="24" height="16" fill="#000" />
      <rect y="5.33" width="24" height="5.34" fill="#DD0000" />
      <rect y="10.67" width="24" height="5.33" fill="#FFCE00" />
    </>
  ),
  ru: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <rect y="5.33" width="24" height="5.34" fill="#0039A6" />
      <rect y="10.67" width="24" height="5.33" fill="#D52B1E" />
    </>
  ),
  pt: (
    <>
      <rect width="24" height="16" fill="#009C3B" />
      <path d="M12 2.2 21.8 8 12 13.8 2.2 8Z" fill="#FFDF00" />
      <circle cx="12" cy="8" r="2.9" fill="#002776" />
      <path d="M9.15 8.55c1.75-.95 3.95-.85 5.7.3" fill="none" stroke="#fff" strokeWidth="0.7" />
    </>
  ),
};

/** A small fixed-size flag. `className` sets the outer size (h-4 w-6 by default). */
export default function Flag({ code, className = 'h-4 w-6' }: { code: Language; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 overflow-hidden rounded-[2px] align-middle ring-1 ring-black/10 dark:ring-white/15 ${className}`}
    >
      <svg viewBox="0 0 24 16" className="block h-full w-full" preserveAspectRatio="none">
        {FLAGS[code]}
      </svg>
    </span>
  );
}
