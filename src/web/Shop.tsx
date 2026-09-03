import { useRef } from 'react'
import type { ShopItem } from '../sim'
import { useModal } from './useModal'

const RARITY: Record<ShopItem['rarity'], { c: string; label: string }> = {
  common: { c: '#9db2d0', label: 'COMMON' },
  uncommon: { c: '#8affc4', label: 'UNCOMMON' },
  rare: { c: '#6ea8ff', label: 'RARE' },
  epic: { c: '#c46bff', label: 'EPIC' },
  legendary: { c: '#ffd84a', label: 'LEGENDARY' },
}

interface ShopProps {
  stock: ShopItem[]
  plasm: number
  rerollCost: number
  /** Next round's warp cap — items warpier than this are bought dormant. */
  nextCap: number
  bought: Set<string>
  nextRoundLabel: string
  round: number
  onBuy: (item: ShopItem) => void
  onReroll: () => void
  onContinue: () => void
}

/**
 * The between-round shop: spend harvested PLASM to choose what strays into your
 * strain next round. Rarity odds climb toward the wild as the gauntlet deepens.
 */
export function Shop({
  stock,
  plasm,
  rerollCost,
  nextCap,
  bought,
  nextRoundLabel,
  round,
  onBuy,
  onReroll,
  onContinue,
}: ShopProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  useModal(rootRef) // focus in, trap Tab, restore on close

  return (
    <div className="shop" ref={rootRef} role="dialog" aria-modal="true" aria-label="between-round shop">
      <div className="shop-head">
        <span className="shop-title">THE CULTURE · SHOP</span>
        <span className="shop-plasm" aria-label={`${plasm} plasm`}>
          ◈ <span className="num">{plasm}</span> PLASM
        </span>
      </div>
      <p className="shop-sub">Splice mutagens for the run — rarer strains stray further from Conway.</p>

      <div className="shop-stock">
        {stock.map((it) => {
          const sold = bought.has(it.key)
          const afford = plasm >= it.price
          const dormant = it.warp > nextCap
          return (
            <button
              key={it.key}
              className={`shop-item ${sold ? 'sold' : ''} ${!afford && !sold ? 'poor' : ''}`}
              style={{ ['--r' as string]: RARITY[it.rarity].c }}
              disabled={sold || !afford}
              onClick={() => onBuy(it)}
              aria-label={`${it.name}, ${RARITY[it.rarity].label}, ${it.price} plasm. ${it.desc} ${
                dormant ? 'Activates a later round.' : ''
              } ${sold ? 'Bought.' : !afford ? 'Not enough plasm.' : ''}`}
            >
              <span className="si-top">
                <span className="si-rarity">{RARITY[it.rarity].label}</span>
                <span className="si-price num">◈ {it.price}</span>
              </span>
              <span className="si-name">{it.name}</span>
              <span className="si-desc">{it.desc}</span>
              <span className="si-foot">
                {it.warp > 0 && <span className="si-warp">⌁ +{it.warp}</span>}
                {dormant && <span className="si-dormant">activates later</span>}
              </span>
              {sold && <span className="si-sold">SPLICED ✓</span>}
            </button>
          )
        })}
      </div>

      <div className="shop-actions">
        <button
          className="shop-reroll"
          disabled={plasm < rerollCost}
          onClick={onReroll}
          aria-label={`reroll the stock for ${rerollCost} plasm`}
        >
          ↻ reroll <span className="num">◈ {rerollCost}</span>
        </button>
        <button className="shop-continue" onClick={onContinue}>
          BEGIN ROUND {round} · {nextRoundLabel} →
        </button>
      </div>
    </div>
  )
}
