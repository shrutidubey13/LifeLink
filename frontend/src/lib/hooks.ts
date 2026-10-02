/**
 * Two tiny hooks that give every request in the app the same
 * loading / error / retry behaviour.
 */
import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from './format';

interface RequestState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Load data on mount and whenever `key` changes.
 *
 * `loader` is intentionally left out of the dependency list: callers usually
 * pass an inline arrow function, and including it would re-run on every render.
 * `key` is the caller's promise of "these are the inputs that matter".
 */
export function useRequest<T>(loader: () => Promise<T>, key: string): RequestState<T> & { reload: () => void } {
  const [state, setState] = useState<RequestState<T>>({ data: null, loading: true, error: null });

  const run = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await loader();
      setState({ data, loading: false, error: null });
    } catch (err) {
      setState({ data: null, loading: false, error: errorMessage(err) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    void run();
  }, [run]);

  return { ...state, reload: () => void run() };
}

/**
 * Wrap a mutating action (POST/DELETE) with a pending flag and an error message.
 * `run` returns null on failure so callers can branch without try/catch.
 */
export function useAction<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
): {
  run: (...args: TArgs) => Promise<TResult | null>;
  pending: boolean;
  error: string | null;
  clearError: () => void;
} {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (...args: TArgs): Promise<TResult | null> => {
      setPending(true);
      setError(null);
      try {
        return await action(...args);
      } catch (err) {
        setError(errorMessage(err));
        return null;
      } finally {
        setPending(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return { run, pending, error, clearError: () => setError(null) };
}
