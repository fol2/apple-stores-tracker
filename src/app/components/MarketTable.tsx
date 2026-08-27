import type { MarketPrice } from '../../shared/convert'
import { formatIn, formatLocal, rowKey } from '../../shared/convert'

interface Props {
  rows: MarketPrice[]
  homeMarketId: string
  showRefunds: boolean
  currency: string
}

const percent = (rate: number) => `${(rate * 100).toFixed(1)}%`

export function MarketTable({ rows, homeMarketId, showRefunds, currency }: Props) {
  const cheapest = rows.find((r) => r.displayAmount !== null)?.displayAmount ?? null

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm sm:min-w-[44rem]">
        <thead>
          <tr className="border-b border-rule text-left">
            <th className="eyebrow py-2 pr-3 font-semibold">#</th>
            <th className="eyebrow py-2 pr-3 font-semibold">Market</th>
            <th className="eyebrow hidden py-2 pr-3 text-right font-semibold sm:table-cell">
              Local price
            </th>
            {showRefunds && (
              <th className="eyebrow hidden py-2 pr-3 text-right font-semibold sm:table-cell">
                Refund
              </th>
            )}
            <th className="eyebrow py-2 pr-3 text-right font-semibold">In {currency}</th>
            <th className="eyebrow py-2 text-right font-semibold">vs cheapest</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const isHome = row.market.id === homeMarketId
            const saved =
              row.retailDisplayAmount != null && row.displayAmount != null
                ? row.retailDisplayAmount - row.displayAmount
                : null
            const gap =
              row.displayAmount !== null && cheapest !== null ? row.displayAmount - cheapest : null

            return (
              <tr
                key={rowKey(row)}
                className={[
                  'border-b border-rule/60',
                  row.isEducation ? 'bg-low/[0.05]' : isHome ? 'bg-home/[0.06]' : '',
                  row.offer ? '' : 'text-soft',
                ].join(' ')}
              >
                <td className="tnum py-2.5 pr-3 text-soft">
                  {row.displayAmount === null ? '—' : index + 1}
                </td>

                <td className="py-2.5 pr-3">
                  <span className="mr-2">{row.market.flag}</span>
                  {row.offer ? (
                    <a
                      className="underline decoration-rule underline-offset-4 hover:decoration-ink"
                      href={row.offer.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {row.market.name}
                    </a>
                  ) : (
                    row.market.name
                  )}
                  {isHome && <span className="ml-2 text-[0.625rem] text-home">home</span>}
                  {row.isEducation && (
                    <span
                      className="ml-2 rounded-full border border-low/50 bg-low/10 px-1.5 py-0.5 text-[0.625rem] font-semibold text-low"
                      title="Apple education store price. Apple verifies eligibility at checkout."
                    >
                      education
                    </span>
                  )}
                  {saved != null && saved > 0 && (
                    <span className="tnum ml-2 text-[0.625rem] text-low">
                      saves {formatIn(saved, currency)}
                    </span>
                  )}

                  {/* What the hidden columns would have said, for narrow screens. */}
                  <span className="tnum mt-0.5 block text-xs text-soft sm:hidden">
                    {row.offer ? formatLocal(row.offer.amount, row.offer.currency) : 'not sold here'}
                    {row.market.pricesExcludeTax && <span className="text-high"> +tax</span>}
                    {showRefunds && row.policy.available && (
                      <span className={row.policy.appleConfirmed ? 'text-low' : ''}>
                        {' · '}−{percent(row.policy.rate)} refund
                        {!row.policy.appleConfirmed && '?'}
                      </span>
                    )}
                  </span>
                </td>

                <td className="tnum hidden py-2.5 pr-3 text-right sm:table-cell">
                  {row.offer ? (
                    <>
                      {formatLocal(row.offer.amount, row.offer.currency)}
                      {row.market.pricesExcludeTax && (
                        <span
                          className="ml-1 text-high"
                          title="Before sales tax, which is added at checkout and varies by state."
                        >
                          +tax
                        </span>
                      )}
                    </>
                  ) : (
                    <span title="Apple does not list this configuration in this market.">
                      not sold
                    </span>
                  )}
                </td>

                {showRefunds && (
                  <td className="tnum hidden py-2.5 pr-3 text-right sm:table-cell">
                    {row.policy.available ? (
                      <span
                        className={row.policy.appleConfirmed ? 'text-low' : 'text-soft'}
                        title={
                          row.policy.appleConfirmed
                            ? row.policy.note
                            : `${row.policy.note} Apple's participation in this scheme is unverified.`
                        }
                      >
                        −{percent(row.policy.rate)}
                        {!row.policy.appleConfirmed && <span className="ml-0.5">?</span>}
                      </span>
                    ) : (
                      <span className="text-soft" title={row.policy.note}>
                        none
                      </span>
                    )}
                  </td>
                )}

                <td className="tnum py-2.5 pr-3 text-right font-semibold">
                  {row.displayAmount === null ? '—' : formatIn(row.displayAmount, currency)}
                </td>

                <td className="tnum py-2.5 text-right">
                  {gap === null ? (
                    '—'
                  ) : gap === 0 ? (
                    <span className="font-semibold text-low">cheapest</span>
                  ) : (
                    <span className="text-soft">+{formatIn(gap, currency)}</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
