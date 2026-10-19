import { AppShell } from "@/components/layout/AppShell"
import { Card, CardContent } from "@/components/ui/Card"
import { Input } from "@/components/ui/Input"
import { Button } from "@/components/ui/Button"
import { useAuth } from "@/lib/auth"
import type { Role } from "@/types"

export default function Settings({ role }: { role: Role }) {
  const { me, signOut } = useAuth()

  return (
    <AppShell role={role} crumbs={[{ label: role === "student" ? "Home" : "Dashboard", to: role === "student" ? "/student" : "/teacher" }, { label: "Settings" }]}>
      <Card className="max-w-lg">
        <CardContent className="space-y-4">
          <h1 className="text-lg font-semibold text-[var(--color-ink)]">Account</h1>
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-ink-soft)]">Name</label>
            <Input value={me?.name ?? ""} readOnly aria-readonly />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-ink-soft)]">Email</label>
            <Input value={me?.email ?? ""} readOnly aria-readonly type="email" />
          </div>
          <p className="text-xs text-[var(--color-ink-faint)]">Your name and email come from your account. Ask your institution's administrator to change them.</p>
          <Button variant="outline" onClick={signOut}>Log out</Button>
        </CardContent>
      </Card>
    </AppShell>
  )
}
