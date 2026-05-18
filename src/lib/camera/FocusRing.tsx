import type { FocusRingState } from './useCameraControls'

interface FocusRingProps {
  ring: FocusRingState | null
}

const SIZE = 72

export function FocusRing({ ring }: FocusRingProps) {
  return (
    <>
      {ring && (
        <div
          key={ring.id}
          className="absolute pointer-events-none focus-ring-anim"
          style={{
            left: ring.x - SIZE / 2,
            top: ring.y - SIZE / 2,
            width: SIZE,
            height: SIZE,
          }}
        >
          <div className="w-full h-full rounded-full border-2 border-white shadow-[0_0_10px_rgba(255,255,255,0.7)]" />
        </div>
      )}
      <style>{`
        @keyframes focus-ring-anim-kf {
          0%   { transform: scale(1.4); opacity: 0; }
          30%  { transform: scale(1.0); opacity: 1; }
          100% { transform: scale(0.92); opacity: 0; }
        }
        .focus-ring-anim {
          animation: focus-ring-anim-kf 650ms ease-out forwards;
        }
      `}</style>
    </>
  )
}
