import { TranslationDict } from '../types';

// Bilingual dictionary for the Discount / Sell LANA module.
// English is the required base (fallback); Slovenian mirrors every key.
// Language is resolved from the KIND 0 profile via useTranslation() / I18nContext.
const discount = {

  // ── layout ──
  "layout.nav.sell": "Sell LANA",
  "layout.nav.transactions": "Transactions",

  // ── sell ──
  // Lana.discount no longer buys LANA (8 Oct 2026): the Sell page names the
  // firms that do (src/components/discount/SellingMovedNotice.tsx). All of its
  // words are in ./sellingMoved.ts, the line about past sales under
  // Transactions too (moved.pastSales): this module has only English and
  // Slovenian, the notice five languages, and one card speaks one language.

  // ── tx ──
  "tx.account": "Account",
  "tx.amount": "Amount",
  "tx.badgeCompleted": "Completed",
  "tx.badgePaid": "Paid",
  "tx.badgePartial": "Partial paid",
  "tx.buybackWallet": "Buyback Wallet",
  "tx.commission": "Commission ({percent}%)",
  "tx.emptyDesc": "Your sales of LANA through Lana.Discount show here",
  "tx.emptyTitle": "No buyback transactions yet",
  "tx.exchangeRate": "Exchange Rate",
  "tx.gross": "Gross",
  "tx.lanaLanoshis": "LANA (lanoshis)",
  "tx.loading": "Loading transactions...",
  "tx.na": "N/A",
  "tx.netPayout": "Net Payout",
  "tx.paidAt": "Paid At",
  "tx.paidSoFar": "Paid so far",
  "tx.payouts": "Payouts ({count})",
  "tx.reference": "Reference",
  "tx.refresh": "Refresh",
  "tx.remaining": "Remaining",
  "tx.rpcVerified": "RPC Verified ({count} confirmations)",
  "tx.sender": "Sender",
  "tx.split": "Split",
  "tx.statLanaSold": "LANA Sold",
  "tx.statPaidOut": "Paid Out",
  "tx.statTransactions": "Transactions",
  "tx.subtitle": "Lana.Discount buyback history & payouts",
  "tx.title": "Transactions",
  "tx.transactionId": "Transaction ID",
  "tx.tryAgain": "Try again",
  "tx.txHash": "TX Hash",
} as const;

export type DiscountKey = keyof typeof discount;

const translations: TranslationDict<DiscountKey> = {
  en: discount,
  sl: {

    // ── layout ──
    "layout.nav.sell": "Prodaj LANA",
    "layout.nav.transactions": "Transakcije",

    // ── tx ──
    "tx.account": "Račun",
    "tx.amount": "Znesek",
    "tx.badgeCompleted": "Zaključeno",
    "tx.badgePaid": "Plačano",
    "tx.badgePartial": "Delno plačano",
    "tx.buybackWallet": "Odkupna denarnica",
    "tx.commission": "Provizija ({percent}%)",
    "tx.emptyDesc": "Tu se prikažejo tvoje prodaje LANA prek Lana.Discount",
    "tx.emptyTitle": "Še ni odkupnih transakcij",
    "tx.exchangeRate": "Menjalni tečaj",
    "tx.gross": "Bruto",
    "tx.lanaLanoshis": "LANA (lanoshi)",
    "tx.loading": "Nalaganje transakcij ...",
    "tx.na": "Ni podatka",
    "tx.netPayout": "Neto izplačilo",
    "tx.paidAt": "Plačano dne",
    "tx.paidSoFar": "Doslej plačano",
    "tx.payouts": "Izplačila ({count})",
    "tx.reference": "Sklic",
    "tx.refresh": "Osveži",
    "tx.remaining": "Preostalo",
    "tx.rpcVerified": "RPC preverjeno ({count} potrditev)",
    "tx.sender": "Pošiljatelj",
    "tx.split": "Split",
    "tx.statLanaSold": "Prodano LANA",
    "tx.statPaidOut": "Izplačano",
    "tx.statTransactions": "Transakcije",
    "tx.subtitle": "Lana.Discount zgodovina odkupov in izplačil",
    "tx.title": "Transakcije",
    "tx.transactionId": "ID transakcije",
    "tx.tryAgain": "Poskusi znova",
    "tx.txHash": "TX hash",
  },
};

export default translations;
