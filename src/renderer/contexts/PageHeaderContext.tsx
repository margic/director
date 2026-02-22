/**
 * PageHeaderContext — Allows each page/extension to declare its header content.
 *
 * Each page calls useSetPageHeader() on mount to push its title, icon, and
 * optional subtitle into the global app bar rendered by App.tsx.
 *
 * See: documents/feature_merged_header.md
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import type { LucideIcon } from 'lucide-react';

export type SubtitleVariant = 'default' | 'success' | 'danger';

export interface PageHeaderState {
  /** Page title displayed in the app bar (uppercase, tracking-widest) */
  title: string;
  /** Optional Lucide icon rendered before the title */
  icon?: LucideIcon;
  /** Optional metadata string shown as a pill badge (e.g. "3 sequences · 11 intents") */
  subtitle?: string;
  /** Pill colour variant: default (muted), success (green), danger (red) */
  subtitleVariant?: SubtitleVariant;
}

interface PageHeaderContextValue {
  header: PageHeaderState;
  setHeader: (state: PageHeaderState) => void;
}

const defaultHeader: PageHeaderState = { title: '' };

const PageHeaderContext = createContext<PageHeaderContextValue>({
  header: defaultHeader,
  setHeader: () => {},
});

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export const PageHeaderProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [header, setHeaderState] = useState<PageHeaderState>(defaultHeader);

  const setHeader = useCallback((state: PageHeaderState) => {
    setHeaderState(state);
  }, []);

  return (
    <PageHeaderContext.Provider value={{ header, setHeader }}>
      {children}
    </PageHeaderContext.Provider>
  );
};

/* ------------------------------------------------------------------ */
/*  Consumer hooks                                                     */
/* ------------------------------------------------------------------ */

/** Read current header state (used by App.tsx to render the app bar). */
export function usePageHeader(): PageHeaderState {
  return useContext(PageHeaderContext).header;
}

/**
 * Declare header content for the current page.
 *
 * Call at the top of any page/panel component. Reactively updates whenever
 * the dependency values change (e.g. sequence count, connection status).
 *
 * @example
 * useSetPageHeader({ title: 'OBS Control', icon: Aperture, subtitle: 'Connected', subtitleVariant: 'success' });
 */
export function useSetPageHeader(state: PageHeaderState): void {
  const { setHeader } = useContext(PageHeaderContext);

  useEffect(() => {
    setHeader(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setHeader, state.title, state.subtitle, state.subtitleVariant, state.icon]);
}
