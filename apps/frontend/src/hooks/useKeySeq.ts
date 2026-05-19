import { useEffect } from 'react'

export function useKeySeq(sequence: string, onMatch: () => void): void {
  useEffect(() => {
    const buf: string[] = []
    const seq = sequence.toLowerCase()

    const handle = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )
        return
      if (e.key.length !== 1) return

      buf.push(e.key.toLowerCase())
      if (buf.length > seq.length) buf.shift()
      if (buf.join('') === seq) {
        onMatch()
        buf.length = 0
      }
    }

    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [sequence, onMatch])
}
