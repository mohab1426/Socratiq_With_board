import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

export interface JourneyStep {
  label: string
  state: "done" | "current" | "upcoming"
}

export function LearningJourney({ steps }: { steps: JourneyStep[] }) {
  return (
    <ol className="flex w-full items-center gap-0" aria-label="Learning journey">
      {steps.map((step, i) => (
        <li key={step.label} aria-current={step.state === "current" ? "step" : undefined} className="flex min-w-0 flex-1 items-start">
          <div className="flex min-w-0 flex-col items-center gap-1.5">
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold",
                step.state === "done" && "bg-[var(--color-teal)] text-[var(--color-on-teal)]",
                step.state === "current" && "bg-[var(--color-plum)] text-[var(--color-on-plum)]",
                step.state === "upcoming" && "bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)] border border-[var(--color-border-strong)]"
              )}
            >
              {step.state === "done" ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span
              className={cn(
                "w-full max-w-[6.5rem] text-center text-xs",
                step.state === "upcoming" ? "text-[var(--color-ink-muted)]" : "font-semibold text-[var(--color-ink)]"
              )}
            >
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={cn(
                "mx-1 mt-3 h-px min-w-2 flex-1",
                step.state === "done" ? "bg-[var(--color-teal)]" : "bg-[var(--color-border-strong)]"
              )}
            />
          )}
        </li>
      ))}
    </ol>
  )
}
