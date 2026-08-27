/**
 * Tourist tax-refund estimates.
 *
 * These are ESTIMATES, not quotes. Every scheme has eligibility rules (minimum
 * spend, departure window, approved retailer, proof of export) and most refund
 * operators take a cut that varies by operator and payout method. `rate` is the
 * fraction of the local list price a visitor can realistically expect back,
 * net of typical fees — deliberately conservative where operators skim.
 *
 * Each entry records its derivation so the number can be re-checked when a
 * country changes its VAT rate, rather than being an unexplained constant.
 */
export interface RefundPolicy {
  available: boolean
  /** Fraction of the local list price refunded, net of typical operator fees. */
  rate: number
  /** Flat administrative deduction in local currency, if the scheme has one. */
  fixedFee: number
  note: string
}

const none = (note: string): RefundPolicy => ({ available: false, rate: 0, fixedFee: 0, note })

export const REFUND_POLICIES: Record<string, RefundPolicy> = {
  uk: none(
    'The UK withdrew VAT-free shopping for visitors in January 2021, so there is no refund to claim.',
  ),
  us: none(
    'US list prices exclude sales tax, which is added at checkout and varies by state. There is no federal tourist refund.',
  ),
  hk: none('Hong Kong levies no VAT or general sales tax, so there is nothing to refund.'),
  ca: none('Canada no longer offers a general visitor GST/HST rebate on goods like these.'),

  // 23% VAT → 23/123 gross; operators typically return ~75% of that.
  ie: { available: true, rate: (23 / 123) * 0.75, fixedFee: 0, note: 'Estimated non-EU-resident refund of Ireland’s 23% VAT, net of typical operator fees.' },
  // 19% VAT → 19/119 gross, less operator fees.
  de: { available: true, rate: (19 / 119) * 0.75, fixedFee: 0, note: 'Estimated non-EU-resident refund of Germany’s 19% VAT, net of typical operator fees.' },
  // 20% VAT → 20/120 gross, less operator fees.
  fr: { available: true, rate: (20 / 120) * 0.72, fixedFee: 0, note: 'Estimated non-EU-resident refund of France’s 20% VAT, net of typical operator fees.' },
  // Full exemption from the 10% consumption tax at a licensed tax-free retailer.
  jp: { available: true, rate: 10 / 110, fixedFee: 0, note: 'Estimated exemption from Japan’s 10% consumption tax. The retailer and the purchase must both qualify as tax-free.' },
  // Korea Tourism Organization quotes roughly 5–8% net; midpoint used.
  kr: { available: true, rate: 0.07, fixedFee: 0, note: 'Midpoint of the Korea Tourism Organization’s approximate 5–8% net refund range after processing fees.' },
  // 7% VAT → 7/107 gross, less administrative and payment fees.
  th: { available: true, rate: 0.06, fixedFee: 0, note: 'Estimated net VAT refund on Thailand’s 7% VAT after typical administrative and payment fees.' },
  // 9% GST → 9/109 gross, less operator fees.
  sg: { available: true, rate: 0.075, fixedFee: 0, note: 'Estimated net refund under Singapore’s Tourist Refund Scheme after operator fees.' },
  // Tourist Refund Scheme returns the 10% GST component in full.
  au: { available: true, rate: 10 / 110, fixedFee: 0, note: 'Estimated Australian TRS refund of the 10% GST component. Eligibility rules still apply.' },
  // 5% business tax, less the official 20% processing fee.
  tw: { available: true, rate: (5 / 105) * 0.8, fixedFee: 0, note: 'Refund of Taiwan’s 5% business tax, less the official 20% processing fee.' },
  // Departure refund of ~11%, less the agent's cut.
  cn: { available: true, rate: 0.09, fixedFee: 0, note: 'Estimated departure refund for overseas visitors, net of the agency fee.' },
  // 5% VAT → 5/105 gross, less operator fees.
  ae: { available: true, rate: (5 / 105) * 0.86, fixedFee: 0, note: 'Estimated UAE tourist VAT refund after the operator’s fee.' },
}

export const refundPolicy = (marketId: string): RefundPolicy =>
  REFUND_POLICIES[marketId] ?? none('No refund data for this market.')

/** Local-currency price after an estimated tourist refund. */
export function afterRefund(amount: number, policy: RefundPolicy): number {
  if (!policy.available) return amount
  return Math.max(0, amount * (1 - policy.rate) - policy.fixedFee)
}
