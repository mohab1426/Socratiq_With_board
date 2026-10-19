import { BoardWorkspace } from "@/components/socratiq/BoardWorkspace"
import { EMPTY_BOARD } from "@/lib/whiteboard"

export default function SmartBoardDemo() {
  return (
    <div className="w-screen h-screen">
      <BoardWorkspace
        assignmentId="demo-assignment"
        initial={EMPTY_BOARD}
        busy={false}
        onAsk={(intent, msg) => console.log("onAsk", intent, msg)}
      />
    </div>
  )
}
