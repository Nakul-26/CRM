"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentUser } from "@/hooks/use-auth";
import { useCreateScoringRule, useDeleteScoringRule, useScoringRules } from "@/hooks/use-lead-scoring-rules";
import { ApiError } from "@/lib/http";
import { LEAD_SCORING_FIELDS, LEAD_SCORING_OPERATORS, type LeadScoringField, type LeadScoringOperator, type LeadScoringRuleDto } from "@sales-platform/contracts";

export default function LeadScoringPage() {
  const { data: currentUser } = useCurrentUser();
  const { data: rules, isLoading } = useScoringRules();
  const create = useCreateScoringRule();
  const remove = useDeleteScoringRule();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [field, setField] = useState<LeadScoringField>("source");
  const [operator, setOperator] = useState<LeadScoringOperator>("equals");
  const [value, setValue] = useState("");
  const [points, setPoints] = useState("10");

  const canManage = currentUser?.permissions.includes("leads.scoring.manage");

  const parseValue = (): string | number | string[] | undefined => {
    if (operator === "isBusinessEmail") return undefined;
    if (operator === "in") return value.split(",").map((v) => v.trim()).filter(Boolean);
    if (operator === "greaterThan" || operator === "lessThan") return Number(value);
    return value;
  };

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({ name, field, operator, value: parseValue(), points: Number(points), active: true });
      setDialogOpen(false);
      setName("");
      setValue("");
      setPoints("10");
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to create scoring rule");
    }
  };

  const onDelete = (rule: LeadScoringRuleDto) => {
    if (window.confirm(`Delete scoring rule "${rule.name}"?`)) remove.mutate(rule.id);
  };

  const columns: DataTableColumn<LeadScoringRuleDto>[] = [
    { header: "Name", cell: (r) => r.name },
    { header: "Field", cell: (r) => r.field },
    { header: "Operator", cell: (r) => r.operator },
    { header: "Value", cell: (r) => (Array.isArray(r.value) ? r.value.join(", ") : r.value ?? "—") },
    { header: "Points", cell: (r) => r.points },
    { header: "Active", cell: (r) => (r.active ? "Yes" : "No") },
  ];
  if (canManage) {
    columns.push({
      header: "",
      className: "text-right",
      cell: (r) => (
        <Button variant="outline" size="sm" onClick={() => onDelete(r)}>
          Delete
        </Button>
      ),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lead Scoring</h1>
          <p className="text-sm text-muted-foreground">
            Rules run against every lead on create/update; points from matching active rules are summed into its score.
          </p>
        </div>
        {canManage && <Button onClick={() => setDialogOpen(true)}>New Rule</Button>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scoring rules</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable data={rules} isLoading={isLoading} emptyMessage="No scoring rules yet." rowKey={(r) => r.id} columns={columns} />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen} title="New scoring rule">
        <form onSubmit={onCreate} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-name">Name</Label>
            <Input id="rule-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rule-field">Field</Label>
              <select
                id="rule-field"
                value={field}
                onChange={(e) => setField(e.target.value as LeadScoringField)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {LEAD_SCORING_FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rule-operator">Operator</Label>
              <select
                id="rule-operator"
                value={operator}
                onChange={(e) => setOperator(e.target.value as LeadScoringOperator)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {LEAD_SCORING_OPERATORS.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {operator !== "isBusinessEmail" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rule-value">{operator === "in" ? "Value (comma-separated)" : "Value"}</Label>
              <Input id="rule-value" value={value} onChange={(e) => setValue(e.target.value)} required />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-points">Points</Label>
            <Input id="rule-points" type="number" value={points} onChange={(e) => setPoints(e.target.value)} required />
          </div>
          <Button type="submit" disabled={create.isPending} className="self-start">
            {create.isPending ? "Saving..." : "Create rule"}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
      </Dialog>
    </div>
  );
}
