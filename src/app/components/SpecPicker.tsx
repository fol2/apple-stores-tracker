import type { Dimension } from '../lib/data'

interface Props {
  dimensions: Dimension[]
  /** The configuration actually being priced, after snapping to a real build. */
  selected: Record<string, string>
  onChange: (field: string, value: string) => void
}

export function SpecPicker({ dimensions, selected, onChange }: Props) {
  if (dimensions.length === 0) {
    return <p className="mt-6 text-sm text-soft">This product comes in one configuration.</p>
  }

  return (
    <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {dimensions.map((dimension) => (
        <fieldset key={dimension.field}>
          <legend className="eyebrow mb-2">{dimension.label}</legend>
          <div className="flex flex-wrap gap-1.5">
            {dimension.values.map((option) => {
              const isSelected = selected[dimension.field] === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onChange(dimension.field, option.value)}
                  className={[
                    'rounded-full border px-3 py-1.5 text-sm transition-colors',
                    isSelected
                      ? 'border-ink bg-ink text-paper'
                      : 'border-rule hover:border-ink/40 hover:bg-raised',
                  ].join(' ')}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </fieldset>
      ))}
    </div>
  )
}
