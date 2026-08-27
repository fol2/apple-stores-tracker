import { useEffect, useMemo, useState } from 'react'
import { compare, displayCurrencies, formatIn, formatLocal } from '../shared/convert'
import { SpreadAxis } from './components/SpreadAxis'
import { MarketTable } from './components/MarketTable'
import { SpecPicker } from './components/SpecPicker'
import { Agents } from './components/Agents'
import { SecondHand } from './components/SecondHand'
import { CurrencyPicker, EducationPicker } from './components/Controls'
import { dimensionsOf, loadSnapshot, offersFor, resolveSelection, type SnapshotResponse } from './lib/data'

const HOME_MARKET = 'uk'
const DEFAULT_FAMILY = 'mac-mini'

export function App() {
  // One extra page does not need a router; it needs one comparison.
  if (window.location.pathname === '/agents') return <Agents />
  return <Prices />
}

function Prices() {
  const [data, setData] = useState<SnapshotResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [familyId, setFamilyId] = useState(DEFAULT_FAMILY)
  const [wanted, setWanted] = useState<Record<string, string>>({})
  const [priority, setPriority] = useState<string[]>([])
  const [showRefunds, setShowRefunds] = useState(false)
  const [currency, setCurrency] = useState('GBP')
  // At most one market: Apple's education store serves that country's students.
  const [educationMarketId, setEducationMarketId] = useState<string | null>(null)
  const [view, setView] = useState<'new' | 'used'>('new')

  useEffect(() => {
    loadSnapshot().then(setData, (e: Error) => setError(e.message))
  }, [])

  const dimensions = useMemo(
    () => (data ? dimensionsOf(data.offers, familyId) : []),
    [data, familyId],
  )

  const resolved = useMemo(
    () => (data ? resolveSelection(data.offers, familyId, wanted, priority, HOME_MARKET) : null),
    [data, familyId, wanted, priority],
  )

  const comparison = useMemo(() => {
    if (!data || !resolved || !data.fx) return null
    return compare(offersFor(data.offers, familyId, resolved.configKey), data.fx, {
      applyRefunds: showRefunds,
      currency,
      educationMarketId,
    })
  }, [data, resolved, familyId, showRefunds, currency, educationMarketId])

  const chooseSpec = (field: string, value: string) => {
    setWanted((current) => ({ ...current, [field]: value }))
    // Most recent choice wins when options conflict, so it leads the priority.
    setPriority((current) => [field, ...current.filter((f) => f !== field)])
  }

  const chooseFamily = (id: string) => {
    setFamilyId(id)
    setWanted({})
    setPriority([])
  }

  if (error) {
    return (
      <Shell>
        <p className="mt-16 text-lg">{error}</p>
        <p className="mt-2 text-soft">
          Prices are collected on a schedule. Try again in a few minutes.
        </p>
      </Shell>
    )
  }

  if (!data) {
    return (
      <Shell>
        <p className="mt-16 text-soft">Loading prices…</p>
      </Shell>
    )
  }

  // Data arrived but yielded nothing to show. Saying so beats an eternal
  // "Loading", which is indistinguishable from a hung request.
  if (!resolved || !comparison) {
    return (
      <Shell
        categories={data.categories}
        families={data.families}
        familyId={familyId}
        onFamily={chooseFamily}
      >
        <p className="mt-16 text-lg">No prices for this product yet.</p>
        <p className="mt-2 text-soft">
          {data.fx
            ? 'The last collection did not reach it. Try another product, or check back after the next run.'
            : 'Exchange rates are unavailable, so prices cannot be converted yet.'}
        </p>
      </Shell>
    )
  }

  const family = data.families.find((f) => f.id === familyId)

  /**
   * A picker that visibly does nothing is worse than one that is absent. When
   * a market is claimed but no education row appears, say which of the two
   * reasons applies rather than leaving the reader to wonder whether they
   * mis-clicked.
   */
  const educationNote = (() => {
    if (!educationMarketId) return null
    if (comparison.rows.some((r) => r.isEducation)) return null
    const collected = data.offers.some((o) => o.store === 'education')
    if (!collected) return 'Education prices have not been collected yet. They appear after the next full run.'
    const marketHasAny = data.offers.some(
      (o) => o.store === 'education' && o.marketId === educationMarketId,
    )
    if (!marketHasAny) return 'No education prices collected for this market yet.'
    return 'Apple has no education price for this product.'
  })()
  const cheapest = comparison.cheapest
  const home = comparison.rows.find((r) => r.market.id === HOME_MARKET)
  const saving =
    home?.displayAmount != null && cheapest?.displayAmount != null
      ? home.displayAmount - cheapest.displayAmount
      : null

  return (
    <Shell
      categories={data.categories}
      families={data.families}
      familyId={familyId}
      onFamily={chooseFamily}
    >
      <section className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{family?.name}</h1>
            <p className="mt-2 max-w-xl text-soft">
              {resolved.dimensions.map((d) => d.label).join(' · ') || 'One configuration'}
            </p>
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={showRefunds}
              onChange={(e) => setShowRefunds(e.target.checked)}
              className="size-4 accent-[var(--color-low)]"
            />
            Estimate tourist tax refunds
          </label>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-3 border-y border-rule py-3">
          <CurrencyPicker
            currency={currency}
            currencies={displayCurrencies(data.fx!)}
            onChange={setCurrency}
          />
          <EducationPicker
            markets={data.markets}
            educationMarketId={educationMarketId}
            onChange={setEducationMarketId}
          />

          {educationNote && (
            <p className="w-full text-xs text-soft sm:w-auto">{educationNote}</p>
          )}
        </div>

        <SpecPicker dimensions={dimensions} selected={selectionOf(resolved)} onChange={chooseSpec} />
      </section>

      {/* Two ways to buy the same machine, so two views of one configuration.
          The pickers above belong to both and stay put across the switch. */}
      <div className="mt-10 flex gap-1 border-b border-rule" role="tablist">
        {(
          [
            ['new', 'New, 15 markets'],
            ['used', 'Second-hand, UK'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={[
              '-mb-px border-b-2 px-3 py-2 text-sm',
              view === id
                ? 'border-ink font-semibold'
                : 'border-transparent text-soft hover:text-ink',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'used' ? (
        <SecondHand
          offer={comparison.rows.find((r) => r.offer)?.offer}
          listings={data.refurb?.listings ?? []}
          failedCategories={(data.refurb?.errors ?? []).map((e) => e.category)}
          familyId={familyId}
          readAt={data.refurb?.collectedAt ?? null}
          rows={comparison.rows}
          currency={currency}
          fx={data.fx!}
          familyName={family?.name ?? 'product'}
        />
      ) : (
        <>
      {/* The headline answer, stated once and in full. */}
      <section className="mt-12 rounded-lg border border-rule bg-raised p-6 sm:p-8">
        <p className="eyebrow">Cheapest market</p>

        {cheapest?.displayAmount != null ? (
          <>
            <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-2">
              <span className="font-mono text-4xl font-bold tracking-[-0.06em] sm:text-6xl">
                {formatIn(cheapest.displayAmount, currency)}
              </span>
              <span className="text-xl">
                {cheapest.market.flag} {cheapest.market.name}
              </span>
              {cheapest.isEducation && (
                <span className="rounded-full border border-low/50 px-2 py-0.5 text-xs text-low">
                  education price
                </span>
              )}
            </div>

            <p className="mt-3 text-soft">
              {cheapest.offer && (
                <>
                  Listed at{' '}
                  <span className="tnum text-ink">
                    {formatLocal(
                      cheapest.localAmount ?? cheapest.offer.amount,
                      cheapest.offer.currency,
                    )}
                  </span>
                  {showRefunds && cheapest.policy.available && ' after an estimated refund'}.{' '}
                </>
              )}
              {saving === null
                ? 'Apple does not list this configuration in the United Kingdom.'
                : saving > 0
                  ? (
                      <>
                        That is{' '}
                        <span className="font-semibold text-low">
                          {formatIn(saving, currency)} less
                        </span>{' '}
                        than the United Kingdom.
                      </>
                    )
                  : 'The United Kingdom is already the cheapest market for this build.'}
            </p>

            {cheapest.market.pricesExcludeTax && (
              <p className="mt-3 rounded border border-high/40 bg-high/[0.07] px-3 py-2 text-sm">
                {cheapest.market.name} prices exclude sales tax. It is added at checkout and set
                locally, from nothing in a few states to over 10% elsewhere, so the amount you
                pay depends on where you buy.
              </p>
            )}

            <SpreadAxis rows={comparison.rows} homeMarketId={HOME_MARKET} currency={currency} />
          </>
        ) : (
          <p className="mt-3 text-soft">No market lists a price for this configuration.</p>
        )}
      </section>

      <section className="mt-12">
        <h2 className="eyebrow mb-3">All markets</h2>
        <MarketTable
          rows={comparison.rows}
          homeMarketId={HOME_MARKET}
          showRefunds={showRefunds}
          currency={currency}
        />
      </section>
        </>
      )}

      <Footnotes data={data} covered={comparison.covered} />
    </Shell>
  )
}

const selectionOf = (resolved: { dimensions: { field: string; value: string }[] }) =>
  Object.fromEntries(resolved.dimensions.map((d) => [d.field, d.value]))

interface ShellProps {
  children: React.ReactNode
  categories?: SnapshotResponse['categories']
  families?: SnapshotResponse['families']
  familyId?: string
  onFamily?: (id: string) => void
}

function Shell({ children, categories, families, familyId, onFamily }: ShellProps) {
  const category = families?.find((f) => f.id === familyId)?.categoryId

  return (
    <div className="min-h-svh">
      <header className="sticky top-0 z-10 border-b border-rule bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
          <a href="/" className="font-mono text-sm font-bold tracking-tight">
            PARITY
          </a>
          <p className="text-xs text-soft">Apple prices, market by market</p>

          {categories && (
            <nav className="ml-auto flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {categories.map((c) => {
                const first = families?.find((f) => f.categoryId === c.id)
                if (!first) return null
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onFamily?.(first.id)}
                    className={
                      c.id === category
                        ? 'font-semibold underline decoration-2 underline-offset-4'
                        : 'text-soft hover:text-ink'
                    }
                  >
                    {c.label}
                  </button>
                )
              })}
            </nav>
          )}
        </div>

        {families && category && (
          <div className="border-t border-rule/60">
            <div className="mx-auto flex max-w-5xl flex-wrap gap-x-4 gap-y-1 px-5 py-2 text-sm">
              {families
                .filter((f) => f.categoryId === category)
                .map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => onFamily?.(f.id)}
                    className={f.id === familyId ? 'font-semibold' : 'text-soft hover:text-ink'}
                  >
                    {f.name}
                  </button>
                ))}
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-5xl px-5 pb-24">{children}</main>
    </div>
  )
}

function Footnotes({ data, covered }: { data: SnapshotResponse; covered: number }) {
  const collected = new Date(data.collectedAt)
  return (
    <footer className="mt-16 border-t border-rule pt-6 text-xs leading-relaxed text-soft">
      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="eyebrow">Prices collected</dt>
          <dd className="tnum mt-1">
            {collected.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
          </dd>
        </div>
        <div>
          <dt className="eyebrow">Exchange rates</dt>
          <dd className="tnum mt-1">
            {data.fx
              ? `${new Date(data.fx.fetchedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })} · open.er-api.com`
              : 'unavailable'}
          </dd>
        </div>
        <div>
          <dt className="eyebrow">Markets priced</dt>
          <dd className="tnum mt-1">
            {covered} of {data.markets.length}
          </dd>
        </div>
      </dl>

      <p className="mt-6 max-w-3xl">
        Prices are official Apple Online Store list prices, read from Apple's own regional
        product selectors. US prices exclude sales tax, which is added at checkout. Warranty
        terms, keyboard layouts, plug types and stock differ by market, and buying abroad may
        attract import duty on the way home.
      </p>

      <p className="mt-4 max-w-3xl">
        Tax-refund figures are estimates for visitors buying in person, not quotes: schemes
        carry minimum spends, departure deadlines and operator fees. Most are voluntary for the
        retailer, so what matters is whether Apple's own stores run them — Japan has a
        well-known tax-free system that Apple withdrew from. A refund marked{' '}
        <span className="text-soft">?</span> means the country runs a scheme but Apple's
        participation is unverified.
      </p>

      <p className="mt-4">
        Independent and not affiliated with Apple. Apple, Mac, iPhone and iPad are trademarks
        of Apple Inc. ·{' '}
        <a className="underline underline-offset-4" href="/agents">
          Connect an agent
        </a>{' '}
        ·{' '}
        <a className="underline underline-offset-4" href="/llms.txt">
          llms.txt
        </a>
      </p>
    </footer>
  )
}
