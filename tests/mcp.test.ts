import { describe, expect, it } from 'vitest'
import { handleMcp } from '../src/worker/mcp'
import type { Offer, Snapshot } from '../src/shared/types'

const offer = (marketId: string, currency: string, amount: number): Offer => ({
  marketId,
  familyId: 'mac-mini',
  store: 'retail',
  configKey: 'memory-dimensionMemory=24gb|storage-dimensionCapacity=512gb',
  dimensions: [
    { field: 'memory-dimensionMemory', value: '24gb', label: '24GB' },
    { field: 'storage-dimensionCapacity', value: '512gb', label: '512GB' },
  ],
  amount,
  currency,
  partNumber: null,
  sourceUrl: 'https://www.apple.com/shop/buy-mac/mac-mini',
})

const base: Offer = {
  ...offer('uk', 'GBP', 899),
  configKey: 'memory-dimensionMemory=16gb|storage-dimensionCapacity=256gb',
  dimensions: [
    { field: 'memory-dimensionMemory', value: '16gb', label: '16GB' },
    { field: 'storage-dimensionCapacity', value: '256gb', label: '256GB' },
  ],
}

const snapshot: Snapshot = {
  collectedAt: '2026-08-27T12:00:00.000Z',
  markets: ['uk', 'us'],
  offers: [offer('uk', 'GBP', 1299), offer('us', 'USD', 1299), base],
  errors: [],
}

const call = async (body: unknown, data: Snapshot | null = snapshot) =>
  (await handleMcp(
    new Request('https://example.com/mcp', { method: 'POST', body: JSON.stringify(body) }),
    data,
  ).then((r) => r.json())) as any

const toolResult = (response: any) => JSON.parse(response.result.content[0].text)

describe('MCP transport', () => {
  it('rejects GET, since this endpoint is stateless request/response', async () => {
    const response = await handleMcp(new Request('https://example.com/mcp'), snapshot)
    expect(response.status).toBe(405)
  })

  it('reports its protocol version and tool capability', async () => {
    const response = await call({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    expect(response.result.capabilities.tools).toBeDefined()
    expect(response.result.serverInfo.name).toBe('apple-price-tracker')
  })

  it('lists the three read-only tools', async () => {
    const response = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect(response.result.tools.map((t: any) => t.name)).toEqual([
      'list_catalog',
      'list_product_configurations',
      'compare_prices',
    ])
  })

  it('answers an unknown method with a JSON-RPC error', async () => {
    const response = await call({ jsonrpc: '2.0', id: 3, method: 'resources/list' })
    expect(response.error.code).toBe(-32601)
  })

  it('acknowledges notifications without a body', async () => {
    const response = await handleMcp(
      new Request('https://example.com/mcp', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      }),
      snapshot,
    )
    expect(response.status).toBe(202)
  })
})

describe('MCP tools', () => {
  it('lists the catalogue with collection metadata', async () => {
    const result = toolResult(
      await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_catalog' } }),
    )
    expect(result.collectedAt).toBe(snapshot.collectedAt)
    expect(result.offerCount).toBe(3)
  })

  it('deduplicates configurations across markets', async () => {
    const result = toolResult(
      await call({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'list_product_configurations', arguments: { product_id: 'mac-mini' } },
      }),
    )
    // Three offers, but only two distinct builds.
    expect(result.matched).toBe(2)
  })

  it('narrows configurations by search terms', async () => {
    const result = toolResult(
      await call({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'list_product_configurations',
          arguments: { product_id: 'mac-mini', query: '24GB 512GB' },
        },
      }),
    )
    expect(result.matched).toBe(1)
    expect(result.configurations[0].description).toBe('24GB / 512GB')
  })

  it('compares one configuration across markets', async () => {
    const result = toolResult(
      await call({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'compare_prices',
          arguments: { product_id: 'mac-mini', query: '24GB 512GB' },
        },
      }),
    )
    expect(result.prices).toHaveLength(2)
    expect(result.prices.map((p: any) => p.currency).sort()).toEqual(['GBP', 'USD'])
  })

  it('asks for a narrower query instead of guessing between builds', async () => {
    const result = toolResult(
      await call({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'compare_prices', arguments: { product_id: 'mac-mini' } },
      }),
    )
    expect(result.ambiguous).toBe(true)
    expect(result.candidates).toHaveLength(2)
  })

  it('returns a tool error, not a protocol error, when there is no data', async () => {
    const response = await call(
      { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'list_catalog' } },
      null,
    )
    expect(response.result.isError).toBe(true)
    expect(response.error).toBeUndefined()
  })
})
