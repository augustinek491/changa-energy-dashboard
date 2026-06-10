'use client';

// Console-wide fleet filter. Mounted once in the (app) layout so the active
// filter persists as the user moves between Stations and the Fleet Map.

import { createContext, useCallback, useContext, useState, ReactNode } from 'react';
import { FilterState, EMPTY_FILTER } from '@/lib/v2/filter';

interface FilterCtx {
  filter: FilterState;
  setFilter: (f: FilterState) => void;
  patch: (p: Partial<FilterState>) => void;
  reset: () => void;
}

const Ctx = createContext<FilterCtx | null>(null);

export function OneViewFilterProvider({ children }: { children: ReactNode }) {
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  const patch = useCallback((p: Partial<FilterState>) => setFilter(f => ({ ...f, ...p })), []);
  const reset = useCallback(() => setFilter(EMPTY_FILTER), []);
  return <Ctx.Provider value={{ filter, setFilter, patch, reset }}>{children}</Ctx.Provider>;
}

export function useFleetFilter(): FilterCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useFleetFilter must be used within OneViewFilterProvider');
  return c;
}
