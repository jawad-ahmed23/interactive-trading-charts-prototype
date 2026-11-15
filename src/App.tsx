import { useCallback, useEffect, useState } from 'react';
import { ChartView } from './ui/ChartView';
import { IndicatorDialog } from './ui/IndicatorDialog';
import { Toolbar } from './ui/Toolbar';
import { loadSettings, saveSettings, type Settings } from './state/settings';
import type { IndicatorInstance } from './indicators/types';

export function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [dialog, setDialog] = useState<{ open: boolean; focusId: string | null }>({ open: false, focusId: null });

  useEffect(() => saveSettings(settings), [settings]);

  const patch = useCallback((p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p })), []);
  const updateIndicators = useCallback(
    (update: (prev: IndicatorInstance[]) => IndicatorInstance[]) => setSettings((s) => ({ ...s, indicators: update(s.indicators) })),
    [],
  );
  const closeDialog = useCallback(() => setDialog({ open: false, focusId: null }), []);

  return (
    <div className="app">
      <Toolbar
        symbol={settings.symbol}
        timeframe={settings.timeframe}
        scaleMode={settings.scaleMode}
        onSymbol={(symbol) => patch({ symbol })}
        onTimeframe={(timeframe) => patch({ timeframe })}
        onScaleMode={(scaleMode) => patch({ scaleMode })}
        onIndicators={() => setDialog({ open: true, focusId: null })}
      />
      <ChartView
        symbol={settings.symbol}
        timeframe={settings.timeframe}
        scaleMode={settings.scaleMode}
        indicators={settings.indicators}
        onRemoveIndicator={(id) => updateIndicators((prev) => prev.filter((i) => i.instanceId !== id))}
        onEditIndicator={(id) => setDialog({ open: true, focusId: id })}
      />
      {dialog.open && (
        <IndicatorDialog indicators={settings.indicators} focusId={dialog.focusId} onChange={updateIndicators} onClose={closeDialog} />
      )}
    </div>
  );
}
