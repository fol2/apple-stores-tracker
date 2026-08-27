import type { MarketPrice } from '../../shared/convert'
import { formatBase } from '../../shared/convert'

interface Props {
  rows: MarketPrice[]
  homeMarketId: string
}

/**
 * Plot every market on a real price axis.
 *
 * A ranked table answers "which is cheapest"; it does not answer "is the gap
 * worth a flight". Position on a continuous axis does: it shows whether the
 * markets cluster tightly with one outlier, or spread evenly across hundreds
 * of pounds. That distinction is the actual decision this page exists for.
 */
export function SpreadAxis({ rows, homeMarketId }: Props) {
  const priced = rows.filter((r) => r.baseAmount !== null)
  if (priced.length < 2) return null

  const amounts = priced.map((r) => r.baseAmount!)
  const min = Math.min(...amounts)
  const max = Math.max(...amounts)
  const span = max - min || 1

  const home = priced.find((r) => r.market.id === homeMarketId)
  const position = (amount: number) => ((amount - min) / span) * 100

  return (
    <figure className="mt-8">
      <figcaption className="eyebrow mb-3">
        Every market, placed by price
      </figcaption>

      <div className="relative h-20">
        {/* The axis itself, running low to high. */}
        <div className="absolute inset-x-0 top-9 h-px bg-rule" />

        {/* Home market gets a full-height reference line: everything else is
            read as a distance from what you would pay without travelling. */}
        {home && (
          <div
            className="settle absolute top-0 bottom-6 w-px bg-home/50"
            style={{ left: `${position(home.baseAmount!)}%` }}
          >
            <span className="absolute -top-1 left-1.5 text-[0.625rem] font-semibold whitespace-nowrap text-home">
              {home.market.name}
            </span>
          </div>
        )}

        {priced.map((row, index) => {
          const left = position(row.baseAmount!)
          const isLow = index === 0
          const isHigh = row.baseAmount === max
          return (
            <div
              key={row.market.id}
              className="settle absolute top-9 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${left}%` }}
              title={`${row.market.name} — ${formatBase(row.baseAmount!)}`}
            >
              <span
                aria-hidden
                className={[
                  'block rounded-full ring-2 ring-paper',
                  isLow ? 'size-3 bg-low' : isHigh ? 'size-3 bg-high' : 'size-2 bg-ink/40',
                ].join(' ')}
              />
            </div>
          )
        })}

        {/* Flags sit below their markers only at the extremes; in the middle
            they would collide, and the table already names every market. */}
        <div className="absolute inset-x-0 top-12 flex justify-between text-xs">
          <span className="tnum font-semibold text-low">
            {priced[0].market.flag} {formatBase(min)}
          </span>
          <span className="tnum font-semibold text-high">
            {formatBase(max)} {priced.at(-1)!.market.flag}
          </span>
        </div>
      </div>
    </figure>
  )
}
