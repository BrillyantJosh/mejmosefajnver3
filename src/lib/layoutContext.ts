import { useOutletContext } from 'react-router-dom';

/** What MainLayout already knows and hands to the page inside it, so the page does not ask the server again. */
export interface LayoutContext {
  /** Lana8Wonder accounts whose funds wait to be paid out (same count as the red "8" in the header). */
  lana8WonderCashOuts: number;
}

/** Outside MainLayout there is no context: nothing is waiting, as far as this page can tell. */
export function useLayoutContext(): LayoutContext {
  return useOutletContext<LayoutContext | undefined>() ?? { lana8WonderCashOuts: 0 };
}
