import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseListingFamilies } from '../src/scrape/discover'
import { FAMILIES } from '../src/shared/families'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

describe('parseListingFamilies', () => {
  const iphone = parseListingFamilies(fixture('apple-uk-buy-iphone.html'), 'iphone')

  it('reads the currently merchandised numbered buy-flow models', () => {
    expect(iphone.map((f) => f.id)).toEqual([
      'iphone-duo',
      'iphone-18-pro',
      'iphone-air',
      'iphone-17',
      'iphone-17e',
      'iphone-16',
    ])
    expect(iphone.find((f) => f.id === 'iphone-18-pro')).toMatchObject({
      name: 'iPhone 18 Pro',
      route: '/shop/buy-iphone/iphone-18-pro',
      categoryId: 'iphone',
    })
    expect(iphone.find((f) => f.id === 'iphone-duo')).toMatchObject({
      name: 'iPhone Duo',
      route: '/shop/buy-iphone/iphone-duo',
    })
  })

  it('does not keep a retired numbered model that is absent from the cards', () => {
    expect(iphone.map((f) => f.id)).not.toContain('iphone-17-pro')
    expect(FAMILIES.map((f) => f.id)).toContain('iphone-17-pro')
  })

  it('ignores carrier-offers and other non-product paths', () => {
    expect(iphone.map((f) => f.id)).not.toContain('carrier-offers')
    expect(iphone.every((f) => f.categoryId === 'iphone')).toBe(true)
  })

  it('marks every iPhone family education-ineligible', () => {
    expect(iphone.every((f) => f.educationPricing === false)).toBe(true)
  })

  it('collapses a SKU-deep card href to the family buy-flow', () => {
    const html = `
      <div class="rf-hcard rf-hcard-40">
        <a href="/uk/shop/buy-watch/apple-watch-ultra/apple-watch-ultra-4-gps-cellular-49mm-titanium-case">
          <div class="rf-hcard-content-title">Apple Watch Ultra 4</div>
        </a>
      </div>`
    expect(parseListingFamilies(html, 'watch')).toEqual([
      {
        id: 'apple-watch-ultra',
        categoryId: 'watch',
        name: 'Apple Watch Ultra',
        route: '/shop/buy-watch/apple-watch-ultra',
      },
    ])
  })

  it('reads goto buy-flow links when a shop index is gone', () => {
    const html = `
      <a href="/uk/shop/goto/buy_airpods/airpods_5">AirPods 5</a>
      <a href="/uk/shop/goto/buy_airpods/airpods_pro_3">AirPods Pro 3</a>
      <a href="/uk/shop/goto/buy_airpods/airpods_max_2">AirPods Max 2</a>
      <a href="/uk/shop/goto/buy_airpods/airpods_5/with_wireless_charging_case">SKU</a>
      <a href="/uk/shop/goto/buy_accessories">Accessories</a>
      <a href="/uk/shop/goto/airpods/accessories">AirPods accessories</a>`
    expect(parseListingFamilies(html, 'airpods').map((f) => f.id)).toEqual([
      'airpods-5',
      'airpods-pro-3',
      'airpods-max-2',
    ])
  })
})
