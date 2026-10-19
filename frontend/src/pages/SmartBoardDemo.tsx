import { useState } from "react"
import { BoardWorkspace } from "@/components/socratiq/BoardWorkspace"
import { EMPTY_BOARD, fromServer, type Board } from "@/lib/whiteboard"

export default function SmartBoardDemo() {
  const [initialBoard] = useState<Board>(() => {
    try {
      const saved = localStorage.getItem("socratiq_demo_board")
      if (saved) return fromServer(JSON.parse(saved))
    } catch {
      // fallback to empty
    }
    return EMPTY_BOARD
  })

  return (
    <div className="w-screen h-screen">
      <BoardWorkspace
        assignmentId="demo-assignment"
        initial={initialBoard}
        busy={false}
        onAsk={(intent, msg) => console.log("onAsk", intent, msg)}
      />
    </div>
  )
}
