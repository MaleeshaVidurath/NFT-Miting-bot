/** Fiat currencies the price cap can be expressed in. All verified against
 *  CoinGecko's supported_vs_currencies list. */
export interface Currency {
  code: string;
  symbol: string;
  label: string;
  /** Digits shown after the decimal point. Zero for currencies where a
   *  fraction is meaningless in practice (yen, rupiah, dong). */
  decimals: number;
}

export const CURRENCIES: Currency[] = [
  { code: 'usd', symbol: '$',   label: 'US Dollar',           decimals: 2 },
  { code: 'eur', symbol: '€',   label: 'Euro',                decimals: 2 },
  { code: 'gbp', symbol: '£',   label: 'British Pound',       decimals: 2 },
  { code: 'lkr', symbol: 'Rs',  label: 'Sri Lankan Rupee',    decimals: 0 },
  { code: 'inr', symbol: '₹',   label: 'Indian Rupee',        decimals: 0 },
  { code: 'pkr', symbol: '₨',   label: 'Pakistani Rupee',     decimals: 0 },
  { code: 'bdt', symbol: '৳',   label: 'Bangladeshi Taka',    decimals: 0 },
  { code: 'aed', symbol: 'AED', label: 'UAE Dirham',          decimals: 2 },
  { code: 'sar', symbol: 'SAR', label: 'Saudi Riyal',         decimals: 2 },
  { code: 'aud', symbol: 'A$',  label: 'Australian Dollar',   decimals: 2 },
  { code: 'cad', symbol: 'C$',  label: 'Canadian Dollar',     decimals: 2 },
  { code: 'nzd', symbol: 'NZ$', label: 'New Zealand Dollar',  decimals: 2 },
  { code: 'sgd', symbol: 'S$',  label: 'Singapore Dollar',    decimals: 2 },
  { code: 'hkd', symbol: 'HK$', label: 'Hong Kong Dollar',    decimals: 2 },
  { code: 'jpy', symbol: '¥',   label: 'Japanese Yen',        decimals: 0 },
  { code: 'cny', symbol: 'CN¥', label: 'Chinese Yuan',        decimals: 2 },
  { code: 'krw', symbol: '₩',   label: 'South Korean Won',    decimals: 0 },
  { code: 'twd', symbol: 'NT$', label: 'Taiwan Dollar',       decimals: 2 },
  { code: 'php', symbol: '₱',   label: 'Philippine Peso',     decimals: 2 },
  { code: 'thb', symbol: '฿',   label: 'Thai Baht',           decimals: 2 },
  { code: 'idr', symbol: 'Rp',  label: 'Indonesian Rupiah',   decimals: 0 },
  { code: 'myr', symbol: 'RM',  label: 'Malaysian Ringgit',   decimals: 2 },
  { code: 'vnd', symbol: '₫',   label: 'Vietnamese Dong',     decimals: 0 },
  { code: 'chf', symbol: 'CHF', label: 'Swiss Franc',         decimals: 2 },
  { code: 'sek', symbol: 'kr',  label: 'Swedish Krona',       decimals: 2 },
  { code: 'nok', symbol: 'kr',  label: 'Norwegian Krone',     decimals: 2 },
  { code: 'dkk', symbol: 'kr',  label: 'Danish Krone',        decimals: 2 },
  { code: 'pln', symbol: 'zł',  label: 'Polish Zloty',        decimals: 2 },
  { code: 'try', symbol: '₺',   label: 'Turkish Lira',        decimals: 2 },
  { code: 'rub', symbol: '₽',   label: 'Russian Ruble',       decimals: 2 },
  { code: 'ils', symbol: '₪',   label: 'Israeli Shekel',      decimals: 2 },
  { code: 'zar', symbol: 'R',   label: 'South African Rand',  decimals: 2 },
  { code: 'ngn', symbol: '₦',   label: 'Nigerian Naira',      decimals: 0 },
  { code: 'brl', symbol: 'R$',  label: 'Brazilian Real',      decimals: 2 },
  { code: 'mxn', symbol: 'Mex$',label: 'Mexican Peso',        decimals: 2 },
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code);

export function currencyOf(code: string): Currency {
  return BY_CODE.get(code.toLowerCase()) ?? CURRENCIES[0]!;
}

/** Format an amount for display, e.g. 1.5 usd -> "$1.50", 300 lkr -> "Rs 300". */
export function formatMoney(amount: number, code: string): string {
  const c = currencyOf(code);
  const n = amount.toLocaleString('en-US', {
    minimumFractionDigits: c.decimals,
    maximumFractionDigits: c.decimals,
  });
  // Symbols that are letters read better with a space.
  const spaced = /[A-Za-z]$/.test(c.symbol);
  return c.symbol + (spaced ? ' ' : '') + n;
}
