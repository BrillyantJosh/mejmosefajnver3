/**
 * CAN THIS WALLET ACTUALLY PAY THIS INVOICE?
 *
 * Every payment screen in this app asked `balance >= amount` and painted a
 * green "Sufficient funds" on the answer. A transaction also has to pay the
 * miner, and an ordinary payment pays it out of the change — so a wallet
 * holding EXACTLY the invoice amount is shown green, the Pay button is
 * enabled, and the server refuses it. The invoice is fixed, so there is
 * nothing the payer can do except put more LANA in; nobody told them that,
 * or how much.
 *
 * The fee depends on how many pieces the wallet is in, which only the chain
 * knows, so it is asked for rather than guessed. `get-utxo-info` already
 * returns the fee for an EMPTYING transaction — every input, ONE output. An
 * ordinary payment has a second output for the change, and a second output
 * costs exactly 34 bytes at the same rate, every time: 34 * 100 * 1.5 = 5,100
 * lanoshis. Deriving it from their number rather than re-implementing the
 * formula means the two cannot drift apart on the input count.
 */

/** The change output an ordinary payment has and an emptying one does not. */
export const CHANGE_OUTPUT_LANOSHIS = 5_100;

const LANOSHIS = 100_000_000;

export interface FundsVerdict {
  /** True only when the wallet can pay the amount AND the fee. */
  enough: boolean;
  /** The network fee in LANA, or null when the chain could not be asked. */
  feeLana: number | null;
  /**
   * What is missing, in LANA — set only when the amount is there and the fee
   * is not, which is the case nobody was ever told about.
   */
  shortForFeeLana: number | null;
}

/**
 * @param balanceLana what the wallet holds
 * @param amountLana  what the invoice says
 * @param feeLana     from `estimateOrdinaryFeeLana`, or null if unknown
 *
 * An unknown fee keeps the old answer rather than inventing a refusal: a till
 * that cannot reach the chain for a moment must not stop taking payments. It
 * simply never claims "enough" on evidence it does not have.
 */
export function canPay(balanceLana: number, amountLana: number, feeLana: number | null): FundsVerdict {
  if (feeLana === null) {
    return { enough: balanceLana >= amountLana, feeLana: null, shortForFeeLana: null };
  }
  const needed = amountLana + feeLana;
  if (balanceLana >= needed) return { enough: true, feeLana, shortForFeeLana: null };
  return {
    enough: false,
    feeLana,
    // Only when the AMOUNT is covered and the fee is what is missing. A wallet
    // short of the amount itself is short in the ordinary way and already says so.
    shortForFeeLana: balanceLana >= amountLana ? needed - balanceLana : null,
  };
}

/**
 * The fee an ordinary payment out of this wallet would cost, in LANA.
 * Returns null when the chain could not be asked — never a guess.
 */
export async function estimateOrdinaryFeeLana(
  address: string,
  invoke: (name: string, opts: { body: unknown }) => Promise<{ data: any; error: any }>,
): Promise<number | null> {
  try {
    const { data, error } = await invoke('get-utxo-info', { body: { address } });
    if (error) return null;
    const emptying = data?.estimatedFee;
    if (typeof emptying !== 'number' || !Number.isFinite(emptying) || emptying <= 0) return null;
    return (emptying + CHANGE_OUTPUT_LANOSHIS) / LANOSHIS;
  } catch {
    return null;
  }
}
