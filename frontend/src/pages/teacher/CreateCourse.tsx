import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { AppShell } from "@/components/layout/AppShell"
import { Card, CardContent } from "@/components/ui/Card"
import { Input } from "@/components/ui/Input"
import { Button } from "@/components/ui/Button"
import { ApiError } from "@/lib/api"
import { useCreateCourse } from "@/lib/queries"
import type { Course } from "@/types"

const colorOptions: { key: Course["color"]; swatch: string }[] = [
  { key: "plum", swatch: "bg-[var(--color-plum)]" },
  { key: "slate", swatch: "bg-[var(--color-slate)]" },
  { key: "teal", swatch: "bg-[var(--color-teal)]" },
  { key: "clay", swatch: "bg-[var(--color-clay)]" },
]

export default function CreateCourse() {
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [description, setDescription] = useState("")
  const [color, setColor] = useState<Course["color"]>("plum")
  const [error, setError] = useState<string | null>(null)
  const create = useCreateCourse()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name || !code) {
      setError("Give the course a name and a course code to continue.")
      return
    }
    try {
      const course = await create.mutateAsync({ code: code.trim(), title: name.trim(), description: description.trim(), color })
      navigate(`/teacher/courses/${course.id}`)      // the new course page shows the invite code students join with
    } catch (err) {
      setError(err instanceof ApiError ? (err.details?.[0]?.message ?? err.message) : "The course couldn't be created. Try again.")
    }
  }

  return (
    <AppShell
      role="teacher"
      crumbs={[{ label: "Courses", to: "/teacher/courses" }, { label: "New course" }]}
    >
      <h1 className="text-xl font-semibold text-[var(--color-ink)]">Create a course</h1>
      <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
        Set up a new virtual classroom. You'll get an invite code to share with students once it's created.
      </p>

      <Card className="mt-6 max-w-lg">
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit} noValidate>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-ink-soft)]">Course name</label>
              <Input placeholder="e.g. Physics — Section 4" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-ink-soft)]">Course code</label>
              <Input placeholder="e.g. PHYS 111" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-ink-soft)]">Description</label>
              <Input
                placeholder="What will students cover?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--color-ink-soft)]">Card color</label>
              <div className="flex gap-2">
                {colorOptions.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setColor(opt.key)}
                    aria-label={`Use ${opt.key} color`}
                    className={`h-8 w-8 rounded-full ${opt.swatch} ${
                      color === opt.key ? "ring-2 ring-[var(--color-ink)] ring-offset-2" : ""
                    }`}
                  />
                ))}
              </div>
            </div>

            {error && (
              <p role="alert" className="text-sm text-[var(--color-danger-ink)]">
                {error}
              </p>
            )}

            <div className="flex items-center justify-between pt-1">
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Creating…" : "Create course"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  )
}
