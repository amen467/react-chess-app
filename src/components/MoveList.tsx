import { useMemo } from 'react'

type MoveListProps = {
  moves?: string[]
  onPlySelected?: (ply: number) => void
}

type FullMove = {
  number: number
  white: string
  whitePly: number
  black?: string
  blackPly?: number
}

export function MoveList({
  moves = [],
  onPlySelected,
}: MoveListProps) {
  const fullMoves = useMemo<FullMove[]>(() => {
    const grouped: FullMove[] = []

    for (let i = 0; i < moves.length; i += 2) {
      const white = moves[i]

      if (!white) continue

      grouped.push({
        number: i / 2 + 1,
        white,
        whitePly: i + 1,
        black: moves[i + 1],
        blackPly: moves[i + 1] ? i + 2 : undefined,
      })
    }

    return grouped
  }, [moves])

  const jumpToPly = (ply: number) => {
    onPlySelected?.(ply)
  }

  return (
    <section className="move-list">
      <header>Moves</header>

      <ol>
        {fullMoves.map((move) => (
          <li key={move.number}>
            <span className="move-number">{move.number}.</span>

            <button
              type="button"
              className="ply"
              onClick={() => jumpToPly(move.whitePly)}
            >
              {move.white}
            </button>

            {move.black && move.blackPly && (
              <button
                type="button"
                className="ply"
                onClick={() => jumpToPly(move.blackPly!)}
              >
                {move.black}
              </button>
            )}
          </li>
        ))}
      </ol>

      {!moves.length && (
        <p className="empty">No moves yet.</p>
      )}
    </section>
  )
}

export default MoveList