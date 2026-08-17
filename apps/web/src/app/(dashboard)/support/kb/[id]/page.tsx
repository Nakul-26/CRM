"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { KbArticleEditor } from "@/components/support/kb-article-editor";
import { useCurrentUser } from "@/hooks/use-auth";
import { useDeleteKbArticle, useKbArticle, usePublishKbArticle, useUnpublishKbArticle, useUpdateKbArticle } from "@/hooks/use-kb";
import { ApiError } from "@/lib/http";
import type { CreateKbArticleInput } from "@sales-platform/contracts";

export default function KbArticleDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: currentUser } = useCurrentUser();
  const { data: article, isLoading } = useKbArticle(id);
  const updateArticle = useUpdateKbArticle();
  const deleteArticle = useDeleteKbArticle();
  const publish = usePublishKbArticle();
  const unpublish = useUnpublishKbArticle();

  const [editOpen, setEditOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = currentUser?.permissions.includes("support.kb.edit");
  const canDelete = currentUser?.permissions.includes("support.kb.delete");

  const runAction = async (action: () => Promise<unknown>, message: string) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : message);
    }
  };

  const onUpdate = async (input: CreateKbArticleInput) => {
    if (!article) return;
    setError(null);
    try {
      await updateArticle.mutateAsync({ id: article.id, input });
      setEditOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to update article");
    }
  };

  const onDelete = async () => {
    if (!article) return;
    if (!window.confirm(`Delete article "${article.title}"? This cannot be undone.`)) return;
    await deleteArticle.mutateAsync(article.id);
    window.location.href = "/support/kb";
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!article) return <p className="text-sm text-muted-foreground">Article not found.</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/support/kb" className="text-sm text-muted-foreground hover:underline">
            ← Knowledge Base
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{article.title}</h1>
          <p className="text-sm text-muted-foreground">/{article.slug}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && article.isPublished && (
            <Button variant="outline" onClick={() => runAction(() => unpublish.mutateAsync(article.id), "Failed to unpublish")}>
              Unpublish
            </Button>
          )}
          {canEdit && !article.isPublished && (
            <Button onClick={() => runAction(() => publish.mutateAsync(article.id), "Failed to publish")}>Publish</Button>
          )}
          {canEdit && (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          )}
          {canDelete && (
            <Button variant="destructive" onClick={onDelete}>
              Delete
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{article.isPublished ? "Published" : "Draft"}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex gap-4 text-muted-foreground">
            {article.category && <span>Category: {article.category}</span>}
            {article.tags.length > 0 && <span>Tags: {article.tags.join(", ")}</span>}
          </div>
          <p className="whitespace-pre-wrap">{article.body}</p>
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen} title="Edit article" className="max-w-2xl">
        <KbArticleEditor initialArticle={article} onSubmit={onUpdate} submitLabel="Save changes" isPending={updateArticle.isPending} />
      </Dialog>
    </div>
  );
}
