// Progress — weekly improvement series.
//
// WAVE 0 PLACEHOLDER. Owned by the Progress workstream: replace the body with
// the real weekly table, delta badges and templated report. The route, nav
// entry and i18n keys are already wired so this file is the only thing to
// change.

import { useTranslation } from 'react-i18next';
import { LineChart } from 'lucide-react';

export default function Progress() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <LineChart className="h-6 w-6 text-amber-500" />
          {t('progress.title', { defaultValue: 'Progress' })}
        </h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          {t('progress.sub', { defaultValue: 'Week by week: accuracy, errors per game and the habit that cost you most.' })}
        </p>
      </header>
      <div className="rounded-xl border border-dashed border-ink-300 p-8 text-center text-sm text-ink-500 dark:border-chesscom-700 dark:text-ink-400">
        {t('progress.notImplemented', { defaultValue: 'Weekly progress arrives in the next update.' })}
      </div>
    </div>
  );
}
