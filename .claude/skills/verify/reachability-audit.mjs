import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const OUT = process.env.OUT
const BASE = 'http://localhost:5173/game-of-death/'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = []
const say = (s) => { console.log(s); log.push(s) }

const SIZES = [
  { name: 'desktop-1440x900', w: 1440, h: 900 },
  { name: 'laptop-1280x800', w: 1280, h: 800 },
  { name: 'small-1024x700', w: 1024, h: 700 },
  { name: 'short-1280x620', w: 1280, h: 620 },
  { name: 'ultrawide-2560x900', w: 2560, h: 900 },
  { name: 'phone-land-844x390', w: 844, h: 390 },
  { name: 'phone-port-390x844', w: 390, h: 844 },
]

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
})

// Report any element whose content overflows its own box without a scroller,
// and anything sticking outside the viewport.
// Distinguish "below the fold but scrollable to" (fine) from "unreachable"
// (broken). The question a player cares about is whether they can get to it.
const AUDIT = `(() => {
  const vw = innerWidth, vh = innerHeight
  const problems = []
  const scrolls = (el) => {
    const s = getComputedStyle(el)
    const oy = /auto|scroll/.test(s.overflowY) && el.scrollHeight - el.clientHeight > 2
    const ox = /auto|scroll/.test(s.overflowX) && el.scrollWidth - el.clientWidth > 2
    return oy || ox
  }
  const reachable = (el) => {
    for (let n = el.parentElement; n; n = n.parentElement) if (scrolls(n)) return true
    const d = document.scrollingElement
    return d.scrollHeight - d.clientHeight > 2 || d.scrollWidth - d.clientWidth > 2
  }
  const named = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0,3).join('.') : '')
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.sr-only')) continue          // deliberately clipped for screen readers
    // Decorative layers (grain, vignette, scanlines) are deliberately oversized
    // so they can drift without showing an edge. They carry nothing to reach.
    if (el.getAttribute('aria-hidden') === 'true' && !el.querySelector('button, a, input')) continue
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const clipsY = el.scrollHeight - el.clientHeight > 2
    const clipsX = el.scrollWidth - el.clientWidth > 2
    // Only a clip that hides something a player needs counts. An oversized
    // decorative layer under overflow:hidden is doing its job, not failing.
    const hidesContent = () => {
      const box = el.getBoundingClientRect()
      for (const d of el.querySelectorAll('button, a, input, select, [role=button], [role=radio], p, li, td, h1, h2, h3, span, div')) {
        if (d.getAttribute('aria-hidden') === 'true' || d.closest('[aria-hidden=true]')) continue
        if (!d.matches('button, a, input, select, [role=button], [role=radio]') && !(d.textContent || '').trim()) continue
        const dr = d.getBoundingClientRect()
        if (dr.height === 0 || dr.width === 0) continue
        if (dr.bottom > box.bottom + 2 || dr.right > box.right + 2) return true
      }
      return false
    }
    if ((clipsY || clipsX) && !scrolls(el) && s.overflow !== 'visible' && !reachable(el) && hidesContent()) {
      problems.push({ kind: 'clipped', el: named(el), axis: clipsY ? 'y' : 'x',
        over: clipsY ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth })
    }
    if (el.matches('button, a, input, select, [role=button], [role=radio], [tabindex]')) {
      const out = r.bottom > vh + 1 || r.top < -1 || r.right > vw + 1 || r.left < -1
      if (out) {
        problems.push({ kind: reachable(el) ? 'needs-scroll' : 'UNREACHABLE', el: named(el),
          box: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
          text: (el.textContent || '').trim().slice(0, 30) })
      }
      if (r.width < 24 || r.height < 24) {
        problems.push({ kind: 'tiny-target', el: named(el), size: [Math.round(r.width), Math.round(r.height)],
          text: (el.textContent || '').trim().slice(0, 24) })
      }
    }
  }
  return { vw, vh, problems }
})()`

const open = {
  async howto(page) {
    await page.evaluate(() => [...document.querySelectorAll('.title-btn')].find((b) => b.textContent.includes('HOW TO'))?.click())
  },
  async game(page) {
    await page.evaluate(() => [...document.querySelectorAll('.title-btn')].find((b) => b.textContent.includes('START'))?.click())
    await sleep(900)
  },
  async genome(page) {
    await open.game(page)
    await page.evaluate(() => document.querySelector('.ash-readout, .genome-plate')?.click())
  },
  async settings(page) {
    await open.game(page)
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').includes('settings'))?.click())
  },
  async chest(page) {
    await open.game(page)
    await page.keyboard.press('b'); await sleep(200)
    await page.keyboard.press('c'); await sleep(300)
  },
  async cashout(page) {
    await open.game(page)
    await page.keyboard.press('v'); await sleep(1800)
  },
  async shop(page) {
    await open.game(page)
    await page.keyboard.press('b'); await page.keyboard.press('v'); await sleep(2000)
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('SHOP'))?.click())
    await sleep(500)
  },
  async duel(page) { await open.game(page) },
}

const results = {}
for (const size of SIZES) {
  for (const [scene, go] of Object.entries(open)) {
    if (scene === 'game') continue
    const page = await browser.newPage()
    await page.setViewport({ width: size.w, height: size.h })
    const errs = []
    page.on('pageerror', (e) => errs.push(e.message))
    await page.goto(`${BASE}?seed=audit&debug`, { waitUntil: 'networkidle2' })
    await sleep(900)
    try { await go(page) } catch { /* scene unreachable */ }
    await sleep(700)
    const r = await page.evaluate(AUDIT)
    const key = `${size.name} · ${scene}`
    results[key] = r
    if (r.problems.length || r.docScrollY > 0) {
      await page.screenshot({ path: `${OUT}/${size.name}--${scene}.png` })
    }
    await page.close()
  }
}

let hard = 0
for (const [key, r] of Object.entries(results)) {
  const clipped = r.problems.filter((p) => p.kind === 'clipped')
  const un = r.problems.filter((p) => p.kind === 'UNREACHABLE')
  const ns = r.problems.filter((p) => p.kind === 'needs-scroll')
  const tiny = [...new Map(r.problems.filter((p) => p.kind === 'tiny-target').map((p) => [p.el + p.text, p])).values()]
  if (!clipped.length && !un.length && !tiny.length && !ns.length) continue
  say(`\n### ${key}`)
  for (const p of clipped.slice(0, 6)) { hard++; say(`  CLIPPED     ${p.el} ${p.axis} by ${p.over}px — cut off, nothing scrolls`) }
  for (const p of un.slice(0, 8)) { hard++; say(`  UNREACHABLE ${p.el} "${p.text}" box=${p.box.join(',')}`) }
  if (ns.length) say(`  (needs-scroll: ${ns.length} control(s) below the fold but scrollable to — ok)`)
  for (const p of tiny.slice(0, 6)) say(`  TINY        ${p.el} "${p.text}" ${p.size.join('×')}px`)
}
say(`\nHARD FAILURES: ${hard}`)
fs.writeFileSync(`${OUT}/audit.log`, log.join('\n'))
say(`\n(${Object.keys(results).length} scene/size combinations checked)`)
await browser.close()
