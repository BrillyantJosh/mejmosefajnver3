import { useEffect } from 'react';

export default function OfflineWallets() {
  useEffect(() => {
    window.open('https://offlinelana.org/', '_blank');
    window.history.back();
  }, []);

  return null;
}
