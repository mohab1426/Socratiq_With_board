import { type Board, type BoardElement, BOARD_W, BOARD_H } from "./whiteboard"

export interface ViewportRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Calculates the current visible bounding box on the board stage given the canvas viewport size and viewState.
 */
export function getVisibleViewport(
  viewState: { x: number; y: number; scale: number },
  canvasWidth = 1000,
  canvasHeight = 700
): ViewportRect {
  const scale = viewState.scale > 0 ? viewState.scale : 0.4
  const visibleW = canvasWidth / scale
  const visibleH = canvasHeight / scale
  const minX = Math.max(0, Math.min(BOARD_W, viewState.x))
  const minY = Math.max(0, Math.min(BOARD_H, viewState.y))
  const maxX = Math.min(BOARD_W, minX + visibleW)
  const maxY = Math.min(BOARD_H, minY + visibleH)
  return {
    x: minX,
    y: minY,
    w: Math.max(100, maxX - minX),
    h: Math.max(100, maxY - minY),
  }
}

/**
 * Checks whether two rectangular bounding boxes overlap with an optional buffer.
 */
export function boxesIntersect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  buffer = 16
): boolean {
  return !(
    a.x + a.w + buffer <= b.x ||
    b.x + b.w + buffer <= a.x ||
    a.y + a.h + buffer <= b.y ||
    b.y + b.h + buffer <= a.y
  )
}

/**
 * Calculates a smart, collision-free position for inserting new content.
 */
export function getSmartPlacement(
  board: Board,
  viewState: { x: number; y: number; scale: number },
  itemW = 320,
  itemH = 200,
  selectedId: string | null = null,
  canvasWidth = 1000,
  canvasHeight = 700
): { x: number; y: number } {
  const vp = getVisibleViewport(viewState, canvasWidth, canvasHeight)
  const elements = board.elements

  // Helper: test if candidate (cx, cy) collides with any element
  const hasCollision = (cx: number, cy: number, w: number, h: number) => {
    const candidate = { x: cx, y: cy, w, h }
    return elements.some((el) => boxesIntersect(candidate, { x: el.x, y: el.y, w: el.w, h: el.h }, 20))
  }

  // 1. Contextual placement relative to selected element
  if (selectedId) {
    const sel = elements.find((e) => e.id === selectedId)
    if (sel) {
      // Option A: to the right
      const rightX = sel.x + sel.w + 24
      const rightY = sel.y
      if (rightX + itemW <= BOARD_W && !hasCollision(rightX, rightY, itemW, itemH)) {
        return {
          x: Math.round(rightX),
          y: Math.round(Math.min(BOARD_H - itemH, Math.max(0, rightY))),
        }
      }

      // Option B: below
      const belowX = sel.x
      const belowY = sel.y + sel.h + 24
      if (belowY + itemH <= BOARD_H && !hasCollision(belowX, belowY, itemW, itemH)) {
        return {
          x: Math.round(Math.min(BOARD_W - itemW, Math.max(0, belowX))),
          y: Math.round(belowY),
        }
      }
    }
  }

  // 2. Visible viewport search: attempt grid scan in visible bounds
  const startX = Math.max(40, vp.x + 40)
  const startY = Math.max(40, vp.y + 40)
  const endX = Math.min(BOARD_W - itemW, vp.x + vp.w - itemW)
  const endY = Math.min(BOARD_H - itemH, vp.y + vp.h - itemH)

  const stepX = 60
  const stepY = 60

  if (endX >= startX && endY >= startY) {
    for (let cy = startY; cy <= endY; cy += stepY) {
      for (let cx = startX; cx <= endX; cx += stepX) {
        if (!hasCollision(cx, cy, itemW, itemH)) {
          return { x: Math.round(cx), y: Math.round(cy) }
        }
      }
    }
  }

  // 3. Fallback: Place below existing elements or visible center clamped safely
  if (elements.length > 0) {
    const maxY = Math.max(...elements.map((e) => e.y + e.h))
    const fallbackY = maxY + 32
    if (fallbackY + itemH <= BOARD_H) {
      return {
        x: Math.round(Math.min(BOARD_W - itemW, Math.max(40, vp.x + 40))),
        y: Math.round(fallbackY),
      }
    }
  }

  // 4. Default viewport center clamped to board dimensions
  const centerX = Math.max(40, Math.min(BOARD_W - itemW, vp.x + (vp.w - itemW) / 2))
  const centerY = Math.max(40, Math.min(BOARD_H - itemH, vp.y + (vp.h - itemH) / 2))
  return { x: Math.round(centerX), y: Math.round(centerY) }
}
