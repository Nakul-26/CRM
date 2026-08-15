import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Ships in {phase} — see docs/architecture/overview.md for the phased build plan.</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        The navigation and route are in place; the feature itself is built in a later phase so the module boundary
        (and this page) doesn't need to change when it lands.
      </CardContent>
    </Card>
  );
}
