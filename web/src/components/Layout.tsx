import { useEffect, useRef, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogOut, Home, Swords, BookOpen, Settings as SettingsIcon, Users, Server, Menu, X, BarChart3, Target, Search, Keyboard, BookMarked, ListChecks, Microscope, ChevronDown, GraduationCap, Stethoscope, LineChart } from 'lucide-react';
import { api } from '../api';
import UpdateNotice from './UpdateNotice';
import { useAuth } from '../state/auth';
import { cn } from '../lib/utils';
import ChangelogModal from './ChangelogModal';
import GitHubStar from './GitHubStar';
import { LogoMark, LogoLockup } from './Logo';
import LanguagePicker from './LanguagePicker';
import { primaryRating, RatingChip, useMyRatings } from './UserRatings';
import { endSession } from '../lib/logout';

// v4.0.0 Layout — chess.com-style horizontal top bar.
// Replaces the v3 narrow left rail. The dark sage navbar (`bg-chesscom-900`)
// gives the app the same chrome as chess.com itself; primary nav pills carry
// gold underlines on the active route (matches chess.com's premium accent).
// v6: command palette trigger + shortcuts trigger live in the right cluster.

interface LayoutProps {
  onOpenPalette?: () => void;
  onOpenShortcuts?: () => void;
}

interface NavEntry {
  to: string;
  icon: React.ElementType;
  label: string;
}

interface NavGroupDef {
  id: string;
  icon: React.ElementType;
  label: string;
  items: NavEntry[];
}

// `/review/123` is still "Review"; `/players/7` is still "Players". Kept in one
// place so the desktop group underline and the mobile drawer agree.
function isPathActive(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

// Twelve flat pills stopped fitting a laptop with labels showing, and the
// fallback (icons + tooltips) hid every destination behind a hover. Grouping
// related pages keeps the labels readable and the bar self-explanatory.
function NavGroup({ group, open, compact, onToggle }: {
  group: NavGroupDef;
  open: boolean;
  compact: boolean;
  onToggle: () => void;
}) {
  const { pathname } = useLocation();
  const active = group.items.some((item) => isPathActive(pathname, item.to));
  const Icon = group.icon;
  return (
    <div className="relative shrink-0" data-nav-menu>
      <button
        type="button"
        onClick={onToggle}
        title={group.label}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'relative flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium transition-colors 2xl:px-3',
          active ? 'text-white' : 'text-chesscom-300 hover:bg-chesscom-800 hover:text-white',
          open && 'bg-chesscom-800 text-white',
          active && 'after:absolute after:inset-x-3 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-gold-500',
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className={compact ? 'hidden' : 'inline'}>{group.label}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-1 min-w-52 rounded-lg border border-chesscom-700 bg-chesscom-900 p-1 shadow-lg"
        >
          {group.items.map(({ to, icon: ItemIcon, label }) => (
            <NavLink
              key={to}
              to={to}
              role="menuitem"
              className={({ isActive }) => cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                isActive
                  ? 'bg-chesscom-800 text-white'
                  : 'text-chesscom-200 hover:bg-chesscom-800 hover:text-white',
              )}
            >
              <ItemIcon className="h-4 w-4" />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout({ onOpenPalette, onOpenShortcuts }: LayoutProps) {
  const { t, i18n } = useTranslation();
  const { user, refresh } = useAuth();
  const { data: ratingsData } = useMyRatings();
  const rating = primaryRating(ratingsData?.ratings, ratingsData?.external);
  const nav = useNavigate();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  // One open menu at a time: a second group (or Admin) replaces the first
  // rather than stacking panels under the bar.
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [showChangelog, setShowChangelog] = useState(false);
  const [version, setVersion] = useState<string>('');
  // Mobile-first chrome: the top bar is 56px of permanently-pinned real estate
  // on a phone. Collapse it after a few idle seconds and whenever the page is
  // scrolled down; scrolling back up (the natural "where am I?" gesture)
  // brings it right back. Desktop keeps the bar pinned.
  const [headerHidden, setHeaderHidden] = useState(false);
  const navOpenRef = useRef(false);

  useEffect(() => {
    api.get<{ version: string }>('/api/meta')
      .then((d) => setVersion(d.version))
      .catch(() => setVersion(''));
  }, []);

  // Auto-close mobile drawer and the admin menu on route change. A new page
  // starts with the navigation available.
  useEffect(() => {
    setNavOpen(false);
    setAdminOpen(false);
    setOpenGroup(null);
    setHeaderHidden(false);
  }, [location.pathname]);

  // A nav dropdown is not a modal, but it must not stay open under a click
  // somewhere else on the page — the next click should do what it looks like.
  useEffect(() => {
    if (!openGroup) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.('[data-nav-menu]')) setOpenGroup(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenGroup(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openGroup]);

  useEffect(() => {
    navOpenRef.current = navOpen;
    if (navOpen) setHeaderHidden(false);
  }, [navOpen]);

  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 767px)');
    const IDLE_MS = 4000;
    const SCROLL_SLOP = 8;
    let idleTimer: number | undefined;
    let lastY = window.scrollY;
    let hidden = false;

    const setHidden = (next: boolean) => {
      if (next === hidden) return;
      hidden = next;
      setHeaderHidden(next);
    };

    const armIdle = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        if (mobile.matches && !navOpenRef.current) setHidden(true);
      }, IDLE_MS);
    };
    const disarmIdle = () => window.clearTimeout(idleTimer);

    const show = (arm: boolean) => {
      setHidden(false);
      if (arm) armIdle(); else disarmIdle();
    };

    const onScroll = () => {
      if (!mobile.matches) return;
      const y = window.scrollY;
      if (y <= 24) {
        show(true);
      } else if (y > lastY + SCROLL_SLOP) {
        // Reading downwards: get the bar out of the way.
        if (!navOpenRef.current) { setHidden(true); disarmIdle(); }
      } else if (y < lastY - SCROLL_SLOP) {
        // Scrolling back up means "I want the controls"; stay visible while
        // the thumb keeps moving and re-arm idle once it stops.
        show(true);
      }
      lastY = y;
    };

    const onMediaChange = () => {
      show(true);
    };

    // Any interaction buys another idle window; without this the bar would
    // collapse mid-typing, shifting the form under the user's finger.
    const onActivity = () => {
      if (mobile.matches && !hidden && !navOpenRef.current) armIdle();
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity);
    mobile.addEventListener('change', onMediaChange);
    if (mobile.matches) armIdle();
    else disarmIdle();

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
      mobile.removeEventListener('change', onMediaChange);
      disarmIdle();
    };
  }, []);

  async function logout() {
    if (await endSession()) return;
    await refresh();
    nav('/login');
  }

  // Nine destinations plus an Admin menu don't fit on a laptop with labels
  // showing. A breakpoint can't decide this: an admin carries two more items
  // than a regular profile, and Bulgarian labels are noticeably wider than
  // English ones, so any fixed width is wrong for somebody. Measure instead —
  // if the pills would overflow, drop to icons with tooltips, which keeps
  // every destination one click away rather than hiding some of them.
  const navRef = useRef<HTMLElement | null>(null);
  const fullNavWidth = useRef(0);
  const [compactNav, setCompactNav] = useState(false);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const check = () => {
      const available = nav.clientWidth;
      // dataset, not the closure: the observer can fire mid-update.
      const isCompact = nav.dataset.compact === '1';
      if (!isCompact) {
        // Labels are showing, so this is the width they actually need.
        fullNavWidth.current = nav.scrollWidth;
        if (nav.scrollWidth > available + 1) setCompactNav(true);
      } else if (fullNavWidth.current && available > fullNavWidth.current + 24) {
        // 24px of hysteresis so a window sitting exactly on the boundary
        // doesn't flip back and forth.
        setCompactNav(false);
      }
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [compactNav, user?.role, i18n.language]);
  const navLabelClass = compactNav ? 'hidden' : 'inline';

  // The bar's information architecture. Play is a group rather than a lone
  // pill because its sibling (Players) is the other half of the live loop;
  // Review owns the analysis tools, Progress the numbers about you, and Train
  // everything you practise away from the board.
  const navGroups: NavGroupDef[] = [
    {
      id: 'play',
      icon: Swords,
      label: t('nav.groups.play', { defaultValue: 'Play' }),
      items: [
        { to: '/play', icon: Swords, label: t('home.playTitle') },
        { to: '/players', icon: Users, label: t('players.nav', { defaultValue: 'Players' }) },
      ],
    },
    {
      id: 'review',
      icon: BookOpen,
      label: t('nav.groups.review', { defaultValue: 'Review' }),
      items: [
        { to: '/review', icon: BookOpen, label: t('home.reviewTitle') },
        { to: '/diagnosis', icon: Stethoscope, label: t('diagnosis.title', { defaultValue: 'Diagnosis' }) },
        { to: '/lab', icon: Microscope, label: t('lab.nav', { defaultValue: 'Lab' }) },
      ],
    },
    {
      id: 'progress',
      icon: LineChart,
      label: t('nav.groups.progress', { defaultValue: 'Progress' }),
      items: [
        { to: '/progress', icon: LineChart, label: t('progress.nav', { defaultValue: 'Progress' }) },
        { to: '/insights', icon: BarChart3, label: t('insights.title', { defaultValue: 'Insights' }) },
        { to: '/plan', icon: ListChecks, label: t('plan.nav', { defaultValue: 'Plan' }) },
      ],
    },
    {
      id: 'train',
      icon: Target,
      label: t('nav.groups.train', { defaultValue: 'Train' }),
      items: [
        { to: '/train', icon: Target, label: t('train.nav', { defaultValue: 'Train' }) },
        { to: '/openings', icon: BookMarked, label: t('openings.nav', { defaultValue: 'Openings' }) },
        { to: '/learn', icon: GraduationCap, label: t('learn.nav') },
      ],
    },
  ];

  function NavPill({ to, icon: Icon, label }: { to: string; icon: React.ElementType; label: string }) {
    return (
      <NavLink
        to={to}
        end
        title={label}
        className={({ isActive }) =>
          cn(
            'relative flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium transition-colors 2xl:px-3',
            isActive
              ? 'text-white'
              : 'text-chesscom-300 hover:bg-chesscom-800 hover:text-white',
            isActive && 'after:absolute after:inset-x-3 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-gold-500',
          )
        }
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className={navLabelClass}>{label}</span>
      </NavLink>
    );
  }

  function MobileNavItem({ to, icon: Icon, label }: { to: string; icon: React.ElementType; label: string }) {
    return (
      <NavLink
        to={to}
        end
        className={({ isActive }) =>
          cn(
            'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
            isActive
              ? 'bg-gold-500 text-chesscom-900'
              : 'text-chesscom-200 hover:bg-chesscom-800 hover:text-white',
          )
        }
      >
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </NavLink>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-panel dark:bg-chesscom-950">
      <UpdateNotice />
      {/* Top bar — dark sage, horizontal nav. On phones it collapses to zero
          height (instead of just sliding away) so no dead gap is left above
          the page content. */}
      <header
        className={cn(
          'sticky top-0 z-30 bg-chesscom-900 text-white transition-[height] duration-300 ease-out',
          // `overflow-hidden` only while collapsed: desktop's admin dropdown
          // hangs below the bar and must stay visible otherwise.
          headerHidden ? 'h-0 overflow-hidden shadow-none' : 'h-14 shadow-soft',
        )}
      >
        <div className={cn('mx-auto flex h-14 max-w-[1920px] items-center gap-2 px-3 transition-transform duration-300 ease-out sm:px-6', headerHidden && '-translate-y-full')}>
          <NavLink to="/" className="flex shrink-0 items-center gap-2">
            <LogoMark size={28} />
            <span className="hidden text-base font-bold tracking-tight sm:inline">{t('app.name')}</span>
          </NavLink>

          {/* Desktop nav */}
          <nav ref={navRef} data-compact={compactNav ? '1' : '0'} className="ml-4 hidden min-w-0 flex-1 items-center gap-0.5 md:flex">
            <NavPill to="/" icon={Home} label={t('app.home')} />
            {navGroups.map((group) => (
              <NavGroup
                key={group.id}
                group={group}
                compact={compactNav}
                open={openGroup === group.id}
                onToggle={() => {
                  setAdminOpen(false);
                  setOpenGroup((current) => (current === group.id ? null : group.id));
                }}
              />
            ))}
            {user?.role === 'admin' && (
              <>
                <span className="mx-2 h-5 w-px bg-chesscom-700" />
                <div className="relative shrink-0" data-nav-menu>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenGroup(null);
                      setAdminOpen((open) => !open);
                    }}
                    title={t('common.admin', { defaultValue: 'Admin' })}
                    aria-expanded={adminOpen}
                    aria-haspopup="menu"
                    className={cn(
                      'relative flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      adminOpen
                        ? 'bg-chesscom-800 text-white'
                        : 'text-chesscom-300 hover:bg-chesscom-800 hover:text-white',
                    )}
                  >
                    <Users className="h-4 w-4 shrink-0" />
                    <span className={navLabelClass}>{t('common.admin', { defaultValue: 'Admin' })}</span>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  {adminOpen && (
                    <div
                      role="menu"
                      className="absolute left-0 top-full mt-1 min-w-44 rounded-lg border border-chesscom-700 bg-chesscom-900 p-1 shadow-lg"
                    >
                      <NavLink
                        to="/admin/users"
                        role="menuitem"
                        onClick={() => setAdminOpen(false)}
                        className={({ isActive }) => cn(
                          'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                          isActive
                            ? 'bg-chesscom-800 text-white'
                            : 'text-chesscom-200 hover:bg-chesscom-800 hover:text-white',
                        )}
                      >
                        <Users className="h-4 w-4" />
                        <span>{t('admin.users')}</span>
                      </NavLink>
                      <NavLink
                        to="/admin/system"
                        role="menuitem"
                        onClick={() => setAdminOpen(false)}
                        className={({ isActive }) => cn(
                          'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                          isActive
                            ? 'bg-chesscom-800 text-white'
                            : 'text-chesscom-200 hover:bg-chesscom-800 hover:text-white',
                        )}
                      >
                        <Server className="h-4 w-4" />
                        <span>{t('admin.system')}</span>
                      </NavLink>
                    </div>
                  )}
                </div>
              </>
            )}
          </nav>

          <div className="flex flex-1 items-center justify-end gap-2 md:flex-none">
            {/* Command palette quick-trigger — visible cue for ⌘K. */}
            {onOpenPalette && (
              <button
                onClick={onOpenPalette}
                className="hidden shrink-0 items-center gap-2 rounded-md border border-chesscom-700 bg-chesscom-800/70 px-2.5 py-1.5 text-xs text-chesscom-300 hover:bg-chesscom-800 hover:text-white sm:inline-flex"
                title={t('palette.open')}
              >
                <Search className="h-3.5 w-3.5" />
                <span className="hidden min-[1800px]:inline">{t('palette.search', { defaultValue: 'Search' })}</span>
                <kbd className="hidden rounded border border-chesscom-700 px-1 font-mono text-[11px] text-chesscom-300 min-[1800px]:inline">⌘K</kbd>
              </button>
            )}
            {onOpenShortcuts && (
              <button
                onClick={onOpenShortcuts}
                className="hidden shrink-0 rounded-md p-2 text-chesscom-300 hover:bg-chesscom-800 hover:text-white min-[1800px]:inline-flex"
                title={t('shortcuts.title', { defaultValue: 'Keyboard shortcuts' })}
              >
                <Keyboard className="h-4 w-4" />
              </button>
            )}
            {/* Language picker — a compact dropdown so it fits on laptops too.
                Below `lg` the switch remains in the mobile drawer, Settings
                and the command palette (⌘K → "Switch to …"). */}
            {rating && user && (
              <RatingChip rating={rating} to={`/players/${user.id}`} className="hidden xl:inline-flex" />
            )}
            <div className="hidden shrink-0 lg:block">
              <LanguagePicker tone="dark" appearance="button" align="right" />
            </div>

            {/* User chip */}
            <NavLink
              to="/settings"
              className="hidden shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-chesscom-800 sm:flex"
              title={`${user?.profile.display_name ?? ''} @${user?.username ?? ''}`}
            >
              <span className="text-lg leading-none">{user?.profile.avatar_emoji ?? '♟'}</span>
              <div className="hidden max-w-[10rem] text-right text-xs leading-tight xl:block">
                <div className="truncate font-medium">{user?.profile.display_name}</div>
                <div className="truncate text-[11px] text-chesscom-400">@{user?.username}</div>
              </div>
            </NavLink>

            <NavLink
              to="/settings"
              className="hidden shrink-0 rounded-md p-2 text-chesscom-300 hover:bg-chesscom-800 hover:text-white xl:inline-flex"
              title={t('common.settings')}
            >
              <SettingsIcon className="h-4 w-4" />
            </NavLink>

            <button
              onClick={logout}
              className="hidden shrink-0 items-center gap-1.5 rounded-md border border-chesscom-700 bg-chesscom-800/50 px-2.5 py-1.5 text-sm text-chesscom-200 hover:border-bad/60 hover:bg-bad/15 hover:text-white sm:inline-flex"
              title={t('common.logout')}
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden xl:inline">{t('common.logout')}</span>
            </button>

            {/* Mobile menu button */}
            <button
              onClick={() => setNavOpen(true)}
              aria-label={t('nav.menu', { defaultValue: 'Menu' })}
              title={t('nav.menu', { defaultValue: 'Menu' })}
              className="rounded-lg p-2 text-chesscom-200 hover:bg-chesscom-800 md:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      {navOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setNavOpen(false)} />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-chesscom-900 p-4 text-white md:hidden">
            <div className="mb-3 flex items-center justify-between">
              <LogoLockup size={24} />
              <button onClick={() => setNavOpen(false)} className="rounded-lg p-1.5 text-chesscom-300 hover:bg-chesscom-800">
                <X className="h-5 w-5" />
              </button>
            </div>
            {user && (
              <NavLink
                to="/settings"
                className="mb-3 flex items-center gap-2 rounded-lg bg-chesscom-800/60 px-3 py-2 hover:bg-chesscom-800"
              >
                <span className="text-xl leading-none">{user.profile.avatar_emoji ?? '♟'}</span>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-sm font-medium">{user.profile.display_name}</div>
                  <div className="truncate text-xs text-chesscom-400">@{user.username}</div>
                </div>
              </NavLink>
            )}
            <nav className="space-y-1">
              <MobileNavItem to="/" icon={Home} label={t('app.home')} />
              {navGroups.map((group) => (
                <div key={group.id}>
                  <div className="px-3 pb-1 pt-3 text-[11px] uppercase tracking-wide text-chesscom-400">
                    {group.label}
                  </div>
                  <div className="space-y-1">
                    {group.items.map((item) => (
                      <MobileNavItem key={item.to} {...item} />
                    ))}
                  </div>
                </div>
              ))}
              <div className="pt-3">
                <MobileNavItem to="/settings" icon={SettingsIcon} label={t('common.settings')} />
              </div>
              {user?.role === 'admin' && (
                <>
                  <div className="px-3 pt-4 pb-1 text-[11px] uppercase tracking-wide text-chesscom-400">{t('common.admin')}</div>
                  <MobileNavItem to="/admin/users" icon={Users} label={t('admin.users')} />
                  <MobileNavItem to="/admin/system" icon={Server} label={t('admin.system')} />
                </>
              )}
            </nav>
            <div className="mt-auto space-y-2 pt-6">
              <LanguagePicker tone="dark" appearance="field" showNative align="left" placement="top" />
              <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-chesscom-200 hover:bg-chesscom-800">
                <LogOut className="h-4 w-4" />
                {t('common.logout')}
              </button>
            </div>
          </aside>
        </>
      )}

      {/* Main content */}
      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6">
          <Outlet />
        </div>
      </main>

      {/* Footer with version chip and the one place the repo is advertised. */}
      <footer className="border-t border-chesscom-200 bg-white px-3 py-2 text-xs text-chesscom-400 dark:border-chesscom-800 dark:bg-chesscom-900">
        <div className="flex items-center justify-center gap-2">
          {version && (
            <button
              onClick={() => setShowChangelog(true)}
              className="hover:text-chesscom-700 dark:hover:text-chesscom-200"
              title={t('common.viewChangelog')}
            >
              Patzer v{version}
            </button>
          )}
          {version && <span aria-hidden="true">·</span>}
          <GitHubStar />
        </div>
      </footer>

      {showChangelog && <ChangelogModal onClose={() => setShowChangelog(false)} />}
    </div>
  );
}
