declare module '@chrisoakman/chessboardjs' {
  type BoardConfig = {
    draggable?: boolean
    pieceTheme?: string | ((piece: string) => string)
    boardTheme?: unknown
    position?: string
    showNotation?: boolean
  }

  type BoardInstance = {
    position: (fen: string, useAnimation?: boolean) => void
    destroy?: () => void
  }

  export default function Chessboard(
    elementOrId: string | HTMLElement,
    config: BoardConfig | string,
  ): BoardInstance
}