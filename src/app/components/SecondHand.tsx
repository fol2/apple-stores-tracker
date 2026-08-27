import { useMemo, useState } from 'react'
import { convertBetween, formatIn, formatLocal } from '../../shared/convert'
import type { MarketPrice } from '../../shared/convert'
import { matchRefurb } from '../../shared/secondhand'
import type { FxRates, Offer, RefurbListing } from '../../shared/types'

interface Props {
  offer: Offer | undefined
  listings: RefurbListing[]
  readAt: string | null
  rows: MarketPrice[]
  currency: string
  fx: FxRates
  familyName: string
}

const SPEC_FACETS = [
  'dimensionRelYear',
  'tsMemorySize',
  'dimensionCapacity',
  'dimensionconnectivity',
  'dimensionColor',
]

const prettyFacet = (value: string): string =>
  value
    .replace(/_/g, ' ')
    .replace(/\b(gb|tb|mm)\b/g, (u) => u.toUpperCase())
    .replace(/^(\d+)(gb|tb)$/i, (_, n, u) => `${n}${u.toUpperCase()}`)
    .replace(/^wifi$/, 'Wi-Fi')
    .replace(/^wificell$/, 'Wi-Fi + Cellular')
    .replace(/^\w/, (c) => c.toUpperCase())

/**
 * What the same machine costs used, here, against what it costs new anywhere.
 *
 * The new-price side of this page compares fifteen interchangeable listings of
 * an identical product. This side does not: every refurbished unit is one
 * physical machine sitting in one country's warehouse, and when it sells it is
 * gone. So the comparison is not a ranking but a gap, and the units are shown
 * individually rather than averaged into a market rate.
 */
export function SecondHand({ offer, listings, readAt, rows, currency, fx, familyName }: Props) {
  const priced = rows.filter((r) => r.displayAmount !== null && !r.isEducation)
  const [againstId, setAgainstId] = useState<string | null>(null)

  const match = useMemo(
    () => (offer ? matchRefurb(offer, listings) : null),
    [offer, listings],
  )

  const against = priced.find((r) => r.market.id === againstId) ?? priced[0]
  const inDisplay = (amount: number) => convertBetween(amount, match!.currency, currency, fx)

  if (!offer || !match) {
    return (
      <section className="mt-12">
        <Heading readAt={readAt} />
        <p className="mt-6 text-lg">
          Apple has no refurbished {familyName} matching this configuration today.
        </p>
        <p className="mt-2 max-w-xl text-soft">
          Its refurbished store carries whatever has been returned and restored, so a
          configuration appears when a unit does and vanishes when it sells. Machines Apple
          released recently rarely appear at all.
        </p>
      </section>
    )
  }

  const low = inDisplay(match.low)
  const high = inDisplay(match.high)
  const newPrice = against?.displayAmount ?? null
  const gap = low !== null && newPrice !== null ? newPrice - low : null

  // The bar's full width is the new price, so the used portion reads as a
  // fraction of it — and overflows the track when a used unit costs more,
  // which is the one case a tidier chart would quietly hide.
  const fraction = low !== null && newPrice ? low / newPrice : 0
  const dearer = fraction > 1

  return (
    <section className="mt-12">
      <Heading readAt={readAt} />

      <div className="mt-6 rounded-lg border border-rule bg-raised p-6 sm:p-8">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <span className="font-mono text-4xl font-bold tracking-[-0.06em] sm:text-5xl">
            {low !== null ? formatIn(low, currency) : '—'}
            {high !== null && high !== low && (
              <span className="text-soft"> – {formatIn(high, currency)}</span>
            )}
          </span>
          <span className="text-soft">
            {match.listings.length === 1
              ? 'one unit in stock'
              : `${match.listings.length} units in stock`}
          </span>
        </div>

        {/* The gap, drawn to scale against the new price it is measured from. */}
        {newPrice !== null && low !== null && (
          <figure className="mt-7">
            <div className="relative h-9 overflow-hidden rounded border border-rule">
              <div
                className="settle absolute inset-y-0 left-0"
                style={{
                  width: `${Math.min(100, fraction * 100)}%`,
                  background: dearer ? 'var(--color-high)' : 'var(--color-low)',
                  opacity: 0.22,
                }}
              />
              <div
                className="settle absolute inset-y-0 w-px"
                style={{
                  left: `${Math.min(100, fraction * 100)}%`,
                  background: dearer ? 'var(--color-high)' : 'var(--color-low)',
                }}
              />
              <div className="relative flex h-full items-center justify-between px-3 text-xs font-semibold">
                <span className="tnum whitespace-nowrap">used {formatIn(low, currency)}</span>
                {/* On a narrow screen the two labels would meet in the middle.
                    The new price is named twice more below, so this is the one
                    to drop. */}
                <span className="tnum hidden whitespace-nowrap text-soft sm:inline">
                  new {formatIn(newPrice, currency)}
                </span>
              </div>
            </div>

            <figcaption className="mt-3 text-soft">
              {gap !== null && gap > 0 ? (
                <span className="font-semibold text-low">{formatIn(gap, currency)} less</span>
              ) : (
                <span className="font-semibold text-high">
                  {formatIn(Math.abs(gap ?? 0), currency)} more
                </span>
              )}{' '}
              than new in {against.market.flag} {against.market.name}
              {match.exact ? (
                ', for the same configuration.'
              ) : (
                <>
                  {' '}
                  — but not for the same machine. These units pin{' '}
                  <span className="text-ink">{match.unpinned.join(' and ')}</span>, which this
                  configuration does not, so read them one at a time below rather than as a
                  saving.
                </>
              )}
            </figcaption>
          </figure>
        )}

        <label className="mt-6 flex flex-wrap items-center gap-2 text-sm">
          <span className="eyebrow">Compared with new in</span>
          <select
            value={against?.market.id ?? ''}
            onChange={(e) => setAgainstId(e.target.value)}
            className="rounded border border-rule bg-paper px-2 py-1 text-sm"
          >
            {priced.map((row, index) => (
              <option key={row.market.id} value={row.market.id}>
                {row.market.flag} {row.market.name} · {formatIn(row.displayAmount!, currency)}
                {index === 0 ? ' — cheapest' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* One row per machine, because that is what is actually for sale. */}
      <table className="mt-8 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-rule text-left">
            <th className="eyebrow py-2 pr-3 font-semibold">Unit</th>
            <th className="eyebrow hidden py-2 pr-3 font-semibold sm:table-cell">Part</th>
            <th className="eyebrow py-2 text-right font-semibold">Price</th>
          </tr>
        </thead>
        <tbody>
          {match.listings.map((listing) => {
            const amount = inDisplay(listing.amount)
            return (
              <tr key={listing.partNumber} className="border-b border-rule/60 align-top">
                <td className="py-2.5 pr-3">
                  <a
                    className="underline decoration-rule underline-offset-4 hover:decoration-ink"
                    href={listing.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {listing.title.replace(/^Refurbished /, '')}
                  </a>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {SPEC_FACETS.filter((f) => listing.dimensions[f]).map((facet) => (
                      <span
                        key={facet}
                        className="rounded-full border border-rule px-1.5 py-0.5 text-[0.625rem] text-soft"
                      >
                        {prettyFacet(listing.dimensions[facet])}
                      </span>
                    ))}
                  </span>
                </td>
                <td className="hidden py-2.5 pr-3 font-mono text-xs text-soft sm:table-cell">
                  {listing.partNumber}
                </td>
                <td className="tnum py-2.5 text-right font-semibold">
                  {amount !== null ? formatIn(amount, currency) : '—'}
                  {currency !== listing.currency && (
                    <span className="block text-xs font-normal text-soft">
                      {formatLocal(listing.amount, listing.currency)}
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <p className="mt-4 text-xs leading-relaxed text-soft">
        Apple's refurbished units are returned or repaired machines that Apple has restored and
        tested. They carry the same one-year warranty as new and are sold only in the market
        that lists them — these are United Kingdom listings, so the comparison above is what a
        UK buyer would choose between{match.exact ? '' : ', spec differences aside'}.
      </p>
    </section>
  )
}

function Heading({ readAt }: { readAt: string | null }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="eyebrow">Second-hand · Apple Certified Refurbished, United Kingdom</h2>
      {readAt && (
        <p className="tnum text-xs text-soft">
          stock read {new Date(readAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
      )}
    </div>
  )
}
