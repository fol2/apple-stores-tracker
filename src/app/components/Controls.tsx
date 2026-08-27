import type { Market } from '../../shared/markets'

/**
 * Currencies kept one click away.
 *
 * A pinned pair covers the common case of weighing one home market against
 * another; everything else stays reachable but out of the way, so the control
 * does not become a wall of thirteen identical buttons.
 */
export const PINNED_CURRENCIES = ['GBP', 'HKD']

interface CurrencyProps {
  currency: string
  currencies: string[]
  onChange: (currency: string) => void
}

export function CurrencyPicker({ currency, currencies, onChange }: CurrencyProps) {
  const rest = currencies.filter((c) => !PINNED_CURRENCIES.includes(c))

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="eyebrow mr-1">Show prices in</span>

      {PINNED_CURRENCIES.filter((c) => currencies.includes(c)).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={currency === option}
          onClick={() => onChange(option)}
          className={[
            'rounded-full border px-3 py-1 font-mono text-xs transition-colors',
            currency === option
              ? 'border-ink bg-ink text-paper'
              : 'border-rule hover:border-ink/40 hover:bg-raised',
          ].join(' ')}
        >
          {option}
        </button>
      ))}

      <select
        // Shows the current choice only when it is not one of the pinned two,
        // so the buttons and the menu never both look selected.
        value={rest.includes(currency) ? currency : ''}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className={[
          'cursor-pointer rounded-full border px-2.5 py-1 font-mono text-xs transition-colors',
          rest.includes(currency)
            ? 'border-ink bg-ink text-paper'
            : 'border-rule hover:border-ink/40',
        ].join(' ')}
      >
        <option value="">More…</option>
        {rest.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  )
}

interface EducationProps {
  markets: Market[]
  educationMarketId: string | null
  onChange: (marketId: string | null) => void
}

export function EducationPicker({ markets, educationMarketId, onChange }: EducationProps) {
  return (
    <label className="flex flex-wrap items-center gap-2">
      <span className="eyebrow">Education pricing</span>
      <select
        value={educationMarketId ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className={[
          'cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors',
          educationMarketId ? 'border-low bg-low/10 text-low' : 'border-rule hover:border-ink/40',
        ].join(' ')}
      >
        <option value="">Not a student</option>
        {markets.map((market) => (
          <option key={market.id} value={market.id}>
            {market.flag} {market.name}
          </option>
        ))}
      </select>
    </label>
  )
}
