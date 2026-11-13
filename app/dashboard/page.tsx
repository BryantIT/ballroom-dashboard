// app/dashboard/page.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Dashboard coming online</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        This is your studio&apos;s dashboard. Later phases will fill this in
        with real scheduling, student, and billing data.
      </CardContent>
    </Card>
  );
}
