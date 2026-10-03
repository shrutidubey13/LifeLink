import { useEffect } from 'react';

export function useTitle(title: string) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title ? `${title} — GitLink` : 'GitLink — Student-Owned Identity Wallet';
    return () => {
      document.title = prevTitle;
    };
  }, [title]);
}
