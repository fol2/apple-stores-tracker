import { type Family } from '../shared/families'

/**
 * Apple's shop category slug → our category id.
 *
 * TV & Home is split across `buy-tv` and `buy-homepod` on the store, and both
 * map here. Anything else (`buy_accessories`, a nav index with no family) is
 * not a family.
 */
const SHOP_TO_CATEGORY: Record<string, string> = {
  mac: 'mac',
  ipad: 'ipad',
  iphone: 'iphone',
  watch: 'watch',
  vision: 'vision',
  airpods: 'airpods',
  homepod: 'tv-home',
  tv: 'tv-home',
}

/** Paths that sit next to buy-flow families but are not a product. */
const FURNITURE = new Set([
  'carrier-offers',
  'accessories',
  'compare',
  'gift-cards',
  'financing',
  'trade-in',
  'browse',
  'shop',
])

const TOKEN_NAME: Record<string, string> = {
  macbook: 'MacBook',
  mac: 'Mac',
  mini: 'mini',
  imac: 'iMac',
  ipad: 'iPad',
  iphone: 'iPhone',
  airpods: 'AirPods',
  homepod: 'HomePod',
  apple: 'Apple',
  watch: 'Watch',
  hermes: 'Hermès',
  se: 'SE',
  xdr: 'XDR',
  tv: 'TV',
  '4k': '4K',
  pro: 'Pro',
  air: 'Air',
  max: 'Max',
  neo: 'Neo',
  studio: 'Studio',
  display: 'Display',
  ultra: 'Ultra',
  vision: 'Vision',
  duo: 'Duo',
}

const nameFromSlug = (id: string): string =>
  id
    .split('-')
    .map((part) => {
      if (TOKEN_NAME[part]) return TOKEN_NAME[part]
      if (/^\d/.test(part)) return part
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(' ')

const familyOf = (shop: string, slug: string): Family | null => {
  const categoryId = SHOP_TO_CATEGORY[shop]
  if (!categoryId || FURNITURE.has(slug)) return null
  const family: Family = {
    id: slug,
    categoryId,
    name: nameFromSlug(slug),
    route: `/shop/buy-${shop}/${slug}`,
  }
  if (categoryId === 'iphone') family.educationPricing = false
  return family
}

/**
 * Family-level buy-flow and goto links.
 *
 * A card often links at a SKU (`.../apple-watch-ultra/apple-watch-ultra-4-…`);
 * the family is the first slug after the shop category, never the rest.
 */
const BUY_PATH =
  /(?:https:\/\/www\.apple\.com)?(?:\/[a-z]{2}(?:-edu)?)?\/shop\/buy-([a-z0-9-]+)\/([a-z0-9-]+)/gi
const GOTO_PATH = /\/shop\/goto\/buy_([a-z0-9_]+)\/([a-z0-9_]+)/gi

function familiesFromLinks(html: string, categoryId: string): Family[] {
  const found: Family[] = []
  const seen = new Set<string>()
  const add = (shop: string, slug: string) => {
    const family = familyOf(shop.replace(/_/g, '-'), slug.replace(/_/g, '-'))
    if (!family || family.categoryId !== categoryId || seen.has(family.id)) return
    seen.add(family.id)
    found.push(family)
  }
  for (const match of html.matchAll(BUY_PATH)) add(match[1], match[2])
  for (const match of html.matchAll(GOTO_PATH)) add(match[1], match[2])
  return found
}

/**
 * Product tiles on a shop category index (`rf-hcard`). Prefer these over a
 * page-wide link scrape: the same HTML also carries footer leftovers
 * (`ipad-10-2`) and furniture (`carrier-offers`).
 *
 * Only the card's own buy-flow href counts — a wide window would swallow the
 * footer of a short listing.
 */
function familiesFromCards(html: string, categoryId: string): Family[] {
  const found: Family[] = []
  const seen = new Set<string>()
  const cards = /class="rf-hcard(?:\s|")[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/gi
  for (const match of html.matchAll(cards)) {
    for (const family of familiesFromLinks(match[1], categoryId)) {
      if (seen.has(family.id)) continue
      seen.add(family.id)
      found.push(family)
    }
  }
  return found
}

/**
 * Current buy-flow families listed on one Apple category (or marketing) page.
 *
 * Pure HTML → families. Collection fetches the page; tests drive this with
 * fixtures. A family Apple no longer merchandises on the listing is absent,
 * which is how a retired numbered model leaves the catalogue.
 */
export function parseListingFamilies(html: string, categoryId: string): Family[] {
  const fromCards = familiesFromCards(html, categoryId)
  return fromCards.length > 0 ? fromCards : familiesFromLinks(html, categoryId)
}
