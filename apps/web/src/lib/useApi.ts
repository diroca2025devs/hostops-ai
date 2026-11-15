'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from './api';

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Busca dados da API e expõe estado de carregamento/erro. `path = null` adia a busca. */
export function useApi<T>(path: string | null, options: { refreshMs?: number } = {}): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (path === null) return;
    const id = ++latest.current;
    setLoading(true);
    api
      .get<T>(path)
      .then((result) => {
        if (id !== latest.current) return;
        setData(result);
        setError(null);
      })
      .catch((e) => {
        if (id === latest.current) setError(errorMessage(e));
      })
      .finally(() => {
        if (id === latest.current) setLoading(false);
      });
  }, [path, tick]);

  useEffect(() => {
    if (!options.refreshMs || path === null) return;
    const timer = setInterval(() => setTick((t) => t + 1), options.refreshMs);
    return () => clearInterval(timer);
  }, [options.refreshMs, path]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload };
}
