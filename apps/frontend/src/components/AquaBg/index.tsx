import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import sardineSvg from '../../../../../assets/avatars/bot-avatar.svg'
import './sp_bck.css'

const FISH_COUNT = 14
const BUBBLE_COUNT = 40

function rng(seed: number) {
  const x = Math.sin(seed + 1) * 10000
  return x - Math.floor(x)
}

interface FishCfg {
  id: number
  y: number
  size: number
  dur: number
  delay: number
  rtl: boolean
  bob: number
}

interface BubbleCfg {
  id: number
  x: number
  size: number
  dur: number
  delay: number
}

export function AquaBg({ active }: { active: boolean }) {
  const [target, setTarget] = useState<Element | null>(null)

  useEffect(() => {
    if (active) {
      document.body.classList.add('sp-bck')
      setTarget(document.querySelector('.pf-v6-c-page__main-container'))
    } else {
      document.body.classList.remove('sp-bck')
      setTarget(null)
    }
    return () => document.body.classList.remove('sp-bck')
  }, [active])

  const fish = useMemo<FishCfg[]>(
    () =>
      Array.from({ length: FISH_COUNT }, (_, i) => ({
        id: i,
        y: 8 + rng(i * 11 + 1) * 72,
        size: 26 + rng(i * 11 + 2) * 28,
        dur: 20 + rng(i * 11 + 3) * 22,
        delay: -(rng(i * 11 + 4) * 35),
        rtl: rng(i * 11 + 5) > 0.5,
        bob: 2.5 + rng(i * 11 + 6) * 2,
      })),
    [],
  )

  const bubbles = useMemo<BubbleCfg[]>(
    () =>
      Array.from({ length: BUBBLE_COUNT }, (_, i) => ({
        id: i,
        x: rng(i * 7 + 50) * 98,
        size: 5 + rng(i * 7 + 51) * 22,
        dur: 9 + rng(i * 7 + 52) * 14,
        delay: -(rng(i * 7 + 53) * 22),
      })),
    [],
  )

  if (!active || !target) return null

  return createPortal(
    <div className="sp_bck_ov" aria-hidden="true">
      {fish.map((f) => (
        <div
          key={f.id}
          className="sp_bck_f"
          style={{
            top: `${f.y}vh`,
            animationName: f.rtl ? 'sp_a_rtl' : 'sp_a_ltr',
            animationDuration: `${f.dur}s`,
            animationDelay: `${f.delay}s`,
            animationTimingFunction: 'linear',
            animationIterationCount: 'infinite',
          }}
        >
          <div
            className="sp_bck_f__i"
            style={{ ['--sp-bob' as string]: `${f.bob}s` }}
          >
            <img
              src={sardineSvg}
              width={f.size}
              style={f.rtl ? { transform: 'scaleX(-1)' } : undefined}
              alt=""
            />
          </div>
        </div>
      ))}
      {bubbles.map((b) => (
        <div
          key={b.id}
          className="sp_bck_b"
          style={{
            left: `${b.x}vw`,
            width: b.size,
            height: b.size,
            ['--sp-bd' as string]: `${b.dur}s`,
            animationDelay: `${b.delay}s`,
          }}
        />
      ))}
    </div>,
    target,
  )
}
