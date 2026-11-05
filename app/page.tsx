import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="flex w-full max-w-md items-center justify-between">
        <h1 className="text-xl font-semibold">Ballroom Dash</h1>
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Foundations are up</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Database, auth, and the design system are wired. Phase 1 starts
          building real studios next.
        </CardContent>
      </Card>
    </div>
  );
}
