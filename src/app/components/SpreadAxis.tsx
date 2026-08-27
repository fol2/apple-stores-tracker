import { useEffect, useRef, useState } from 'react'
import type { MarketPrice } from '../../shared/convert'
import { formatIn, formatLocal, rowKey } from '../../shared/convert'

interface Props {
  rows: MarketPrice[]
  homeMarketId: string
  currency: string
}

/**
 * Plot every market on a real price axis.
 *
 * A ranked table answers "which is cheapest"; it does not answer "is the gap
 * worth a flight". Position on a continuous axis does: it shows whether the
 * markets cluster tightly with one outlier, or spread evenly across hundreds
 * of pounds. That distinction is the actual decision this page exists for.
 */
export function SpreadAxis({ rows, homeMarketId, currency }: Props) {
  const [active, setActive] = useState<string | null>(null)
  const figure = useRef<HTMLElement>(null)

  // Touch has no "leave", so a tapped label would otherwise stay open forever.
  // Closing on any pointer down outside the figure gives it the dismissal that
  // hovering gets for free.
  useEffect(() => {
    if (!active) return
    const dismiss = (event: PointerEvent) => {
      if (!figure.current?.contains(event.target as Node)) setActive(null)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [active])

  const priced = rows.filter((r) => r.displayAmount !== null)
  if (priced.length < 2) return null

  const amounts = priced.map((r) => r.displayAmount!)
  const min = Math.min(...amounts)
  const max = Math.max(...amounts)
  const span = max - min || 1

  // Prefer the education row at home: for a student that is what they pay.
  const home =
    priced.find((r) => r.market.id === homeMarketId && r.isEducation) ??
    priced.find((r) => r.market.id === homeMarketId)
  const position = (amount: number) => ((amount - min) / span) * 100

  const hovered = priced.find((r) => rowKey(r) === active)

  return (
    <figure ref={figure} className="mt-8 pt-14">
      <figcaption className="eyebrow mb-3">Every market, placed by price</figcaption>

      <div
        className="relative h-20"
        onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
      >
        {/* The axis itself, running low to high. */}
        <div className="absolute inset-x-0 top-9 h-px bg-rule" />

        {/* Home market gets a full-height reference line: everything else is
            read as a distance from what you would pay without travelling. */}
        {home && (
          <div
            className="settle absolute top-0 bottom-6 w-px bg-home/50"
            style={{ left: `${position(home.displayAmount!)}%` }}
          >
            {/* Past halfway the label would run off the right edge, so it
                switches to the inside of its own line. */}
            <span
              className={[
                'absolute -top-1 text-[0.625rem] font-semibold whitespace-nowrap text-home',
                position(home.displayAmount!) > 50 ? 'right-1.5' : 'left-1.5',
              ].join(' ')}
            >
              {home.market.name}
            </span>
          </div>
        )}

        {hovered && <Label row={hovered} left={position(hovered.displayAmount!)} cheapest={min} currency={currency} />}

        {priced.map((row, index) => {
          const left = position(row.displayAmount!)
          const isLow = index === 0
          const isHigh = row.displayAmount === max
          const key = rowKey(row)
          const isActive = key === active

          return (
            <button
              key={key}
              type="button"
              // Markers are a few pixels wide and often overlap, so the button
              // carries a much larger invisible hit area than the dot it draws:
              // 44px on touch, which is the smallest target a finger can hit
              // reliably, and tighter on a mouse where neighbours are close.
              className="settle absolute top-9 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center focus-visible:outline-none sm:size-7"
              style={{ left: `${left}%`, zIndex: isActive ? 3 : 2 }}
              // Only a real mouse gets hover: touch synthesises enter events
              // that would open the label and let the click close it again.
              onPointerEnter={(e) => e.pointerType === 'mouse' && setActive(key)}
              onFocus={() => setActive(key)}
              onBlur={() => setActive(null)}
              // Tapping opens the label; tapping the same dot again closes it.
              onClick={() => setActive(isActive ? null : key)}
              aria-label={`${row.market.name}${row.isEducation ? ' education' : ''}, ${formatIn(row.displayAmount!, currency)}`}
            >
              <span
                aria-hidden
                className={[
                  'block rounded-full ring-2 ring-paper transition-transform',
                  isActive ? 'scale-150' : '',
                  row.isEducation
                    ? 'size-3 bg-low ring-low/40'
                    : isLow
                      ? 'size-3 bg-low'
                      : isHigh
                        ? 'size-3 bg-high'
                        : 'size-2 bg-ink/40',
                ].join(' ')}
              />
            </button>
          )
        })}

        {/* Flags sit below their markers only at the extremes; in the middle
            they would collide, and the table already names every market. */}
        <div className="absolute inset-x-0 top-12 flex justify-between text-xs">
          <span className="tnum font-semibold text-low">
            {priced[0].market.flag} {formatIn(min, currency)}
          </span>
          <span className="tnum font-semibold text-high">
            {formatIn(max, currency)} {priced.at(-1)!.market.flag}
          </span>
        </div>
      </div>
    </figure>
  )
}

interface LabelProps {
  row: MarketPrice
  left: number
  cheapest: number
  currency: string
}

function Label({ row, left, cheapest, currency }: LabelProps) {
  const gap = row.displayAmount! - cheapest

  // Near an edge the label would overflow the figure, so it stops centring on
  // its marker and tucks against the side instead.
  const anchor = left < 12 ? 'left' : left > 88 ? 'right' : 'centre'
  const shift =
    anchor === 'left' ? 'translateX(0)' : anchor === 'right' ? 'translateX(-100%)' : 'translateX(-50%)'

  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 -top-13"
      style={{ left: `${left}%`, transform: shift }}
    >
      <div className="rounded-md border border-rule bg-raised px-2.5 py-1.5 whitespace-nowrap shadow-lg">
        <p className="text-xs font-semibold">
          {row.market.flag} {row.market.name}
          {row.isEducation && <span className="ml-1.5 text-low">edu</span>}
        </p>
        <p className="tnum mt-0.5 text-xs">
          <span className="font-mono font-semibold">{formatIn(row.displayAmount!, currency)}</span>
          {row.offer && row.offer.currency !== currency && (
            <span className="ml-1.5 text-soft">{formatLocal(row.offer.amount, row.offer.currency)}</span>
          )}
        </p>
        <p className="tnum mt-0.5 text-[0.6875rem]">
          {gap === 0 ? (
            <span className="text-low">cheapest</span>
          ) : (
            <span className="text-soft">+{formatIn(gap, currency)} vs cheapest</span>
          )}
        </p>
      </div>

      {/* A stem tying the card to its marker, dropped when the card is tucked
          against an edge and no longer sits over the dot. */}
      {anchor === 'centre' && (
        <div className="mx-auto size-2 -translate-y-1 rotate-45 border-r border-b border-rule bg-raised" />
      )}
    </div>
  )
}
