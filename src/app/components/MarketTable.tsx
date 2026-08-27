import type { MarketPrice } from '../../shared/convert'
import { formatBase, formatLocal } from '../../shared/convert'

interface Props {
  rows: MarketPrice[]
  homeMarketId: string
  showRefunds: boolean
}

const percent = (rate: number) => `${(rate * 100).toFixed(1)}%`

export function MarketTable({ rows, homeMarketId, showRefunds }: Props) {
  const cheapest = rows.find((r) => r.baseAmount !== null)?.baseAmount ?? null

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-rule text-left">
            <th className="eyebrow py-2 pr-3 font-semibold">#</th>
            <th className="eyebrow py-2 pr-3 font-semibold">Market</th>
            <th className="eyebrow py-2 pr-3 text-right font-semibold">Local price</th>
            {showRefunds && (
              <th className="eyebrow py-2 pr-3 text-right font-semibold">Refund</th>
            )}
            <th className="eyebrow py-2 pr-3 text-right font-semibold">In pounds</th>
            <th className="eyebrow py-2 text-right font-semibold">vs cheapest</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const isHome = row.market.id === homeMarketId
            const gap =
              row.baseAmount !== null && cheapest !== null ? row.baseAmount - cheapest : null

            return (
              <tr
                key={row.market.id}
                className={[
                  'border-b border-rule/60',
                  isHome ? 'bg-home/[0.06]' : '',
                  row.offer ? '' : 'text-soft',
                ].join(' ')}
              >
                <td className="tnum py-2.5 pr-3 text-soft">
                  {row.baseAmount === null ? '—' : index + 1}
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
                </td>

                <td className="tnum py-2.5 pr-3 text-right">
                  {row.offer ? (
                    formatLocal(row.offer.amount, row.offer.currency)
                  ) : (
                    <span title="Apple does not list this configuration in this market.">
                      not sold
                    </span>
                  )}
                </td>

                {showRefunds && (
                  <td className="tnum py-2.5 pr-3 text-right">
                    {row.policy.available ? (
                      <span className="text-low" title={row.policy.note}>
                        −{percent(row.policy.rate)}
                      </span>
                    ) : (
                      <span className="text-soft" title={row.policy.note}>
                        none
                      </span>
                    )}
                  </td>
                )}

                <td className="tnum py-2.5 pr-3 text-right font-semibold">
                  {row.baseAmount === null ? '—' : formatBase(row.baseAmount)}
                </td>

                <td className="tnum py-2.5 text-right">
                  {gap === null ? (
                    '—'
                  ) : gap === 0 ? (
                    <span className="font-semibold text-low">cheapest</span>
                  ) : (
                    <span className="text-soft">+{formatBase(gap)}</span>
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
