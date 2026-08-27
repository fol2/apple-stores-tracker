import { useEffect, useMemo, useState } from 'react'
import { compare, formatBase } from '../shared/convert'
import { SpreadAxis } from './components/SpreadAxis'
import { MarketTable } from './components/MarketTable'
import { SpecPicker } from './components/SpecPicker'
import { Agents } from './components/Agents'
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
    })
  }, [data, resolved, familyId, showRefunds])

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

  if (!data || !comparison || !resolved) {
    return (
      <Shell>
        <p className="mt-16 text-soft">Loading prices…</p>
      </Shell>
    )
  }

  const family = data.families.find((f) => f.id === familyId)
  const cheapest = comparison.cheapest
  const home = comparison.rows.find((r) => r.market.id === HOME_MARKET)
  const saving =
    home?.baseAmount != null && cheapest?.baseAmount != null
      ? home.baseAmount - cheapest.baseAmount
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

        <SpecPicker dimensions={dimensions} selected={selectionOf(resolved)} onChange={chooseSpec} />
      </section>

      {/* The headline answer, stated once and in full. */}
      <section className="mt-12 rounded-lg border border-rule bg-raised p-6 sm:p-8">
        <p className="eyebrow">Cheapest market</p>

        {cheapest?.baseAmount != null ? (
          <>
            <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-2">
              <span className="font-mono text-4xl font-bold tracking-[-0.06em] sm:text-6xl">
                {formatBase(cheapest.baseAmount)}
              </span>
              <span className="text-xl">
                {cheapest.market.flag} {cheapest.market.name}
              </span>
            </div>

            <p className="mt-3 text-soft">
              {cheapest.offer && (
                <>
                  Listed at{' '}
                  <span className="tnum text-ink">
                    {new Intl.NumberFormat('en-GB', {
                      style: 'currency',
                      currency: cheapest.offer.currency,
                    }).format(cheapest.localAmount ?? cheapest.offer.amount)}
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
                        <span className="font-semibold text-low">{formatBase(saving)} less</span>{' '}
                        than the United Kingdom.
                      </>
                    )
                  : 'The United Kingdom is already the cheapest market for this build.'}
            </p>

            <SpreadAxis rows={comparison.rows} homeMarketId={HOME_MARKET} />
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
        />
      </section>

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
              ? `${new Date(data.fx.fetchedAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })} · open.er-api.com`
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
        product selectors. US prices exclude sales tax, which is added at checkout. Tax-refund
        figures are estimates for visitors, not quotes: schemes carry minimum spends, departure
        deadlines and operator fees. Warranty terms, keyboard layouts, plug types and stock
        differ by market, and buying abroad may attract import duty on the way home.
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
