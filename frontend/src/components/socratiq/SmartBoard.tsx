import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { MathView } from "@/components/socratiq/MathView"
import { TextNode } from "@/components/socratiq/TextNode"
import { SimulationNode } from "@/components/socratiq/SimulationNode"
import {
  BOARD_H, BOARD_W, LIMITS, addElement, arrowEndpoints, canAddStroke, hitElement, moveElement, removeElement, shapeBox, simplify, updateElement,
  type Board, type BoardElement, type Color, type Stroke,
} from "@/lib/whiteboard"
import { cn } from "@/lib/utils"
import { Sparkles, Loader2 } from "lucide-react"

export type Tool =
  | "select"
  | "pan"
  | "pen"
  | "highlighter"
  | "eraser"
  | "text"
  | "equation"
  | "arrow"
  | "rect"
  | "circle"
  | "triangle"
  | "line"
  | "ellipse"

const INK = "#1f2937"
const TINT: Record<string, string> = {
  yellow: "rgba(250,204,21,0.38)",
  green: "rgba(34,197,94,0.30)",
  red: "rgba(239,68,68,0.28)",
  blue: "rgba(59,130,246,0.28)",
}
const LINE: Record<string, string> = {
  yellow: "#ca8a04",
  green: "#16a34a",
  red: "#dc2626",
  blue: "#2563eb",
}

function paint(ctx: CanvasRenderingContext2D, s: Stroke, strokeColor?: string) {
  ctx.save()
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  if (s.t === "e") {
    ctx.globalCompositeOperation = "destination-out"
    ctx.lineWidth = s.w * 5
    ctx.strokeStyle = "#000"
    ctx.fillStyle = "#000"
  } else if (s.t === "h") {
    ctx.globalAlpha = 0.35
    ctx.lineWidth = s.w * 4
    ctx.strokeStyle = "#facc15"
    ctx.fillStyle = "#facc15"
  } else {
    ctx.lineWidth = s.w
    const color = strokeColor || s.color || INK
    ctx.strokeStyle = color
    ctx.fillStyle = color
  }
  if (s.pts.length === 1) {
    ctx.beginPath()
    ctx.arc(s.pts[0][0], s.pts[0][1], ctx.lineWidth / 2, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.beginPath()
    ctx.moveTo(s.pts[0][0], s.pts[0][1])
    for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i][0], s.pts[i][1])
    ctx.stroke()
  }
  ctx.restore()
}

type Draft = { kind: string; a: [number, number]; b: [number, number]; fromId?: string }
type Editing = { id: string | null; x: number; y: number; value: string; color?: string }

export interface ViewState {
  x: number
  y: number
  scale: number
}

interface Props {
  board: Board
  onChange?: (b: Board) => void
  readOnly?: boolean
  busy?: boolean
  tool?: Tool
  grid?: boolean
  theme?: "light" | "dark"
  currentColor?: string
  strokeWidth?: number
  filled?: boolean
  fontSize?: number
  selectedId?: string | null
  selectedIds?: string[]
  onSelect?: (id: string | null) => void
  onSelectionChange?: (ids: string[]) => void
  fresh?: Map<string, number>
  onEquationRequest?: (at: { x: number; y: number }, editId?: string) => void
  fit?: "contain" | "width"
  emptyHint?: boolean
  viewState?: ViewState
  onViewChange?: (view: ViewState) => void
  onToolChange?: (tool: Tool) => void
}

export interface SmartBoardHandle {
  getScreenCapture: () => Promise<string | null>
}

export const SmartBoard = React.forwardRef<SmartBoardHandle, Props>(function SmartBoard({
  board,
  onChange,
  readOnly = false,
  busy = false,
  tool = "select",
  grid = false,
  theme = "light",
  currentColor = "#000000",
  strokeWidth = 4,
  filled = false,
  fontSize = 24,
  selectedId = null,
  selectedIds,
  onSelect,
  onSelectionChange,
  fresh,
  onEquationRequest,
  fit = "contain",
  emptyHint = true,
  viewState,
  onViewChange,
  onToolChange,
}: Props, ref) {
  const viewport = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const drawing = useRef<Stroke | null>(null)
  const drag = useRef<{ id: string; ox: number; oy: number; px: number; py: number; moved: boolean } | null>(null)
  const [internalScale, setInternalScale] = useState(0.4)
  const [internalPan, setInternalPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null)
  const [multiDragOffset, setMultiDragOffset] = useState<{ dx: number; dy: number } | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [interactionMode, setInteractionMode] = useState<"idle" | "resizing" | "rotating" | "selecting">("idle")
  const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  const getScreenCapture = useCallback(async (): Promise<string | null> => {
    if (!svgRef.current || !canvas.current) return null
    try {
      const clone = svgRef.current.cloneNode(true) as SVGSVGElement
      const foreignObjects = clone.querySelectorAll("foreignObject")
      foreignObjects.forEach((fo) => {
        if (fo.querySelector("iframe")) {
          const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect")
          rect.setAttribute("x", fo.getAttribute("x") || "0")
          rect.setAttribute("y", fo.getAttribute("y") || "0")
          rect.setAttribute("width", fo.getAttribute("width") || "100")
          rect.setAttribute("height", fo.getAttribute("height") || "100")
          rect.setAttribute("fill", "#6366f1")
          rect.setAttribute("opacity", "0.5")
          fo.parentNode?.replaceChild(rect, fo)
        }
      })

      const serializer = new XMLSerializer()
      const svgStr = serializer.serializeToString(clone)
      const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" })
      const url = URL.createObjectURL(svgBlob)

      return new Promise<string | null>((resolve) => {
        const img = new Image()
        img.crossOrigin = "anonymous"
        img.onload = () => {
          const offscreen = document.createElement("canvas")
          const maxWidth = 512
          const scale = Math.min(1, maxWidth / BOARD_W)
          offscreen.width = BOARD_W * scale
          offscreen.height = BOARD_H * scale
          const ctx = offscreen.getContext("2d")
          if (!ctx) {
            URL.revokeObjectURL(url)
            resolve(null)
            return
          }
          ctx.fillStyle = theme === "dark" ? "#171717" : "#ffffff"
          ctx.fillRect(0, 0, offscreen.width, offscreen.height)
          if (canvas.current) {
            ctx.drawImage(canvas.current, 0, 0, offscreen.width, offscreen.height)
          }
          ctx.drawImage(img, 0, 0, offscreen.width, offscreen.height)

          try {
            const base64 = offscreen.toDataURL("image/jpeg", 0.6).split(",")[1]
            URL.revokeObjectURL(url)
            resolve(base64)
          } catch {
            URL.revokeObjectURL(url)
            resolve(null)
          }
        }
        img.onerror = () => {
          URL.revokeObjectURL(url)
          resolve(null)
        }
        img.src = url
      })
    } catch {
      return null
    }
  }, [theme])

  React.useImperativeHandle(ref, () => ({
    getScreenCapture,
  }), [getScreenCapture])

  const [internalSelectedIds, setInternalSelectedIds] = useState<string[]>([])

  // Normalize multi-selection set
  const activeSelectedSet = React.useMemo(() => {
    if (selectedIds !== undefined) return new Set(selectedIds)
    if (selectedId) return new Set([selectedId])
    return new Set<string>(internalSelectedIds)
  }, [selectedIds, selectedId, internalSelectedIds])

  const setSelection = useCallback((nextIds: string[]) => {
    setInternalSelectedIds(nextIds)
    onSelectionChange?.(nextIds)
    onSelect?.(nextIds.length === 1 ? nextIds[0] : null)
  }, [onSelectionChange, onSelect])

  const toggleSelect = useCallback((id: string, isShift: boolean) => {
    if (isShift) {
      const next = new Set(activeSelectedSet)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      setSelection(Array.from(next))
    } else {
      setSelection([id])
    }
  }, [activeSelectedSet, setSelection])

  const effectiveScale = viewState ? viewState.scale : internalScale
  const effectivePan = viewState ? { x: viewState.x, y: viewState.y } : internalPan

  const updateView = useCallback((next: ViewState) => {
    if (onViewChange) {
      onViewChange(next)
    } else {
      setInternalPan({ x: next.x, y: next.y })
      setInternalScale(next.scale)
    }
  }, [onViewChange])

  const interactive = !readOnly && !busy && !!onChange
  const overlayOn = interactive && tool !== "select"

  useLayoutEffect(() => {
    const el = viewport.current
    if (!el || viewState) return
    const measure = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      const s = fit === "width" || h === 0 ? w / BOARD_W : Math.min(w / BOARD_W, h / BOARD_H)
      if (s > 0.02) setInternalScale(s)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit, viewState])

  const redraw = useCallback(() => {
    const c = canvas.current?.getContext("2d")
    if (!c) return
    c.clearRect(0, 0, BOARD_W, BOARD_H)
    board.strokes.forEach((s) => paint(c, s, s.color))
  }, [board.strokes])
  useEffect(redraw, [redraw])

  const at = (e: { clientX?: number; clientY?: number }): [number, number] => {
    const r = stage.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
    const cx = Number.isFinite(e.clientX) ? (e.clientX as number) : 0
    const cy = Number.isFinite(e.clientY) ? (e.clientY as number) : 0
    const cl = (n: number, m: number) => Math.min(Math.max(Math.round(n), 0), m)
    const scale = effectiveScale > 0 ? effectiveScale : 1
    return [cl((cx - r.left) / scale, BOARD_W), cl((cy - r.top) / scale, BOARD_H)]
  }

  const byId = new Map(board.elements.map((e) => [e.id, e]))

  // Overlay tool pointer handlers
  function down(e: React.PointerEvent) {
    if (!overlayOn || !onChange) return
    const p = at(e)

    if (tool === "pan") {
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { id: "__pan__", ox: effectivePan.x, oy: effectivePan.y, px: e.clientX, py: e.clientY, moved: false }
      return
    }

    if (tool === "eraser") {
      const hit = hitElement(board, p[0], p[1])
      if (hit) {
        onChange(removeElement(board, hit.id))
        onSelect?.(null)
        return
      }
    }

    if (tool === "pen" || tool === "highlighter" || tool === "eraser") {
      if (!canAddStroke(board)) return
      e.currentTarget.setPointerCapture(e.pointerId)
      const strokeW = tool === "highlighter" ? 6 : (strokeWidth || 4)
      drawing.current = {
        t: tool === "pen" ? "p" : tool === "highlighter" ? "h" : "e",
        w: strokeW,
        pts: [p],
        color: tool === "pen" ? currentColor : undefined,
      }
      const c = canvas.current?.getContext("2d")
      if (c) paint(c, drawing.current, tool === "pen" ? currentColor : undefined)
    } else if (tool === "text") {
      const safeX = Math.max(20, Math.min(p[0], BOARD_W - 320))
      const safeY = Math.max(20, Math.min(p[1], BOARD_H - 120))
      setEditing({ id: null, x: safeX, y: safeY, value: "", color: currentColor })
    } else if (tool === "equation") {
      onEquationRequest?.({ x: p[0], y: p[1] })
    } else {
      e.currentTarget.setPointerCapture(e.pointerId)
      setDraft({
        kind: tool,
        a: p,
        b: p,
        fromId: tool === "arrow" ? hitElement(board, p[0], p[1])?.id : undefined,
      })
    }
  }

  function move(e: React.PointerEvent) {
    if (drag.current && drag.current.id === "__pan__") {
      const dx = (e.clientX - drag.current.px) / effectiveScale
      const dy = (e.clientY - drag.current.py) / effectiveScale
      updateView({ x: drag.current.ox - dx, y: drag.current.oy - dy, scale: effectiveScale })
      return
    }

    const p = at(e)
    const s = drawing.current
    if (s) {
      s.pts.push(p)
      if (s.pts.length >= LIMITS.strokePoints) return up(e)
      const c = canvas.current?.getContext("2d")
      if (c) paint(c, { ...s, pts: s.pts.slice(-2) }, s.color || (tool === "pen" ? currentColor : undefined))
    } else if (draft) {
      setDraft({ ...draft, b: p })
    }
  }

  function up(e: React.PointerEvent) {
    if (drag.current && drag.current.id === "__pan__") {
      drag.current = null
      return
    }

    const s = drawing.current
    drawing.current = null
    if (s && onChange) {
      const completedStroke: Stroke = {
        ...s,
        pts: simplify(s.pts),
        color: s.t === "p" ? (s.color || currentColor) : undefined,
      }
      onChange({ ...board, strokes: [...board.strokes, completedStroke] })
      return
    }


    if (!draft || !onChange) return
    const d = draft
    setDraft(null)
    const p = at(e)
    const len = Math.hypot(p[0] - d.a[0], p[1] - d.a[1])

    if (d.kind === "arrow") {
      const toId = hitElement(board, p[0], p[1])?.id
      if (d.fromId && toId && d.fromId !== toId) {
        onChange(addElement(board, { kind: "arrow", x: 0, y: 0, fromId: d.fromId, toId, w: 1, h: 0 }).board)
      } else if (len > 30) {
        onChange(addElement(board, { kind: "arrow", x: d.a[0], y: d.a[1], w: p[0] - d.a[0], h: p[1] - d.a[1] }).board)
      }
    } else if (d.kind === "line") {
      if (len > 10) {
        onChange(
          addElement(board, {
            kind: "line",
            x: d.a[0],
            y: d.a[1],
            w: Math.abs(p[0] - d.a[0]),
            h: Math.abs(p[1] - d.a[1]),
            x2: p[0],
            y2: p[1],
            color: currentColor,
            strokeWidth: 3,
          }).board
        )
      }
    } else if (d.kind === "circle") {
      const radius = Math.round(len / 2)
      if (radius > 10) {
        const cx = Math.min(d.a[0], p[0])
        const cy = Math.min(d.a[1], p[1])
        const size = radius * 2
        onChange(
          addElement(board, {
            kind: "circle",
            shape: "circle",
            x: cx,
            y: cy,
            w: size,
            h: size,
            color: currentColor,
            filled,
          }).board
        )
      }
    } else if (d.kind === "triangle") {
      const x = Math.min(d.a[0], p[0])
      const y = Math.min(d.a[1], p[1])
      const w = Math.abs(p[0] - d.a[0])
      const h = Math.abs(p[1] - d.a[1])
      if (w > 20 && h > 20) {
        onChange(
          addElement(board, {
            kind: "triangle",
            shape: "triangle",
            x,
            y,
            w,
            h,
            color: currentColor,
            filled,
          }).board
        )
      }
    } else {
      const x = Math.min(d.a[0], p[0])
      const y = Math.min(d.a[1], p[1])
      const w = Math.abs(p[0] - d.a[0])
      const h = Math.abs(p[1] - d.a[1])
      if (w > 30 && h > 30) {
        onChange(
          addElement(board, {
            kind: "shape",
            shape: d.kind === "rect" ? "rect" : "ellipse",
            x,
            y,
            w,
            h,
            color: currentColor,
            filled,
          }).board
        )
      }
    }
  }

  // Select tool: drag / move / resize / rotate
  function elDown(e: React.PointerEvent, el: BoardElement) {
    if (!interactive || tool !== "select") return
    e.stopPropagation()
    const isShift = e.shiftKey
    if (isShift) {
      toggleSelect(el.id, true)
    } else {
      if (!activeSelectedSet.has(el.id)) {
        setSelection([el.id])
      }
    }
    const p = at(e)
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: el.id, ox: el.x, oy: el.y, px: p[0], py: p[1], moved: false }
  }

  function elMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d || interactionMode !== "idle") return
    const p = at(e)
    const dx = p[0] - d.px
    const dy = p[1] - d.py
    if (Math.hypot(dx, dy) > 4) d.moved = true
    if (d.moved) {
      if (activeSelectedSet.size > 1 && activeSelectedSet.has(d.id)) {
        setMultiDragOffset({ dx, dy })
      } else {
        setDragPos({ id: d.id, x: d.ox + dx, y: d.oy + dy })
      }
    }
  }

  function elUp() {
    const d = drag.current
    drag.current = null
    if (d?.moved && onChange) {
      if (multiDragOffset) {
        const { dx, dy } = multiDragOffset
        const updated = board.elements.map((el) => {
          if (activeSelectedSet.has(el.id)) {
            const nextX = Math.max(0, Math.min(BOARD_W - el.w, el.x + dx))
            const nextY = Math.max(0, Math.min(BOARD_H - el.h, el.y + dy))
            const deltaActualX = nextX - el.x
            const deltaActualY = nextY - el.y
            const nextEl: BoardElement = {
              ...el,
              x: nextX,
              y: nextY,
            }
            if (el.kind === "line" && el.x2 !== undefined && el.y2 !== undefined) {
              nextEl.x2 = el.x2 + deltaActualX
              nextEl.y2 = el.y2 + deltaActualY
            }
            return nextEl
          }
          return el
        })
        onChange({ ...board, elements: updated })
      } else if (dragPos) {
        onChange(moveElement(board, d.id, dragPos.x, dragPos.y))
      }
    }
    setDragPos(null)
    setMultiDragOffset(null)
    setInteractionMode("idle")
  }

  function handleResizeStart(e: React.PointerEvent, el: BoardElement) {
    e.stopPropagation()
    setInteractionMode("resizing")
    const p = at(e)
    const startW = el.w
    const startH = el.h
    const isFixedAspect = el.kind === "image" || el.kind === "circle" || el.shape === "circle"
    const ratio = startW / Math.max(1, startH)

    const onPointerMove = (ev: PointerEvent) => {
      const currentP = at(ev)
      let newW = Math.max(20, startW + (currentP[0] - p[0]))
      let newH = Math.max(20, startH + (currentP[1] - p[1]))

      if (isFixedAspect || ev.shiftKey) {
        if (el.kind === "circle" || el.shape === "circle") {
          const maxDim = Math.max(newW, newH)
          newW = maxDim
          newH = maxDim
        } else {
          newH = Math.round(newW / ratio)
        }
      }

      onChange?.(updateElement(board, el.id, { w: newW, h: newH }))
    }

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onPointerUp)
      setInteractionMode("idle")
    }

    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", onPointerUp)
  }

  function handleRotateStart(e: React.PointerEvent, el: BoardElement) {
    e.stopPropagation()
    setInteractionMode("rotating")
    const cx = el.x + el.w / 2
    const cy = el.y + el.h / 2

    const onPointerMove = (ev: PointerEvent) => {
      const currentP = at(ev)
      const rad = Math.atan2(currentP[1] - cy, currentP[0] - cx)
      let deg = (rad * 180) / Math.PI + 90
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15
      onChange?.(updateElement(board, el.id, { rotation: deg }))
    }

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onPointerUp)
      setInteractionMode("idle")
    }

    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", onPointerUp)
  }

  function startEdit(el: BoardElement) {
    if (!interactive) return
    if (el.kind === "equation") onEquationRequest?.({ x: el.x, y: el.y }, el.id)
    else if (el.kind === "text") setEditing({ id: el.id, x: el.x, y: el.y, value: el.text ?? "", color: el.color })
  }

  function commitEdit() {
    const ed = editing
    setEditing(null)
    if (!ed || !onChange) return
    const text = ed.value.trim().slice(0, LIMITS.textChars)
    if (!text) {
      if (!ed.id) onToolChange?.("select")
      return
    }
    if (ed.id) {
      const existing = byId.get(ed.id)
      const finalColor = ed.color || existing?.color || currentColor
      onChange(updateElement(board, ed.id, { text, fontSize: existing?.fontSize || fontSize, color: finalColor }))
      onToolChange?.("select")
    } else {
      const r = addElement(board, {
        kind: "text",
        x: Math.min(ed.x, BOARD_W - 200),
        y: Math.min(ed.y, BOARD_H - 80),
        text,
        style: "plain",
        fontSize,
        color: ed.color || currentColor,
      })
      onChange(r.board)
      if (r.id) onSelect?.(r.id)
      onToolChange?.("select")
    }
  }

  const isEmpty = board.elements.length === 0 && board.strokes.length === 0 && !editing
  const px = (el: BoardElement) => {
    if (multiDragOffset && activeSelectedSet.has(el.id)) {
      return { x: el.x + multiDragOffset.dx, y: el.y + multiDragOffset.dy }
    }
    if (dragPos?.id === el.id) {
      return { x: dragPos.x, y: dragPos.y }
    }
    return { x: el.x, y: el.y }
  }

  const getOffset = (el: BoardElement) => {
    if (multiDragOffset && activeSelectedSet.has(el.id)) {
      return multiDragOffset
    }
    if (dragPos?.id === el.id) {
      return { dx: dragPos.x - el.x, dy: dragPos.y - el.y }
    }
    return { dx: 0, dy: 0 }
  }

  const isDark = theme === "dark"

  return (
    <div
      ref={viewport}
      className={cn(
        "relative w-full transition-colors duration-200 select-none",
        fit === "contain" && "flex h-full items-center justify-center",
        isDark ? "bg-zinc-950 text-white" : "bg-white text-gray-900"
      )}
      onWheel={(e) => {
        if (e.ctrlKey) {
          e.preventDefault()
          const s = e.deltaY > 0 ? effectiveScale / 1.05 : effectiveScale * 1.05
          updateView({ x: effectivePan.x, y: effectivePan.y, scale: Math.max(0.1, Math.min(s, 5)) })
        } else if (tool === "pan" || !e.shiftKey) {
          updateView({ x: effectivePan.x + e.deltaX / effectiveScale, y: effectivePan.y + e.deltaY / effectiveScale, scale: effectiveScale })
        }
      }}
    >
      <div
        className={cn(
          "relative overflow-hidden rounded-[var(--radius-md)] border shadow-sm",
          isDark ? "border-zinc-800 bg-zinc-900" : "border-[var(--color-border-strong)] bg-white"
        )}
        style={{ width: BOARD_W * effectiveScale, height: BOARD_H * effectiveScale }}
      >
        <div
          ref={stage}
          role="group"
          aria-label={readOnly ? "The student's whiteboard" : "Whiteboard"}
          className="absolute left-0 top-0 origin-top-left"
          style={{
            width: BOARD_W,
            height: BOARD_H,
            transform: `scale(${effectiveScale}) translate(${-effectivePan.x}px, ${-effectivePan.y}px)`,
            backgroundImage: grid
              ? isDark
                ? "linear-gradient(to right, #27272a 1px, transparent 1px), linear-gradient(to bottom, #27272a 1px, transparent 1px)"
                : "linear-gradient(to right, #e5e7eb 1px, transparent 1px), linear-gradient(to bottom, #e5e7eb 1px, transparent 1px)"
              : undefined,
            backgroundSize: grid ? "40px 40px" : undefined,
          }}
          onPointerDown={(e) => {
            if (interactive && tool === "select") {
              if ((e.target as HTMLElement).tagName !== "TEXTAREA") {
                const p = at(e)
                setInteractionMode("selecting")
                setSelectionRect({ x: p[0], y: p[1], w: 0, h: 0 })
                if (!e.shiftKey) setSelection([])
              }
            }
          }}
          onPointerMove={(e) => {
            if (interactionMode === "selecting" && selectionRect) {
              const p = at(e)
              setSelectionRect((prev) => (prev ? { ...prev, w: p[0] - prev.x, h: p[1] - prev.y } : null))
            }
          }}
          onPointerUp={() => {
            if (interactionMode === "selecting" && selectionRect) {
              const rx = selectionRect.w < 0 ? selectionRect.x + selectionRect.w : selectionRect.x
              const ry = selectionRect.h < 0 ? selectionRect.y + selectionRect.h : selectionRect.y
              const rw = Math.abs(selectionRect.w)
              const rh = Math.abs(selectionRect.h)

              if (rw > 5 || rh > 5) {
                const foundIds: string[] = []
                board.elements.forEach((el) => {
                  const cx = el.x + el.w / 2
                  const cy = el.y + el.h / 2
                  if (cx >= rx && cx <= rx + rw && cy >= ry && cy <= ry + rh) {
                    foundIds.push(el.id)
                  }
                })
                setSelection(foundIds)
              }
              setSelectionRect(null)
              setInteractionMode("idle")
            }
          }}
        >
          <canvas ref={canvas} width={BOARD_W} height={BOARD_H} className="pointer-events-none absolute left-0 top-0" aria-hidden="true" />

          <svg
            ref={svgRef}
            viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}
            width={BOARD_W}
            height={BOARD_H}
            className="pointer-events-none absolute left-0 top-0"
            aria-hidden="true"
          >
            <defs>
              {(["default", ...Object.keys(LINE)] as const).map((c) => (
                <marker key={c} id={`ah-${c}`} markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L10,5 L0,10 z" fill={c === "default" ? (isDark ? "#94a3b8" : "#374151") : LINE[c as Color]} />
                </marker>
              ))}
            </defs>

            {/* SmartBoard Lines */}
            {board.elements.filter((e) => e.kind === "line").map((l) => {
              const offset = getOffset(l)
              const lx = l.x + offset.dx
              const ly = l.y + offset.dy
              const x2 = (l.x2 ?? l.x + l.w) + offset.dx
              const y2 = (l.y2 ?? l.y + l.h) + offset.dy
              const col = l.color || (isDark ? "#ffffff" : "#000000")
              const isSel = activeSelectedSet.has(l.id)
              return (
                <g key={l.id}>
                  {/* Invisible thicker hit-test stroke so clicking and dragging thin lines is smooth */}
                  <line
                    x1={lx}
                    y1={ly}
                    x2={x2}
                    y2={y2}
                    stroke="transparent"
                    strokeWidth={Math.max(16, (l.strokeWidth || 3) + 12)}
                    strokeLinecap="round"
                    className={interactive && tool === "select" ? "pointer-events-auto cursor-grab" : undefined}
                    onPointerDown={(ev) => elDown(ev, l)}
                    onPointerMove={elMove}
                    onPointerUp={elUp}
                  />
                  <line
                    x1={lx}
                    y1={ly}
                    x2={x2}
                    y2={y2}
                    stroke={col}
                    strokeWidth={l.strokeWidth || 3}
                    strokeLinecap="round"
                    className="pointer-events-none"
                  />
                  {isSel && <line x1={lx} y1={ly} x2={x2} y2={y2} stroke="#3b82f6" strokeWidth={1} strokeDasharray="4 4" className="pointer-events-none" />}
                </g>
              )
            })}

            {/* SmartBoard Triangles */}
            {board.elements.filter((e) => e.kind === "triangle" || e.shape === "triangle").map((t) => {
              const offset = getOffset(t)
              const tx = t.x + offset.dx
              const ty = t.y + offset.dy
              const p1 = `${tx + t.w / 2},${ty}`
              const p2 = `${tx},${ty + t.h}`
              const p3 = `${tx + t.w},${ty + t.h}`
              const col = t.color || (isDark ? "#ffffff" : "#000000")
              const isSel = activeSelectedSet.has(t.id)
              const rot = t.rotation || 0
              const cx = tx + t.w / 2
              const cy = ty + t.h / 2
              return (
                <polygon
                  key={t.id}
                  points={`${p1} ${p2} ${p3}`}
                  fill={t.filled ? col : "transparent"}
                  fillOpacity={t.filled ? 0.2 : 0}
                  stroke={col}
                  strokeWidth={isSel ? 6 : 3}
                  strokeLinejoin="round"
                  transform={rot ? `rotate(${rot}, ${cx}, ${cy})` : undefined}
                  className={interactive && tool === "select" ? "pointer-events-auto cursor-grab" : undefined}
                  onPointerDown={(ev) => elDown(ev, t)}
                  onPointerMove={elMove}
                  onPointerUp={elUp}
                />
              )
            })}

            {/* Shapes (rect / ellipse / circle) */}
            {board.elements.filter((e) => e.kind === "shape" || e.kind === "circle").map((s) => {
              const b = shapeBox(s, byId)
              const offset = getOffset(s)
              const bx = b.x + offset.dx
              const by = b.y + offset.dy
              const col = s.color ? (LINE[s.color] || s.color) : s.author === "coach" ? "#0f766e" : "#2563eb"
              const isSel = activeSelectedSet.has(s.id)
              const rot = s.rotation || 0
              const cx = bx + b.w / 2
              const cy = by + b.h / 2
              const common = {
                fill: s.filled ? col : s.highlight ? TINT[s.highlight] : "transparent",
                fillOpacity: s.filled ? 0.2 : 1,
                stroke: col,
                strokeWidth: isSel ? 6 : 3,
                transform: rot ? `rotate(${rot}, ${cx}, ${cy})` : undefined,
                className: interactive && tool === "select" ? "pointer-events-auto cursor-grab" : undefined,
                onPointerDown: (ev: React.PointerEvent) => elDown(ev, s),
                onPointerMove: elMove,
                onPointerUp: elUp,
              }
              return s.shape === "ellipse" || s.kind === "circle" ? (
                <ellipse key={s.id} cx={cx} cy={cy} rx={b.w / 2} ry={b.h / 2} {...common} />
              ) : (
                <rect key={s.id} x={bx} y={by} width={b.w} height={b.h} rx={12} {...common} />
              )
            })}

            {/* Arrows */}
            {board.elements.filter((e) => e.kind === "arrow").map((a) => {
              const pts = arrowEndpoints(a, byId)
              if (!pts) return null
              const offset = getOffset(a)
              const c = a.color ?? "default"
              const isSel = activeSelectedSet.has(a.id)
              const x1 = pts[0][0] + offset.dx
              const y1 = pts[0][1] + offset.dy
              const x2 = pts[1][0] + offset.dx
              const y2 = pts[1][1] + offset.dy
              return (
                <g key={a.id}>
                  {/* Invisible thicker hit line for smooth selection/drag */}
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="transparent"
                    strokeWidth={Math.max(16, (isSel ? 8 : 4) + 12)}
                    strokeLinecap="round"
                    className={interactive && tool === "select" ? "pointer-events-auto cursor-grab" : undefined}
                    onPointerDown={(ev) => elDown(ev, a)}
                    onPointerMove={elMove}
                    onPointerUp={elUp}
                  />
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={c === "default" ? (isDark ? "#cbd5e1" : "#374151") : LINE[c] || c}
                    strokeWidth={isSel ? 8 : 4}
                    strokeLinecap="round"
                    markerEnd={`url(#ah-${c})`}
                    className="pointer-events-none"
                  />
                </g>
              )
            })}

            {/* Paths */}
            {board.elements.filter((e) => e.kind === "path" && e.pathData).map((p) => {
              const offset = getOffset(p)
              const ppx = p.x + offset.dx
              const ppy = p.y + offset.dy
              const col = p.color || (isDark ? "#ffffff" : "#000000")
              const isSel = activeSelectedSet.has(p.id)
              const rot = p.rotation || 0
              const cx = ppx + p.w / 2
              const cy = ppy + p.h / 2
              return (
                <path
                  key={p.id}
                  d={p.pathData}
                  transform={`translate(${ppx}, ${ppy}) ${rot ? `rotate(${rot}, ${cx - ppx}, ${cy - ppy})` : ""}`}
                  fill="none"
                  stroke={col}
                  strokeWidth={isSel ? (p.strokeWidth || 3) + 3 : (p.strokeWidth || 3)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={interactive && tool === "select" ? "pointer-events-auto cursor-grab" : undefined}
                  onPointerDown={(ev) => elDown(ev, p)}
                  onPointerMove={elMove}
                  onPointerUp={elUp}
                />
              )
            })}

            {/* Marquee Drag Box */}
            {selectionRect && (
              <rect
                x={selectionRect.w < 0 ? selectionRect.x + selectionRect.w : selectionRect.x}
                y={selectionRect.h < 0 ? selectionRect.y + selectionRect.h : selectionRect.y}
                width={Math.abs(selectionRect.w)}
                height={Math.abs(selectionRect.h)}
                fill="rgba(59, 130, 246, 0.12)"
                stroke="#3b82f6"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                pointerEvents="none"
              />
            )}

            {/* Drawing Preview Drafts */}
            {draft &&
              (draft.kind === "arrow" ? (
                <line x1={draft.a[0]} y1={draft.a[1]} x2={draft.b[0]} y2={draft.b[1]} stroke="#6b7280" strokeWidth={4} strokeDasharray="10 8" markerEnd="url(#ah-default)" />
              ) : draft.kind === "line" ? (
                <line x1={draft.a[0]} y1={draft.a[1]} x2={draft.b[0]} y2={draft.b[1]} stroke="#6b7280" strokeWidth={3} strokeDasharray="8 6" />
              ) : draft.kind === "circle" ? (
                <ellipse
                  cx={(draft.a[0] + draft.b[0]) / 2}
                  cy={(draft.a[1] + draft.b[1]) / 2}
                  rx={Math.abs(draft.b[0] - draft.a[0]) / 2}
                  ry={Math.abs(draft.b[1] - draft.a[1]) / 2}
                  fill="none"
                  stroke="#6b7280"
                  strokeWidth={3}
                  strokeDasharray="8 6"
                />
              ) : draft.kind === "triangle" ? (
                <polygon
                  points={`${(draft.a[0] + draft.b[0]) / 2},${Math.min(draft.a[1], draft.b[1])} ${Math.min(draft.a[0], draft.b[0])},${Math.max(draft.a[1], draft.b[1])} ${Math.max(draft.a[0], draft.b[0])},${Math.max(draft.a[1], draft.b[1])}`}
                  fill="none"
                  stroke="#6b7280"
                  strokeWidth={3}
                  strokeDasharray="8 6"
                />
              ) : (
                <rect
                  x={Math.min(draft.a[0], draft.b[0])}
                  y={Math.min(draft.a[1], draft.b[1])}
                  width={Math.abs(draft.b[0] - draft.a[0])}
                  height={Math.abs(draft.b[1] - draft.a[1])}
                  fill="none"
                  stroke="#6b7280"
                  strokeWidth={3}
                  strokeDasharray="8 6"
                />
              ))}
          </svg>

          {/* HTML / DOM Nodes (Text, Equations, Images, Simulations) */}
          {board.elements.map((el) => {
            const pos = px(el)
            const sel = activeSelectedSet.has(el.id)
            const rot = el.rotation || 0
            const transform = rot ? `rotate(${rot}deg)` : undefined

            // Loading Placeholders (Image / Simulation generating)
            if (el.isLoading) {
              return (
                <div
                  key={el.id}
                  className="absolute flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-blue-400 bg-blue-50/50 p-4 shadow-sm"
                  style={{ left: pos.x, top: pos.y, width: el.w || 300, height: el.h || 200, transform }}
                >
                  <Sparkles className="animate-bounce text-indigo-500 mb-2" size={28} />
                  <Loader2 className="animate-spin text-pink-500 mb-1" size={24} />
                  <span className="text-xs font-bold text-slate-600">Gemini is creating content…</span>
                </div>
              )
            }

            // Image Element
            if (el.kind === "image" && el.src) {
              return (
                <div
                  key={el.id}
                  data-element-id={el.id}
                  onPointerDown={(e) => elDown(e, el)}
                  onPointerMove={elMove}
                  onPointerUp={elUp}
                  className={cn(
                    "absolute select-none rounded-lg overflow-hidden transition-shadow",
                    interactive && tool === "select" ? "cursor-grab" : "pointer-events-none",
                    sel && "ring-2 ring-blue-500 ring-offset-2"
                  )}
                  style={{ left: pos.x, top: pos.y, width: el.w, height: el.h, transform }}
                >
                  <img src={el.src} alt="Uploaded element" className="w-full h-full object-cover pointer-events-none select-none rounded" draggable={false} />
                  {sel && interactive && (
                    <>
                      <div onPointerDown={(e) => handleResizeStart(e, el)} className="absolute bottom-0 right-0 w-4 h-4 bg-blue-600 rounded-tl cursor-nwse-resize" />
                      <div onPointerDown={(e) => handleRotateStart(e, el)} className="absolute -top-6 left-1/2 -translate-x-1/2 w-4 h-4 bg-blue-600 rounded-full cursor-grab" />
                    </>
                  )}
                </div>
              )
            }

            // Interactive Simulation Node
            if (el.kind === "simulation" && el.code) {
              return (
                <div
                  key={el.id}
                  data-element-id={el.id}
                  onPointerDown={(e) => elDown(e, el)}
                  onPointerMove={elMove}
                  onPointerUp={elUp}
                  className={cn("absolute select-none", interactive && tool === "select" ? "cursor-grab" : "pointer-events-auto")}
                  style={{ left: pos.x, top: pos.y, width: el.w, height: el.h, transform }}
                >
                  <SimulationNode code={el.code} title={el.title || "Interactive Simulation"} width={el.w} height={el.h} selected={sel} />
                  {sel && interactive && (
                    <>
                      <div onPointerDown={(e) => handleResizeStart(e, el)} className="absolute bottom-0 right-0 w-5 h-5 bg-blue-600 rounded-tl cursor-nwse-resize z-30" />
                      <div onPointerDown={(e) => handleRotateStart(e, el)} className="absolute -top-7 left-1/2 -translate-x-1/2 w-5 h-5 bg-blue-600 rounded-full cursor-grab z-30" />
                    </>
                  )}
                </div>
              )
            }

            // Text and Equation Elements
            if (el.kind === "text" || el.kind === "equation") {
              const order = fresh?.get(el.id)
              const coach = el.author === "coach"
              const isEditing = editing?.id === el.id
              const elCol = el.color || (isDark ? "#ffffff" : INK)

              return (
                <div
                  key={el.id}
                  data-element-id={el.id}
                  data-author={el.author}
                  onPointerDown={(e) => elDown(e, el)}
                  onPointerMove={elMove}
                  onPointerUp={elUp}
                  onDoubleClick={() => startEdit(el)}
                  className={cn(
                    "absolute select-none rounded-[10px]",
                    order !== undefined && "sb-appear",
                    interactive && tool === "select" ? "pointer-events-auto cursor-grab" : "pointer-events-none",
                    isEditing && "invisible"
                  )}
                  style={{
                    left: pos.x,
                    top: pos.y,
                    width: el.w,
                    minHeight: el.h,
                    color: elCol,
                    transform,
                    background: el.highlight ? TINT[el.highlight] : el.style === "note" ? "#fef9c3" : el.style === "definition" ? "#f0f9ff" : undefined,
                    boxShadow: el.style === "note" ? "0 6px 14px rgba(0,0,0,0.12)" : undefined,
                    borderLeft: coach ? "8px solid #0f766e" : el.style === "definition" ? "8px solid #0ea5e9" : undefined,
                    outline: sel ? "4px solid #3b82f6" : undefined,
                    outlineOffset: sel ? 4 : undefined,
                    animationDelay: order !== undefined ? `${order * 650}ms` : undefined,
                    touchAction: "none",
                  }}
                >
                  {el.kind === "equation" ? (
                    <div className="flex items-center justify-center" style={{ minHeight: el.h, fontSize: el.fontSize || 44, padding: "0 16px" }}>
                      <MathView latex={el.latex ?? ""} />
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap break-words" style={{ fontSize: el.fontSize || (el.style === "title" ? 52 : 36), lineHeight: 1.5, padding: "8px 16px" }}>
                      <TextNode text={el.text || ""} color={elCol} fontSize={el.fontSize || (el.style === "title" ? 52 : 36)} />
                    </div>
                  )}
                  {sel && interactive && (
                    <>
                      <div onPointerDown={(e) => handleResizeStart(e, el)} className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-blue-600 rounded-tl cursor-nwse-resize" />
                      <div onPointerDown={(e) => handleRotateStart(e, el)} className="absolute -top-6 left-1/2 -translate-x-1/2 w-3.5 h-3.5 bg-blue-600 rounded-full cursor-grab" />
                    </>
                  )}
                </div>
              )
            }

            // Resizable SVG Shapes (rect, ellipse, circle, triangle)
            if (el.kind === "shape" || el.kind === "circle" || el.kind === "triangle") {
              if (sel && interactive) {
                return (
                  <div
                    key={`handles-${el.id}`}
                    className="pointer-events-none absolute"
                    style={{ left: pos.x, top: pos.y, width: el.w, height: el.h, transform }}
                  >
                    <div
                      onPointerDown={(e) => handleResizeStart(e, el)}
                      className="pointer-events-auto absolute bottom-0 right-0 w-4 h-4 bg-blue-600 rounded-tl cursor-nwse-resize shadow-sm"
                    />
                    <div
                      onPointerDown={(e) => handleRotateStart(e, el)}
                      className="pointer-events-auto absolute -top-6 left-1/2 -translate-x-1/2 w-4 h-4 bg-blue-600 rounded-full cursor-grab shadow-sm"
                    />
                  </div>
                )
              }
            }

            return null
          })}

          {/* Active text input textarea */}
          {editing && (
            <textarea
              autoFocus
              dir="auto"
              value={editing.value}
              maxLength={LIMITS.textChars}
              aria-label="Text on the board"
              placeholder="Type text here… (Shift+Enter for newline, Enter to save)"
              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  commitEdit()
                }
                if (e.key === "Escape") {
                  e.preventDefault()
                  const wasNew = !editing.id
                  setEditing(null)
                  if (wasNew) onToolChange?.("select")
                }
              }}
              className={cn(
                "absolute resize-none rounded-[10px] border-2 border-blue-600 shadow-2xl outline-none z-50 text-start",
                isDark ? "bg-zinc-900 text-white placeholder-zinc-500" : "bg-white text-zinc-900 placeholder-zinc-400"
              )}
              style={{
                left: editing.x,
                top: editing.y,
                width: Math.min(600, Math.max(300, BOARD_W - editing.x - 24)),
                minHeight: 120,
                fontSize: fontSize || 36,
                lineHeight: 1.4,
                padding: "10px 16px",
                color: editing.color || currentColor || (isDark ? "#ffffff" : INK),
                caretColor: editing.color || currentColor || (isDark ? "#ffffff" : INK),
                unicodeBidi: "plaintext",
              }}
            />
          )}

          {/* Overlay surface for drawing strokes / shapes */}
          {overlayOn && !editing && (
            <div
              className="absolute left-0 top-0"
              style={{
                width: BOARD_W,
                height: BOARD_H,
                cursor: tool === "text" ? "text" : tool === "pan" ? "grab" : "crosshair",
                touchAction: "none",
              }}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
            />
          )}

          {isEmpty && emptyHint && !readOnly && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center text-gray-400">
              <p style={{ fontSize: 52, fontWeight: 700 }}>Your thinking space</p>
              <p style={{ fontSize: 32, maxWidth: 1100, marginTop: 12, lineHeight: 1.4 }}>
                Draw shapes, write equations, add interactive simulations, or work collaboratively with AI.
              </p>
            </div>
          )}
          {isEmpty && readOnly && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-gray-400" style={{ fontSize: 44 }}>
              Nothing on the board
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
