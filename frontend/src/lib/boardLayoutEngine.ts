/**
 * Intelligent Board Layout Engine for SocratiQ SmartBoard.
 *
 * Provides deterministic layout planning, accurate bounding box calculations,
 * collision avoidance against student work and existing elements, logical reading order,
 * and clean connector routing.
 */
import {
  BOARD_W,
  BOARD_H,
  type Board,
  type BoardElement,
  type ElementKind,
} from "./whiteboard"

export interface RectBox {
  x: number
  y: number
  w: number
  h: number
}

export interface LayoutItem {
  id: string
  kind: ElementKind
  name: string
  args: Record<string, any>
  box: RectBox
  author: "coach" | "student"
}

export interface BatchPlanResult {
  items: LayoutItem[]
  rejected: { name: string; reason: string }[]
  viewTarget?: { x: number; y: number }
}

const DEFAULT_GAP = 28
const BOARD_PADDING = 32

/**
 * Calculates the axis-aligned bounding box (AABB) of an element,
 * accounting for rotation, line/arrow endpoints, and shape variations.
 */
export function getElementBoundingBox(el: BoardElement): RectBox {
  const rotation = el.rotation || 0
  let rawX = el.x
  let rawY = el.y
  let rawW = el.w
  let rawH = el.h

  if (el.kind === "arrow" || el.kind === "line") {
    const x2 = el.x2 ?? el.x + el.w
    const y2 = el.y2 ?? el.y + el.h
    rawX = Math.min(el.x, x2)
    rawY = Math.min(el.y, y2)
    rawW = Math.max(16, Math.abs(x2 - el.x))
    rawH = Math.max(16, Math.abs(y2 - el.y))
  }

  if (rotation === 0) {
    return { x: rawX, y: rawY, w: rawW, h: rawH }
  }

  const rad = (Math.abs(rotation) * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))

  const rotW = Math.round(rawW * cos + rawH * sin)
  const rotH = Math.round(rawW * sin + rawH * cos)

  const cx = rawX + rawW / 2
  const cy = rawY + rawH / 2

  return {
    x: Math.round(cx - rotW / 2),
    y: Math.round(cy - rotH / 2),
    w: rotW,
    h: rotH,
  }
}

/**
 * Checks whether two rectangular bounding boxes intersect, with an optional safety margin.
 */
export function doBoxesIntersect(a: RectBox, b: RectBox, buffer = 20): boolean {
  return !(
    a.x + a.w + buffer <= b.x ||
    b.x + b.w + buffer <= a.x ||
    a.y + a.h + buffer <= b.y ||
    b.y + b.h + buffer <= a.y
  )
}

/**
 * Checks whether candidate box collides with any existing box in the collection.
 */
export function hasBoxCollision(candidate: RectBox, existing: RectBox[], buffer = 20): boolean {
  return existing.some((box) => doBoxesIntersect(candidate, box, buffer))
}

/**
 * Estimates element dimensions with typography and math awareness.
 */
export function estimateContentDimensions(item: {
  kind: string
  text?: string
  latex?: string
  width?: number
  height?: number
  radius?: number
  fontSize?: number
}): { w: number; h: number } {
  if (item.kind === "text") {
    const text = item.text || ""
    const fontSize = item.fontSize || 24
    const lines = text.split("\n")
    const longestLine = Math.max(...lines.map((l) => l.length), 1)

    // Character width estimate for standard clean UI fonts
    const charWidth = fontSize * 0.58
    const naturalWidth = longestLine * charWidth + 36
    const w = Math.min(640, Math.max(200, Math.round(naturalWidth)))

    const usableWidth = Math.max(120, w - 32)
    const wrappedLineCount = lines.reduce((acc, line) => {
      const lineLen = line.length * charWidth
      return acc + Math.max(1, Math.ceil(lineLen / usableWidth))
    }, 0)

    const lineHeight = fontSize * 1.35 + 8
    const h = Math.max(56, Math.round(wrappedLineCount * lineHeight + 20))
    return { w, h }
  }

  if (item.kind === "equation") {
    const latex = item.latex || ""
    const isTall = ["\\frac", "\\sum", "\\int", "\\begin", "\\\\", "\\sqrt", "\\lim", "\\matrix", "\\prod"].some((t) =>
      latex.includes(t)
    )
    const estimatedW = Math.min(940, Math.max(240, latex.length * 22 + 40))
    const estimatedH = isTall ? 150 : 96
    return { w: estimatedW, h: estimatedH }
  }

  if (item.kind === "circle") {
    const r = item.radius || 40
    return { w: r * 2, h: r * 2 }
  }

  if (item.kind === "shape" || item.kind === "rect") {
    return {
      w: Math.max(60, item.width || 140),
      h: Math.max(40, item.height || 90),
    }
  }

  if (item.kind === "triangle") {
    return {
      w: Math.max(60, item.width || 110),
      h: Math.max(60, item.height || 110),
    }
  }

  if (item.kind === "simulation") {
    return { w: 480, h: 360 }
  }

  if (item.kind === "image") {
    return { w: 380, h: 280 }
  }

  if (item.kind === "arrow" || item.kind === "line") {
    return {
      w: Math.max(60, item.width || 160),
      h: Math.max(20, item.height || 30),
    }
  }

  return {
    w: Math.max(80, item.width || 200),
    h: Math.max(50, item.height || 100),
  }
}

/**
 * Finds an optimal collision-free position for placing a new element.
 */
export function findCollisionFreePosition(
  board: Board,
  w: number,
  h: number,
  preferredPos?: { x: number; y: number },
  additionalOccupied: RectBox[] = [],
  viewState?: { x: number; y: number; scale: number },
  buffer = 24
): { x: number; y: number } {
  const existingBoxes = [
    ...board.elements.map(getElementBoundingBox),
    ...additionalOccupied,
  ]

  const maxX = BOARD_W - w - BOARD_PADDING
  const maxY = BOARD_H - h - BOARD_PADDING

  // 1. If preferred position given, test it directly
  if (preferredPos) {
    const clampedX = Math.round(Math.max(BOARD_PADDING, Math.min(maxX, preferredPos.x)))
    const clampedY = Math.round(Math.max(BOARD_PADDING, Math.min(maxY, preferredPos.y)))
    const candidate: RectBox = { x: clampedX, y: clampedY, w, h }

    if (!hasBoxCollision(candidate, existingBoxes, buffer)) {
      return { x: clampedX, y: clampedY }
    }

    // Attempt adjacent placements (below, then right)
    const belowY = clampedY + h + buffer
    if (belowY <= maxY) {
      const belowCand = { x: clampedX, y: belowY, w, h }
      if (!hasBoxCollision(belowCand, existingBoxes, buffer)) {
        return { x: clampedX, y: belowY }
      }
    }

    const rightX = clampedX + w + buffer
    if (rightX <= maxX) {
      const rightCand = { x: rightX, y: clampedY, w, h }
      if (!hasBoxCollision(rightCand, existingBoxes, buffer)) {
        return { x: rightX, y: clampedY }
      }
    }
  }

  // 2. Viewport-aware search if viewState provided
  if (viewState) {
    const scale = viewState.scale > 0 ? viewState.scale : 0.5
    const vpW = 1000 / scale
    const vpH = 700 / scale
    const vpStartX = Math.max(BOARD_PADDING, Math.min(BOARD_W, viewState.x))
    const vpStartY = Math.max(BOARD_PADDING, Math.min(BOARD_H, viewState.y))
    const vpEndX = Math.min(maxX, vpStartX + vpW - w)
    const vpEndY = Math.min(maxY, vpStartY + vpH - h)

    const stepX = 50
    const stepY = 50

    if (vpEndX >= vpStartX && vpEndY >= vpStartY) {
      for (let cy = vpStartY; cy <= vpEndY; cy += stepY) {
        for (let cx = vpStartX; cx <= vpEndX; cx += stepX) {
          const cand = { x: Math.round(cx), y: Math.round(cy), w, h }
          if (!hasBoxCollision(cand, existingBoxes, buffer)) {
            return { x: cand.x, y: cand.y }
          }
        }
      }
    }
  }

  // 3. Global scan across columns (Left column, then Right column)
  const columns = [BOARD_PADDING, 1020]
  const stepY = 40

  for (const colX of columns) {
    if (colX + w <= BOARD_W - BOARD_PADDING) {
      for (let cy = BOARD_PADDING; cy <= maxY; cy += stepY) {
        const cand = { x: colX, y: cy, w, h }
        if (!hasBoxCollision(cand, existingBoxes, buffer)) {
          return { x: cand.x, y: cand.y }
        }
      }
    }
  }

  // 4. Safe fallback: place below the lowest element
  if (existingBoxes.length > 0) {
    const lowestY = Math.max(...existingBoxes.map((b) => b.y + b.h))
    const safeY = lowestY + buffer
    if (safeY <= maxY) {
      return { x: BOARD_PADDING, y: Math.round(safeY) }
    }
  }

  // Clamped default
  return {
    x: Math.round(Math.max(BOARD_PADDING, Math.min(maxX, BOARD_PADDING))),
    y: Math.round(Math.max(BOARD_PADDING, Math.min(maxY, BOARD_PADDING))),
  }
}

/**
 * Calculates optimal start/end coordinates for an arrow connecting two rectangular boxes.
 * Prevents arrows from piercing through text or shapes.
 */
export function computeArrowEndpoints(
  fromBox: RectBox,
  toBox: RectBox
): { x1: number; y1: number; x2: number; y2: number } {
  const fromCenter = { x: fromBox.x + fromBox.w / 2, y: fromBox.y + fromBox.h / 2 }
  const toCenter = { x: toBox.x + toBox.w / 2, y: toBox.y + toBox.h / 2 }

  const dx = toCenter.x - fromCenter.x
  const dy = toCenter.y - fromCenter.y

  let x1 = fromCenter.x
  let y1 = fromCenter.y
  let x2 = toCenter.x
  let y2 = toCenter.y

  // Intersect with fromBox boundary
  if (Math.abs(dx) * fromBox.h > Math.abs(dy) * fromBox.w) {
    // Exits left or right
    x1 = dx > 0 ? fromBox.x + fromBox.w : fromBox.x
    y1 = fromCenter.y + (dy * (x1 - fromCenter.x)) / (dx || 1)
  } else {
    // Exits top or bottom
    y1 = dy > 0 ? fromBox.y + fromBox.h : fromBox.y
    x1 = fromCenter.x + (dx * (y1 - fromCenter.y)) / (dy || 1)
  }

  // Intersect with toBox boundary
  if (Math.abs(dx) * toBox.h > Math.abs(dy) * toBox.w) {
    // Enters left or right
    x2 = dx > 0 ? toBox.x : toBox.x + toBox.w
    y2 = toCenter.y + (dy * (x2 - toCenter.x)) / (dx || 1)
  } else {
    // Enters top or bottom
    y2 = dy > 0 ? toBox.y : toBox.y + toBox.h
    x2 = toCenter.x + (dx * (y2 - toCenter.y)) / (dy || 1)
  }

  return {
    x1: Math.round(x1),
    y1: Math.round(y1),
    x2: Math.round(x2),
    y2: Math.round(y2),
  }
}

/**
 * Coordinated Batch Layout Planner.
 *
 * Takes raw function calls from the model (e.g. title, shapes, equations, arrows),
 * determines visual hierarchy, reading order, and non-overlapping coordinates.
 */
export function planBatchLayout(
  functionCalls: any[],
  currentBoard: Board,
  viewState?: { x: number; y: number; scale: number },
  selectedId: string | null = null
): BatchPlanResult {
  const plannedItems: LayoutItem[] = []
  const rejected: { name: string; reason: string }[] = []
  const plannedBoxes: RectBox[] = []

  // Check if student has a selected element to anchor near
  const selectedEl = selectedId ? currentBoard.elements.find((e) => e.id === selectedId) : null
  let anchorPos: { x: number; y: number } | undefined = undefined

  if (selectedEl) {
    const sBox = getElementBoundingBox(selectedEl)
    anchorPos = {
      x: Math.min(BOARD_W - 350, sBox.x + sBox.w + DEFAULT_GAP),
      y: sBox.y,
    }
  }

  // Pre-sort or organize items into logical visual hierarchy:
  // 1. Titles / Headings
  // 2. Diagrams / Shapes / Vector art
  // 3. Equations / Formulas
  // 4. Descriptions / Notes
  // 5. Connectors / Arrows (placed after shapes so they can attach properly)
  const connectors: any[] = []
  const contentCalls: any[] = []

  for (const fc of functionCalls) {
    const rawName = fc.name || fc.function_name || ""
    if (rawName === "draw_arrow" || rawName === "add_arrow" || rawName === "draw_line" || rawName === "add_line") {
      connectors.push(fc)
    } else {
      contentCalls.push(fc)
    }
  }

  let lastPlacedBox: RectBox | null = null

  // Plan content elements
  for (const fc of contentCalls) {
    const rawName = fc.name || fc.function_name || ""
    const name =
      rawName === "add_text" ? "write_text"
      : rawName === "add_equation" ? "add_equation"
      : rawName
    const args = fc.args || fc.parameters || {}
    const id = "ai_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

    let kind: ElementKind = "shape"
    if (name === "write_text") kind = "text"
    else if (name === "add_equation") kind = "equation"
    else if (name === "draw_rectangle") kind = "shape"
    else if (name === "draw_circle") kind = "circle"
    else if (name === "draw_triangle") kind = "triangle"
    else if (name === "generate_simulation" || name === "add_plot") kind = "simulation"
    else if (name === "generate_image") kind = "image"
    else if (name === "draw_path") kind = "path"

    const dims = estimateContentDimensions({
      kind,
      text: args.text,
      latex: args.latex,
      width: args.width,
      height: args.height,
      radius: args.radius,
      fontSize: args.fontSize,
    })

    // Determine preferred position
    let prefX = args.x
    let prefY = args.y

    // If no coordinates supplied or default (0,0), place below previous element
    if (prefX === undefined || prefY === undefined || (prefX === 0 && prefY === 0)) {
      if (lastPlacedBox) {
        prefX = lastPlacedBox.x
        prefY = lastPlacedBox.y + lastPlacedBox.h + DEFAULT_GAP
      } else if (anchorPos) {
        prefX = anchorPos.x
        prefY = anchorPos.y
      }
    }

    const preferred = prefX !== undefined && prefY !== undefined ? { x: prefX, y: prefY } : undefined
    const finalPos = findCollisionFreePosition(
      currentBoard,
      dims.w,
      dims.h,
      preferred,
      plannedBoxes,
      viewState
    )

    const box: RectBox = { x: finalPos.x, y: finalPos.y, w: dims.w, h: dims.h }
    plannedBoxes.push(box)
    lastPlacedBox = box

    plannedItems.push({
      id,
      kind,
      name,
      args: { ...args, ...finalPos, w: dims.w, h: dims.h },
      box,
      author: "coach",
    })
  }

  // Plan connectors / arrows
  for (const fc of connectors) {
    const rawName = fc.name || fc.function_name || ""
    const name = rawName === "add_arrow" ? "draw_arrow" : rawName === "add_line" ? "draw_line" : rawName
    const args = fc.args || fc.parameters || {}
    const id = "ai_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

    let x1 = args.x1 ?? 100
    let y1 = args.y1 ?? 100
    let x2 = args.x2 ?? 240
    let y2 = args.y2 ?? 100

    // If arrow should connect two consecutively placed items in this batch
    if (plannedItems.length >= 2 && (args.x1 === undefined || (args.x1 === 0 && args.x2 === 0))) {
      const prev1 = plannedItems[plannedItems.length - 2].box
      const prev2 = plannedItems[plannedItems.length - 1].box
      const endpoints = computeArrowEndpoints(prev1, prev2)
      x1 = endpoints.x1
      y1 = endpoints.y1
      x2 = endpoints.x2
      y2 = endpoints.y2
    }

    const minX = Math.min(x1, x2)
    const minY = Math.min(y1, y2)
    const w = Math.max(20, Math.abs(x2 - x1))
    const h = Math.max(20, Math.abs(y2 - y1))

    const box: RectBox = { x: minX, y: minY, w, h }
    plannedBoxes.push(box)

    plannedItems.push({
      id,
      kind: name === "draw_arrow" ? "arrow" : "line",
      name,
      args: { ...args, x1, y1, x2, y2, color: args.color || (name === "draw_arrow" ? "#2563eb" : "#000000") },
      box,
      author: "coach",
    })
  }

  const viewTarget = plannedItems.length > 0 ? {
    x: Math.round(plannedItems[0].box.x + plannedItems[0].box.w / 2),
    y: Math.round(plannedItems[0].box.y + plannedItems[0].box.h / 2),
  } : undefined

  return {
    items: plannedItems,
    rejected,
    viewTarget,
  }
}

export interface BoardStateAnalysis {
  studentElements: BoardElement[]
  coachElements: BoardElement[]
  totalElements: number
  totalStrokes: number
  occupiedBoxes: RectBox[]
  occupiedAreaFraction: number
  summary: string
}

/**
 * Reads and analyzes current board state, categorizing student vs coach work
 * and calculating canvas occupancy.
 */
export function readBoardState(board: Board): BoardStateAnalysis {
  const studentElements = board.elements.filter((e) => e.author === "student")
  const coachElements = board.elements.filter((e) => e.author === "coach")
  const occupiedBoxes = board.elements.map(getElementBoundingBox)
  const totalOccupiedArea = occupiedBoxes.reduce((acc, b) => acc + b.w * b.h, 0)
  const canvasArea = BOARD_W * BOARD_H
  const occupiedAreaFraction = Math.min(1, Math.round((totalOccupiedArea / canvasArea) * 100) / 100)

  let summary = `Board has ${board.elements.length} elements (${studentElements.length} student, ${coachElements.length} coach) and ${board.strokes.length} strokes.`
  if (studentElements.length > 0) {
    const studentItems = studentElements
      .map((e) => e.text || e.latex || e.kind)
      .slice(0, 3)
      .join(", ")
    summary += ` Student work: [${studentItems}].`
  }
  summary += ` Board occupancy: ${Math.round(occupiedAreaFraction * 100)}%.`

  return {
    studentElements,
    coachElements,
    totalElements: board.elements.length,
    totalStrokes: board.strokes.length,
    occupiedBoxes,
    occupiedAreaFraction,
    summary,
  }
}

/**
 * Step 6: Verifies post-render bounding boxes and reflows coach elements if text wrapping
 * or latex rendering created unexpected overlaps. Never moves student work.
 */
export function verifyAndReflowLayout(
  board: Board,
  renderedBounds: Record<string, RectBox> | Map<string, RectBox>,
  buffer = 20
): { needsReflow: boolean; updatedElements: BoardElement[] } {
  const boundsMap = renderedBounds instanceof Map ? renderedBounds : new Map(Object.entries(renderedBounds))
  let needsReflow = false
  const updatedElements: BoardElement[] = board.elements.map((el) => ({ ...el }))

  for (let i = 0; i < updatedElements.length; i++) {
    const el = updatedElements[i]
    const actual = boundsMap.get(el.id)
    if (actual && (Math.abs(actual.w - el.w) > 10 || Math.abs(actual.h - el.h) > 10)) {
      el.w = actual.w
      el.h = actual.h
    }
  }

  // Check pairwise collisions among elements. If a coach element overlaps any previous element,
  // shift the coach element down to resolve overlap.
  for (let i = 0; i < updatedElements.length; i++) {
    const current = updatedElements[i]
    if (current.author === "student") continue // Student elements are strictly protected!

    let currentBox = getElementBoundingBox(current)

    for (let j = 0; j < updatedElements.length; j++) {
      if (i === j) continue
      const other = updatedElements[j]
      const otherBox = getElementBoundingBox(other)

      if (doBoxesIntersect(currentBox, otherBox, buffer)) {
        if (other.author === "student" || j < i) {
          const shiftY = otherBox.y + otherBox.h + buffer - current.y
          if (shiftY > 0) {
            current.y += shiftY
            needsReflow = true
            currentBox = getElementBoundingBox(current)
          }
        }
      }
    }
  }

  return { needsReflow, updatedElements }
}

