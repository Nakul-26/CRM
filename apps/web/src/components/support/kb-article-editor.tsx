"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CreateKbArticleInput, KbArticleDto } from "@sales-platform/contracts";

function slugify(title: string) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function KbArticleEditor({
  initialArticle,
  onSubmit,
  submitLabel = "Create",
  isPending,
}: {
  initialArticle?: KbArticleDto;
  onSubmit: (input: CreateKbArticleInput) => void;
  submitLabel?: string;
  isPending?: boolean;
}) {
  const isEditing = Boolean(initialArticle?.id);
  const [title, setTitle] = useState(initialArticle?.title ?? "");
  const [slug, setSlug] = useState(initialArticle?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(isEditing);
  const [category, setCategory] = useState(initialArticle?.category ?? "");
  const [tags, setTags] = useState(initialArticle?.tags.join(", ") ?? "");
  const [body, setBody] = useState(initialArticle?.body ?? "");

  const onTitleChange = (value: string) => {
    setTitle(value);
    if (!slugTouched) setSlug(slugify(value));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      title,
      slug,
      category: category || undefined,
      body,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="kb-title">Title</Label>
        <Input id="kb-title" value={title} onChange={(e) => onTitleChange(e.target.value)} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="kb-slug">Slug</Label>
        <Input
          id="kb-slug"
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            setSlugTouched(true);
          }}
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="kb-category">Category</Label>
          <Input id="kb-category" value={category ?? ""} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="kb-tags">Tags (comma-separated)</Label>
          <Input id="kb-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="kb-body">Body</Label>
        <textarea
          id="kb-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          required
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
