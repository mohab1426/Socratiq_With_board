// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import {
  doBoxesIntersect,
  estimateContentDimensions,
  findCollisionFreePosition,
  computeArrowEndpoints,
  planBatchLayout,
  getElementBoundingBox,
  readBoardState,
  verifyAndReflowLayout,
  type RectBox,
} from "./boardLayoutEngine"
import { EMPTY_BOARD, type Board, type BoardElement } from "./whiteboard"

describe("boardLayoutEngine", () => {
  describe("estimateContentDimensions", () => {
    it("estimates text dimensions based on character count and lines", () => {
      const shortText = estimateContentDimensions({ kind: "text", text: "Hello", fontSize: 24 })
      expect(shortText.w).toBeGreaterThanOrEqual(200)
      expect(shortText.h).toBeGreaterThanOrEqual(56)

      const multiLine = estimateContentDimensions({
        kind: "text",
        text: "Line 1: Problem Definition\nLine 2: Identify variables\nLine 3: Apply Pythagorean theorem",
        fontSize: 24,
      })
      expect(multiLine.h).toBeGreaterThan(shortText.h)
    })

    it("estimates equation dimensions distinguishing standard vs tall formulas", () => {
      const simple = estimateContentDimensions({ kind: "equation", latex: "a^2 + b^2 = c^2" })
      expect(simple.w).toBeGreaterThanOrEqual(240)
      expect(simple.h).toBe(96)

      const tall = estimateContentDimensions({ kind: "equation", latex: "\\frac{x + 1}{\\sqrt{x^2 - 4}}" })
      expect(tall.h).toBe(150)
    })

    it("estimates standard shapes, simulations and images", () => {
      const rect = estimateContentDimensions({ kind: "shape", width: 150, height: 100 })
      expect(rect.w).toBe(150)
      expect(rect.h).toBe(100)

      const circle = estimateContentDimensions({ kind: "circle", radius: 50 })
      expect(circle.w).toBe(100)
      expect(circle.h).toBe(100)

      const sim = estimateContentDimensions({ kind: "simulation" })
      expect(sim.w).toBe(480)
      expect(sim.h).toBe(360)
    })
  })

  describe("doBoxesIntersect and collision detection", () => {
    it("detects overlapping boxes with safety buffer", () => {
      const box1: RectBox = { x: 100, y: 100, w: 200, h: 100 }
      const box2: RectBox = { x: 150, y: 120, w: 200, h: 100 }
      expect(doBoxesIntersect(box1, box2)).toBe(true)

      const boxFar: RectBox = { x: 400, y: 400, w: 100, h: 100 }
      expect(doBoxesIntersect(box1, boxFar)).toBe(false)
    })

    it("handles rotated elements in bounding box calculation", () => {
      const el: BoardElement = {
        id: "e1",
        kind: "shape",
        author: "coach",
        seq: 1,
        x: 100,
        y: 100,
        w: 200,
        h: 100,
        rotation: 90,
      }
      const aabb = getElementBoundingBox(el)
      // At 90 degrees rotation, width and height swap
      expect(aabb.w).toBe(100)
      expect(aabb.h).toBe(200)
    })
  })

  describe("findCollisionFreePosition", () => {
    it("finds non-overlapping position away from existing student work", () => {
      const boardWithStudent: Board = {
        ...EMPTY_BOARD,
        elements: [
          {
            id: "s1",
            kind: "text",
            author: "student",
            seq: 1,
            x: 100,
            y: 100,
            w: 300,
            h: 120,
            text: "Student work: 2x + 4 = 10",
          },
        ],
      }

      // Trying to place at the exact same location (100, 100)
      const pos = findCollisionFreePosition(boardWithStudent, 250, 100, { x: 100, y: 100 })
      const candidate: RectBox = { x: pos.x, y: pos.y, w: 250, h: 100 }
      const studentBox: RectBox = { x: 100, y: 100, w: 300, h: 120 }

      expect(doBoxesIntersect(candidate, studentBox)).toBe(false)
      expect(pos.x).toBeGreaterThanOrEqual(32)
      expect(pos.y).toBeGreaterThanOrEqual(32)
    })
  })

  describe("computeArrowEndpoints", () => {
    it("calculates arrow endpoints at boundaries of shapes rather than centers", () => {
      const boxA: RectBox = { x: 100, y: 100, w: 100, h: 60 }
      const boxB: RectBox = { x: 300, y: 100, w: 100, h: 60 }

      const endpoints = computeArrowEndpoints(boxA, boxB)
      // BoxA right edge is at x=200; BoxB left edge is at x=300
      expect(endpoints.x1).toBe(200)
      expect(endpoints.x2).toBe(300)
      expect(endpoints.y1).toBe(130)
      expect(endpoints.y2).toBe(130)
    })
  })

  describe("planBatchLayout", () => {
    it("places multiple elements with distinct, non-overlapping positions in reading order", () => {
      const functionCalls = [
        { name: "write_text", args: { text: "Neural Network Architecture" } },
        { name: "draw_rectangle", args: { width: 120, height: 80 } },
        { name: "draw_circle", args: { radius: 40 } },
        { name: "add_equation", args: { latex: "y = \\sigma(Wx + b)" } },
        { name: "draw_arrow", args: {} },
      ]

      const plan = planBatchLayout(functionCalls, EMPTY_BOARD)
      expect(plan.items.length).toBe(5)

      // Verify that no two content boxes intersect
      for (let i = 0; i < plan.items.length; i++) {
        for (let j = i + 1; j < plan.items.length; j++) {
          const itemA = plan.items[i]
          const itemB = plan.items[j]
          if (itemA.kind !== "arrow" && itemB.kind !== "arrow") {
            const overlaps = doBoxesIntersect(itemA.box, itemB.box, 10)
            expect(overlaps).toBe(false)
          }
        }
      }
    })
  })

  describe("readBoardState", () => {
    it("analyzes student vs coach elements and occupancy fraction", () => {
      const board: Board = {
        ...EMPTY_BOARD,
        elements: [
          { id: "s1", kind: "text", author: "student", seq: 1, x: 50, y: 50, w: 200, h: 50, text: "Student idea" },
          { id: "c1", kind: "equation", author: "coach", seq: 2, x: 50, y: 150, w: 240, h: 80, latex: "E = mc^2" },
        ],
        strokes: [{ t: "p", w: 2, pts: [[10, 10], [20, 20]] }],
      }

      const analysis = readBoardState(board)
      expect(analysis.totalElements).toBe(2)
      expect(analysis.studentElements.length).toBe(1)
      expect(analysis.coachElements.length).toBe(1)
      expect(analysis.totalStrokes).toBe(1)
      expect(analysis.summary).toContain("Student idea")
      expect(analysis.occupiedAreaFraction).toBeGreaterThan(0)
    })
  })

  describe("verifyAndReflowLayout", () => {
    it("reflows coach elements when rendered DOM size causes overlap, strictly protecting student work", () => {
      const board: Board = {
        ...EMPTY_BOARD,
        elements: [
          { id: "s1", kind: "text", author: "student", seq: 1, x: 100, y: 100, w: 200, h: 60, text: "Student note" },
          { id: "c1", kind: "text", author: "coach", seq: 2, x: 100, y: 170, w: 200, h: 60, text: "Coach explanation" },
        ],
      }

      // DOM rendering produced a taller student note (height 90 instead of 60)
      // This now creates an overlap with coach explanation at y: 170
      const actualBounds: Record<string, RectBox> = {
        s1: { x: 100, y: 100, w: 200, h: 90 },
        c1: { x: 100, y: 170, w: 200, h: 60 },
      }

      const { needsReflow, updatedElements } = verifyAndReflowLayout(board, actualBounds, 20)
      expect(needsReflow).toBe(true)

      const studentEl = updatedElements.find((e) => e.id === "s1")!
      const coachEl = updatedElements.find((e) => e.id === "c1")!

      // Student work must NOT be moved!
      expect(studentEl.y).toBe(100)
      // Coach element must be shifted down to resolve collision (100 + 90 + 20 = 210)
      expect(coachEl.y).toBeGreaterThanOrEqual(210)
    })

    it("updates arrow endpoints when connected coach elements reflow", () => {
      const board: Board = {
        ...EMPTY_BOARD,
        elements: [
          { id: "s1", kind: "text", author: "student", seq: 1, x: 100, y: 100, w: 200, h: 60, text: "Student problem" },
          { id: "c1", kind: "shape", author: "coach", seq: 2, x: 100, y: 170, w: 200, h: 80, shape: "rect" },
          {
            id: "a1",
            kind: "arrow",
            author: "coach",
            seq: 3,
            x: 100,
            y: 250,
            w: 10,
            h: 50,
            x2: 100,
            y2: 300,
            fromId: "c1",
            toId: "c2",
          },
          { id: "c2", kind: "shape", author: "coach", seq: 4, x: 100, y: 300, w: 200, h: 80, shape: "rect" },
        ],
      }

      // Student box expands downwards to h: 100, forcing c1 to shift down
      const actualBounds: Record<string, RectBox> = {
        s1: { x: 100, y: 100, w: 200, h: 100 },
        c1: { x: 100, y: 170, w: 200, h: 80 },
        c2: { x: 100, y: 300, w: 200, h: 80 },
      }

      const { needsReflow, updatedElements } = verifyAndReflowLayout(board, actualBounds, 20)
      expect(needsReflow).toBe(true)

      const c1 = updatedElements.find((e) => e.id === "c1")!
      const a1 = updatedElements.find((e) => e.id === "a1")!
      const c2 = updatedElements.find((e) => e.id === "c2")!

      // c1 must be shifted down below s1 (100 + 100 + 20 = 220)
      expect(c1.y).toBeGreaterThanOrEqual(220)
      // c2 must also be shifted down below c1
      expect(c2.y).toBeGreaterThanOrEqual(c1.y + c1.h + 20)
      // Arrow endpoints must be updated to bridge the shifted elements
      expect(a1.y).toBeGreaterThanOrEqual(c1.y)
    })
  })

  describe("typography hierarchy and multi-column expansion", () => {
    it("assigns appropriate font sizes for headings, body, and annotations", () => {
      const heading = estimateContentDimensions({ kind: "text", text: "# Key Concept", role: "heading" })
      expect(heading.fontSize).toBe(32)

      const shortTitle = estimateContentDimensions({ kind: "text", text: "Step 1: Understand the Goal" })
      expect(shortTitle.fontSize).toBe(32)

      const body = estimateContentDimensions({ kind: "text", text: "Here is a standard paragraph of explanation." })
      expect(body.fontSize).toBe(24)

      const note = estimateContentDimensions({ kind: "text", text: "Note: keep in mind x > 0", role: "annotation" })
      expect(note.fontSize).toBe(18)
    })

    it("wraps to next column when vertical space in current column is full", () => {
      // Occupy column 1 with tall boxes
      const boardWithTallContent: Board = {
        ...EMPTY_BOARD,
        elements: [
          { id: "e1", kind: "shape", author: "student", seq: 1, x: 32, y: 32, w: 500, h: 1100, shape: "rect" },
        ],
      }

      const pos = findCollisionFreePosition(boardWithTallContent, 300, 200)
      // Because column 1 (x: 32) is filled to y: 1132, the position should advance to an adjacent column
      expect(pos.x).toBeGreaterThanOrEqual(300)
    })
  })
})

