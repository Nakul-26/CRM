"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { KbArticleEditor } from "@/components/support/kb-article-editor";
import { useCurrentUser } from "@/hooks/use-auth";
import { useCreateKbArticle, useKbArticles } from "@/hooks/use-kb";
import { ApiError } from "@/lib/http";
import type { CreateKbArticleInput, KbArticleDto } from "@sales-platform/contracts";

export default function KbArticlesPage() {
  const { data: currentUser } = useCurrentUser();
  const [publishedFilter, setPublishedFilter] = useState<string>("");
  const { data: articles, isLoading } = useKbArticles({
    isPublished: publishedFilter === "" ? undefined : publishedFilter === "true",
  });
  const create = useCreateKbArticle();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = currentUser?.permissions.includes("support.kb.create");

  const onCreate = async (input: CreateKbArticleInput) => {
    setError(null);
    try {
      await create.mutateAsync(input);
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to create article");
    }
  };

  const columns: DataTableColumn<KbArticleDto>[] = [
    {
      header: "Title",
      cell: (a) => (
        <Link href={`/support/kb/${a.id}`} className="font-medium hover:underline">
          {a.title}
        </Link>
      ),
    },
    { header: "Category", cell: (a) => a.category ?? "—" },
    { header: "Status", cell: (a) => (a.isPublished ? "Published" : "Draft") },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Knowledge Base</h1>
          <p className="text-sm text-muted-foreground">Internal reference articles for the support team.</p>
        </div>
        {canCreate && <Button onClick={() => setDialogOpen(true)}>New Article</Button>}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">All articles</CardTitle>
          <select
            value={publishedFilter}
            onChange={(e) => setPublishedFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All</option>
            <option value="true">Published</option>
            <option value="false">Draft</option>
          </select>
        </CardHeader>
        <CardContent>
          <DataTable data={articles} isLoading={isLoading} emptyMessage="No articles yet." rowKey={(a) => a.id} columns={columns} />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen} title="New article" className="max-w-2xl">
        <KbArticleEditor onSubmit={onCreate} isPending={create.isPending} />
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </Dialog>
    </div>
  );
}
