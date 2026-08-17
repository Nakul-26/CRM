"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useAddTicketComment, useTicketComments } from "@/hooks/use-tickets";
import { ApiError } from "@/lib/http";

export function TicketCommentThread({ ticketId }: { ticketId: string }) {
  const { data: comments, isLoading } = useTicketComments(ticketId);
  const addComment = useAddTicketComment();

  const [body, setBody] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await addComment.mutateAsync({ id: ticketId, input: { body, isPublic } });
      setBody("");
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to add comment");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : comments && comments.length > 0 ? (
        <ul className="flex flex-col gap-3 text-sm">
          {comments.map((c) => (
            <li key={c.id} className="rounded-md border border-border p-3">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>{c.isPublic ? "Public reply" : "Internal note"}</span>
                <span>{new Date(c.createdAt).toLocaleString()}</span>
              </div>
              <p className="whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      )}

      <form onSubmit={submit} className="flex flex-col gap-2 border-t border-border pt-4">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Add a reply or internal note..."
          required
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={!isPublic} onChange={(e) => setIsPublic(!e.target.checked)} />
            Internal note (not visible to the customer)
          </label>
          <Button type="submit" size="sm" disabled={addComment.isPending}>
            {addComment.isPending ? "Posting..." : "Post"}
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </form>
    </div>
  );
}
