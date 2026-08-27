const CONFIG = `{
  "parity": {
    "type": "http",
    "url": "https://apple-price-tracker.eugnel.com/mcp"
  }
}`

const TOOLS = [
  {
    name: 'list_catalog',
    what: 'Product ids, market ids, currencies, and when prices were collected.',
  },
  {
    name: 'list_product_configurations',
    what: 'Valid builds of one product. Search accepts terms like "M6 24GB 512GB".',
  },
  {
    name: 'compare_prices',
    what: 'One exact configuration across every market, with official source links.',
  },
]

export function Agents() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <a href="/" className="eyebrow hover:text-ink">
        ← Back to prices
      </a>

      <h1 className="mt-6 text-4xl font-bold tracking-tight">Connect an agent</h1>
      <p className="mt-4 max-w-2xl text-lg text-soft">
        Parity speaks MCP, so an assistant can look up prices itself rather than reading the
        page. Everything is read-only and no sign-in is required.
      </p>

      <section className="mt-12">
        <h2 className="eyebrow">Endpoint</h2>
        <p className="mt-2 font-mono text-sm break-all">
          https://apple-price-tracker.eugnel.com/mcp
        </p>
        <p className="mt-2 text-sm text-soft">
          Streamable HTTP, stateless. Add it wherever your client lists MCP servers,
          connectors or integrations.
        </p>

        <pre className="mt-4 overflow-x-auto rounded-lg border border-rule bg-raised p-4 font-mono text-xs">
          {CONFIG}
        </pre>
        <p className="mt-2 text-sm text-soft">
          Client formats vary. Some ask only for a name and a URL.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="eyebrow">Tools</h2>
        <dl className="mt-3 divide-y divide-rule border-y border-rule">
          {TOOLS.map((tool) => (
            <div key={tool.name} className="grid gap-1 py-3 sm:grid-cols-[16rem_1fr] sm:gap-4">
              <dt className="font-mono text-sm">{tool.name}</dt>
              <dd className="text-sm text-soft">{tool.what}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-12">
        <h2 className="eyebrow">What the answers mean</h2>
        <ul className="mt-3 space-y-2 text-sm text-soft">
          <li>
            Prices come back as official local list prices, in each market's own currency.
          </li>
          <li>
            Tool responses apply no exchange-rate conversion and no tax-refund estimate. Those
            appear on the website only, and they are estimates.
          </li>
          <li>
            Every price carries the Apple Store URL it was read from, so an agent can cite or
            re-check it.
          </li>
        </ul>
        <p className="mt-6 text-sm text-soft">
          Without MCP, point the agent at{' '}
          <a className="underline underline-offset-4" href="/llms.txt">
            /llms.txt
          </a>
          .
        </p>
      </section>
    </div>
  )
}
