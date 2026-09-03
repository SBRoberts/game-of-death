import { useEffect, type RefObject } from 'react'

const SELECTOR =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * Modal focus management for an overlay: move focus into the dialog on open,
 * trap Tab within it, and restore focus to the trigger on close. Pass onClose to
 * wire Escape. Scoped to the node so it composes with a component's own hotkeys.
 */
export function useModal(ref: RefObject<HTMLElement | null>, onClose?: () => void): void {
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const prev = document.activeElement as HTMLElement | null
    const focusables = () =>
      Array.from(node.querySelectorAll<HTMLElement>(SELECTOR)).filter((el) => el.offsetParent !== null)
    focusables()[0]?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      } else if (e.key === 'Tab') {
        const f = focusables()
        if (f.length === 0) return
        const first = f[0]
        const last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    node.addEventListener('keydown', onKey)
    return () => {
      node.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [ref, onClose])
}
