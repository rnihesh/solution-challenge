"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageSquareText, Send, UserRound, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { issuesApi, type IssueComment, type IssueCommentKind } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const COMMENT_KINDS: Array<{ value: IssueCommentKind; label: string }> = [
  { value: "CONTEXT", label: "Context" },
  { value: "WORSENED", label: "Worsened" },
  { value: "FIX_CONFIRMED", label: "Fix confirmed" },
];

function getCommentKindLabel(kind?: IssueCommentKind) {
  switch (kind) {
    case "GENERAL":
      return "General";
    case "WORSENED":
      return "Worsened";
    case "FIX_CONFIRMED":
      return "Fix confirmed";
    default:
      return "Context";
  }
}

function getCommentKindStyle(kind?: IssueCommentKind) {
  switch (kind) {
    case "GENERAL":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "WORSENED":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "FIX_CONFIRMED":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    default:
      return "border-sky-200 bg-sky-50 text-sky-800";
  }
}

function formatCommentTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function normalizeKind(kind?: IssueCommentKind): IssueCommentKind {
  return kind || "GENERAL";
}

interface IssueCommentsProps {
  issueId: string;
  comments?: IssueComment[];
  className?: string;
  compact?: boolean;
  maxVisibleComments?: number;
  onCommentAdded?: (comment: IssueComment) => void;
}

export function IssueComments({
  issueId,
  comments,
  className,
  compact = false,
  maxVisibleComments = 2,
  onCommentAdded,
}: IssueCommentsProps) {
  const { user, userProfile, getToken } = useAuth();
  const [localComments, setLocalComments] = useState<IssueComment[]>(
    comments ?? []
  );
  const [draft, setDraft] = useState("");
  const [draftKind, setDraftKind] = useState<IssueCommentKind>("CONTEXT");
  const [isAnonymous, setIsAnonymous] = useState(!user);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setLocalComments(comments ?? []);
  }, [comments]);

  useEffect(() => {
    if (!user) {
      setIsAnonymous(true);
    }
  }, [user]);

  const visibleComments = useMemo(
    () => localComments.slice(0, maxVisibleComments),
    [localComments, maxVisibleComments]
  );

  const remainingCount = Math.max(localComments.length - visibleComments.length, 0);
  const displayName =
    userProfile?.displayName || user?.displayName || "Citizen";

  const handleSubmit = async () => {
    const body = draft.trim();
    if (!body || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      const token = !isAnonymous && user ? await getToken() : undefined;
      const response = await issuesApi.addComment(
        issueId,
        {
          body,
          kind: draftKind,
          isAnonymous: isAnonymous || !user,
        },
        token
      );

      if (!response.success || !response.data) {
        toast.error(response.error || "Could not post comment");
        return;
      }

      const newComment: IssueComment = response.data;

      setLocalComments((prev) => [newComment, ...prev]);
      onCommentAdded?.(newComment);
      setDraft("");
      setDraftKind("CONTEXT");
      setIsComposerOpen(false);
      toast.success("Comment posted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not post comment");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-slate-200 bg-slate-50/70",
        compact ? "p-2.5" : "p-3",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <MessageSquareText className="h-4 w-4 text-sky-600 shrink-0" />
          <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-700">
            Public Comments
          </p>
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
            {localComments.length}
          </Badge>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px]"
          onClick={() => setIsComposerOpen((prev) => !prev)}
        >
          {isComposerOpen ? "Hide" : "Add"}
        </Button>
      </div>

      <div className="mt-2 space-y-2">
        {localComments.length === 0 ? (
          <p className="text-xs text-slate-600">
            No comments yet. Share context, mention if the issue got worse, or confirm the fix.
          </p>
        ) : (
          visibleComments.map((comment) => {
            const kind = normalizeKind(comment.kind);
            const isAnonymousAuthor = comment.author?.isAnonymous;
            return (
              <div
                key={comment.id}
                className="rounded-md border bg-white/85 p-2 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <UserRound className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                    <p className="truncate text-xs font-medium text-slate-800">
                      {isAnonymousAuthor
                        ? "Anonymous Citizen"
                        : comment.author?.displayName || "Citizen"}
                    </p>
                    <Badge
                      variant="outline"
                      className={cn(
                        "h-5 border px-1.5 text-[10px] font-medium",
                        getCommentKindStyle(kind)
                      )}
                    >
                      {getCommentKindLabel(kind)}
                    </Badge>
                  </div>
                  <span className="text-[10px] text-slate-500">
                    {formatCommentTime(comment.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-700">
                  {comment.body}
                </p>
              </div>
            );
          })
        )}

        {remainingCount > 0 ? (
          <p className="text-[11px] text-slate-500">
            +{remainingCount} more comment{remainingCount > 1 ? "s" : ""}
          </p>
        ) : null}
      </div>

      {isComposerOpen ? (
        <div className="mt-3 rounded-md border border-slate-200 bg-white p-2.5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {COMMENT_KINDS.map((kind) => (
              <Button
                key={kind.value}
                type="button"
                size="sm"
                variant={draftKind === kind.value ? "default" : "outline"}
                className="h-7 px-2 text-[11px]"
                onClick={() => setDraftKind(kind.value)}
              >
                {kind.label}
              </Button>
            ))}

            {user ? (
              <Button
                type="button"
                size="sm"
                variant={isAnonymous ? "secondary" : "outline"}
                className="h-7 px-2 text-[11px]"
                onClick={() => setIsAnonymous((prev) => !prev)}
              >
                {isAnonymous ? "Anonymous" : `As ${displayName}`}
              </Button>
            ) : (
              <div className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 text-[11px] text-slate-500">
                <RefreshCcw className="h-3 w-3" />
                <span>Anonymous</span>
              </div>
            )}
          </div>

          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add a short public update..."
            rows={compact ? 3 : 4}
            className="min-h-20 resize-none text-sm"
          />

          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[11px] text-slate-500">
              {isAnonymous || !user
                ? "Posting anonymously."
                : `Posting as ${displayName}.`}
            </p>
            <Button
              type="button"
              size="sm"
              className="h-8 px-3 text-[11px]"
              onClick={handleSubmit}
              disabled={isSubmitting || !draft.trim()}
            >
              <Send className="mr-1.5 h-3.5 w-3.5" />
              {isSubmitting ? "Posting..." : "Post"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default IssueComments;
