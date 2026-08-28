import { readFileSync } from 'node:fs'
import { extractJsonAfter } from '../src/scrape/apple'
const dir = process.argv[2]
for (const f of ['macbook-pro', 'macbook-air', 'imac', 'mac-mini', 'macbook-neo']) {
  const data: any = extractJsonAfter(readFileSync(`${dir}/sel-${f}.html`, 'utf8'), 'productSelectionData:')
  console.log('\n===', f, '| cto:', Array.isArray(data.configSections))
  for (const s of data.configSections ?? []) {
    const vals = data.configDisplayValues?.[s.formFieldName]
    const keys = vals ? Object.keys(vals).filter((k) => k !== 'variantOrder') : []
    console.log('  ', String(s.formFieldName).padEnd(28), 'priceDelta=' + s.priceDelta, 'values=' + keys.length, keys.slice(0, 5).join(','))
  }
}
