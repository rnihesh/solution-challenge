"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Header, Footer } from "@/components/layout";
import { useAuth } from "@/contexts/AuthContext";
import { communityApi, issuesApi, type CommunityPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  ArrowUpRight,
  CalendarDays,
  Loader2,
  MapPin,
  Megaphone,
  MessageSquare,
  Send,
  Sparkles,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";

type FeedFilter = "ALL" | "DISCUSSION" | "EVENT" | "ISSUE_ADOPTION" | "NGO_UPDATE";

interface OpenIssueOption {
  id: string;
  type: string;
  description: string;
  status: string;
  municipalityId?: string;
  imageUrls?: string[];
  location?: {
    address?: string;
  };
}

const POST_TYPE_OPTIONS: Array<{
  value: Exclude<FeedFilter, "ALL">;
  label: string;
  description: string;
  icon: LucideIcon;
  signedInOnly?: boolean;
}> = [
  {
    value: "DISCUSSION",
    label: "Discussion",
    description: "Talk with neighbors, volunteers, and local groups.",
    icon: MessageSquare,
  },
  {
    value: "EVENT",
    label: "Volunteer Event",
    description: "Post cleanups, awareness drives, and community meetups.",
    icon: CalendarDays,
    signedInOnly: true,
  },
  {
    value: "ISSUE_ADOPTION",
    label: "Issue Adoption",
    description: "Create a coordination card for an unresolved issue.",
    icon: Target,
    signedInOnly: true,
  },
  {
    value: "NGO_UPDATE",
    label: "NGO Update",
    description: "Share progress, campaigns, and field updates.",
    icon: Megaphone,
    signedInOnly: true,
  },
];

const FEED_FILTERS: Array<{ value: FeedFilter; label: string }> = [
  { value: "ALL", label: "All Posts" },
  { value: "DISCUSSION", label: "Discussions" },
  { value: "EVENT", label: "Events" },
  { value: "ISSUE_ADOPTION", label: "Adoptions" },
  { value: "NGO_UPDATE", label: "NGO Updates" },
];

function getPostMeta(type: CommunityPost["type"]) {
  switch (type) {
    case "EVENT":
      return {
        label: "Volunteer Event",
        icon: CalendarDays,
        badgeClass: "border-sky-200 bg-sky-50 text-sky-700",
      };
    case "ISSUE_ADOPTION":
      return {
        label: "Issue Adoption",
        icon: Target,
        badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
      };
    case "NGO_UPDATE":
      return {
        label: "NGO Update",
        icon: Megaphone,
        badgeClass: "border-violet-200 bg-violet-50 text-violet-700",
      };
    default:
      return {
        label: "Discussion",
        icon: MessageSquare,
        badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
      };
  }
}

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatEventDate(value: string | null) {
  if (!value) {
    return "Date to be announced";
  }

  return new Date(value).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function issueOptionLabel(issue: OpenIssueOption) {
  const typeLabel = issue.type.replace(/_/g, " ");
  const locationLabel = issue.location?.address?.trim()
    ? issue.location.address
    : issue.description;
  return `${typeLabel} • ${locationLabel}`;
}

export default function CommunityPage() {
  const { user, userProfile, getToken } = useAuth();
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [openIssues, setOpenIssues] = useState<OpenIssueOption[]>([]);
  const [activeFilter, setActiveFilter] = useState<FeedFilter>("ALL");
  const [loading, setLoading] = useState(true);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [replyingPostId, setReplyingPostId] = useState<string | null>(null);
  const [adoptingPostId, setAdoptingPostId] = useState<string | null>(null);
  const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>(
    {}
  );
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [composer, setComposer] = useState({
    type: "DISCUSSION" as Exclude<FeedFilter, "ALL">,
    title: "",
    body: "",
    organizerName: "",
    eventDate: "",
    eventLocation: "",
    issueId: "",
  });

  const allowedPostTypes = POST_TYPE_OPTIONS.filter(
    (option) => user || !option.signedInOnly
  );

  const upcomingEvents = posts.filter(
    (post) =>
      post.type === "EVENT" &&
      post.eventDate &&
      new Date(post.eventDate).getTime() >= Date.now()
  ).length;
  const activeAdoptions = posts.filter(
    (post) =>
      post.type === "ISSUE_ADOPTION" &&
      post.issueLink?.status === "OPEN"
  ).length;
  const totalReplies = posts.reduce(
    (sum, post) => sum + post.replies.length,
    0
  );

  async function loadPosts(filter: FeedFilter) {
    setLoading(true);
    try {
      const response = await communityApi.getPosts({
        type: filter === "ALL" ? undefined : filter,
        pageSize: 100,
      });

      if (response.success && response.data?.items) {
        setPosts(response.data.items);
      } else {
        setPosts([]);
        toast.error(response.error || "Failed to load community posts");
      }
    } catch (error) {
      console.error("Error loading community posts:", error);
      setPosts([]);
      toast.error("Failed to load community posts");
    } finally {
      setLoading(false);
    }
  }

  async function loadOpenIssues() {
    if (!user) {
      setOpenIssues([]);
      return;
    }

    setIssuesLoading(true);
    try {
      const response = await issuesApi.getAll({
        status: ["OPEN"],
        pageSize: 100,
      });

      if (response.success && response.data?.items) {
        setOpenIssues(response.data.items as unknown as OpenIssueOption[]);
      } else {
        setOpenIssues([]);
      }
    } catch (error) {
      console.error("Error loading open issues:", error);
      setOpenIssues([]);
    } finally {
      setIssuesLoading(false);
    }
  }

  useEffect(() => {
    void loadPosts(activeFilter);
  }, [activeFilter]);

  useEffect(() => {
    void loadOpenIssues();
  }, [user]);

  useEffect(() => {
    if (!user && composer.type !== "DISCUSSION") {
      setComposer((prev) => ({ ...prev, type: "DISCUSSION", issueId: "" }));
    }
  }, [composer.type, user]);

  async function handleCreatePost() {
    if (!composer.title.trim() || !composer.body.trim()) {
      toast.error("Add a title and description before posting");
      return;
    }

    if (!user && composer.type !== "DISCUSSION") {
      toast.error("Sign in to publish events, NGO updates, or adoption cards");
      return;
    }

    setSubmitting(true);
    try {
      const token = user ? await getToken() : null;
      const response = await communityApi.createPost(
        {
          type: composer.type,
          title: composer.title.trim(),
          body: composer.body.trim(),
          organizerName: composer.organizerName.trim() || null,
          eventDate: composer.eventDate || null,
          eventLocation: composer.eventLocation.trim() || null,
          issueId: composer.issueId || null,
        },
        token
      );

      if (response.success) {
        toast.success(
          composer.type === "DISCUSSION"
            ? "Community post shared"
            : "Community card published"
        );
        setComposer({
          type: "DISCUSSION",
          title: "",
          body: "",
          organizerName: "",
          eventDate: "",
          eventLocation: "",
          issueId: "",
        });
        setActiveFilter("ALL");
        await loadPosts("ALL");
        await loadOpenIssues();
      } else {
        toast.error(response.error || "Failed to publish post");
      }
    } catch (error) {
      console.error("Error creating community post:", error);
      toast.error("Failed to publish post");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReply(postId: string) {
    const body = replyDrafts[postId]?.trim();
    if (!body) {
      toast.error("Write a reply before sending it");
      return;
    }

    setReplyingPostId(postId);
    try {
      const token = user ? await getToken() : null;
      const response = await communityApi.addReply(postId, { body }, token);

      if (response.success && response.data) {
        setPosts((currentPosts) =>
          currentPosts.map((post) =>
            post.id === postId
              ? { ...post, replies: [...post.replies, response.data!] }
              : post
          )
        );
        setReplyDrafts((currentDrafts) => ({ ...currentDrafts, [postId]: "" }));
        setExpandedThreads((current) => ({ ...current, [postId]: true }));
        toast.success(
          user ? "Reply added to the thread" : "Reply added as Anonymous Citizen"
        );
      } else {
        toast.error(response.error || "Failed to add reply");
      }
    } catch (error) {
      console.error("Error adding reply:", error);
      toast.error("Failed to add reply");
    } finally {
      setReplyingPostId(null);
    }
  }

  async function handleAdopt(postId: string) {
    if (!user) {
      toast.error("Sign in to join an issue adoption card");
      return;
    }

    setAdoptingPostId(postId);
    try {
      const token = await getToken();
      if (!token) {
        toast.error("Sign in again to join this adoption card");
        return;
      }

      const response = await communityApi.adoptIssue(postId, token);
      if (response.success && response.data) {
        setPosts((currentPosts) =>
          currentPosts.map((post) =>
            post.id === postId
              ? { ...post, adopters: response.data!.adopters }
              : post
          )
        );
        toast.success(
          response.data.alreadyJoined
            ? "You are already part of this adoption card"
            : "You joined this issue adoption card"
        );
      } else {
        toast.error(response.error || "Failed to join issue adoption");
      }
    } catch (error) {
      console.error("Error joining issue adoption:", error);
      toast.error("Failed to join issue adoption");
    } finally {
      setAdoptingPostId(null);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.10),_transparent_40%),linear-gradient(to_bottom,_#f7faf9,_#ffffff)]">
      <Header />

      <main className="flex-1">
        <section className="border-b border-emerald-100/80 bg-white/70 backdrop-blur">
          <div className="container px-4 py-10 md:py-14">
            <div className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr] lg:items-end">
              <div className="space-y-4">
                <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                  <Sparkles className="mr-1 h-3.5 w-3.5" />
                  Community Feed
                </Badge>
                <div className="space-y-3">
                  <h1 className="text-3xl font-bold tracking-tight text-slate-900 md:text-5xl">
                    NGOs, volunteers, and residents in one shared civic space.
                  </h1>
                  <p className="max-w-2xl text-sm leading-6 text-slate-600 md:text-base">
                    Share cleanup drives, publish NGO updates, adopt unresolved
                    issues, and keep the conversation open for both signed-in and
                    anonymous citizens.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 text-sm text-slate-600">
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
                    Anonymous discussion supported
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
                    Threaded replies for coordination
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
                    Live issue adoption cards
                  </span>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                <Card className="border-emerald-100 bg-white/90 shadow-sm">
                  <CardContent className="p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                      Feed Posts
                    </p>
                    <p className="mt-2 text-2xl font-bold text-slate-900">{posts.length}</p>
                  </CardContent>
                </Card>
                <Card className="border-amber-100 bg-white/90 shadow-sm">
                  <CardContent className="p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                      Active Adoptions
                    </p>
                    <p className="mt-2 text-2xl font-bold text-slate-900">{activeAdoptions}</p>
                  </CardContent>
                </Card>
                <Card className="border-sky-100 bg-white/90 shadow-sm">
                  <CardContent className="p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                      Replies Shared
                    </p>
                    <p className="mt-2 text-2xl font-bold text-slate-900">{totalReplies}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {upcomingEvents} upcoming events
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </section>

        <section className="container px-4 py-8">
          <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
            <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
              <Card className="border-emerald-100 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-xl text-slate-900">
                    Start a Community Post
                  </CardTitle>
                  <CardDescription>
                    {user
                      ? `Posting as ${userProfile?.displayName || "Community Member"}`
                      : "You can post discussions anonymously. Sign in for events, NGO updates, and issue adoption."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                      Post Type
                    </label>
                    <Select
                      value={composer.type}
                      onValueChange={(value) =>
                        setComposer((prev) => ({
                          ...prev,
                          type: value as Exclude<FeedFilter, "ALL">,
                          issueId: value === "ISSUE_ADOPTION" ? prev.issueId : "",
                          eventDate: value === "EVENT" ? prev.eventDate : "",
                          eventLocation: value === "EVENT" ? prev.eventLocation : "",
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {allowedPostTypes.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-slate-500">
                      {
                        allowedPostTypes.find((option) => option.value === composer.type)
                          ?.description
                      }
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                      Title
                    </label>
                    <Input
                      placeholder="Give your post a short, clear title"
                      value={composer.title}
                      onChange={(event) =>
                        setComposer((prev) => ({
                          ...prev,
                          title: event.target.value,
                        }))
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                      Details
                    </label>
                    <Textarea
                      rows={5}
                      placeholder="Share updates, plans, cleanup details, or context for the neighborhood."
                      value={composer.body}
                      onChange={(event) =>
                        setComposer((prev) => ({
                          ...prev,
                          body: event.target.value,
                        }))
                      }
                    />
                  </div>

                  {(composer.type === "EVENT" || composer.type === "NGO_UPDATE") && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700">
                        Organizer / NGO Name
                      </label>
                      <Input
                        placeholder="Example: Hyderabad River Watch"
                        value={composer.organizerName}
                        onChange={(event) =>
                          setComposer((prev) => ({
                            ...prev,
                            organizerName: event.target.value,
                          }))
                        }
                      />
                    </div>
                  )}

                  {composer.type === "EVENT" && (
                    <>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700">
                          Event Date and Time
                        </label>
                        <Input
                          type="datetime-local"
                          value={composer.eventDate}
                          onChange={(event) =>
                            setComposer((prev) => ({
                              ...prev,
                              eventDate: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700">
                          Event Location
                        </label>
                        <Input
                          placeholder="Lake bund, ward office, main street, etc."
                          value={composer.eventLocation}
                          onChange={(event) =>
                            setComposer((prev) => ({
                              ...prev,
                              eventLocation: event.target.value,
                            }))
                          }
                        />
                      </div>
                    </>
                  )}

                  {composer.type === "ISSUE_ADOPTION" && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700">
                        Link an Open Issue
                      </label>
                      <Select
                        value={composer.issueId}
                        onValueChange={(value) =>
                          setComposer((prev) => ({ ...prev, issueId: value }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              issuesLoading
                                ? "Loading unresolved issues..."
                                : "Select an unresolved issue"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {openIssues.map((issue) => (
                            <SelectItem key={issue.id} value={issue.id}>
                              {issueOptionLabel(issue)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-slate-500">
                        Only open issues can be turned into adoption cards.
                      </p>
                    </div>
                  )}

                  <Button
                    className="w-full bg-emerald-600 hover:bg-emerald-700"
                    onClick={handleCreatePost}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Publishing...
                      </>
                    ) : (
                      <>
                        <Send className="mr-2 h-4 w-4" />
                        Publish to Community
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base text-slate-900">
                    How this space works
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-slate-600">
                  <p>Anonymous citizens can start discussions and join threads.</p>
                  <p>Signed-in users can publish events, NGO updates, and issue adoption cards.</p>
                  <p>Adoption cards stay focused on unresolved issues so volunteers can coordinate around real needs.</p>
                  {!user && (
                    <Button asChild variant="outline" className="w-full">
                      <Link href="/auth/login">
                        Sign in for volunteer tools
                      </Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {FEED_FILTERS.map((filter) => (
                  <Button
                    key={filter.value}
                    variant={activeFilter === filter.value ? "default" : "outline"}
                    className={
                      activeFilter === filter.value
                        ? "bg-slate-900 hover:bg-slate-800"
                        : ""
                    }
                    onClick={() => setActiveFilter(filter.value)}
                  >
                    {filter.label}
                  </Button>
                ))}
              </div>

              {loading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((item) => (
                    <Card key={item} className="border-slate-200">
                      <CardContent className="p-5">
                        <div className="space-y-3">
                          <Skeleton className="h-5 w-40" />
                          <Skeleton className="h-4 w-64" />
                          <Skeleton className="h-20 w-full" />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : posts.length === 0 ? (
                <Card className="border-dashed border-slate-300 bg-white/90 shadow-sm">
                  <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
                    <Users className="h-10 w-10 text-slate-400" />
                    <div className="space-y-1">
                      <h3 className="text-lg font-semibold text-slate-900">
                        No community posts yet
                      </h3>
                      <p className="text-sm text-slate-500">
                        Start the first discussion, event, or adoption card for your area.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                posts.map((post) => {
                  const meta = getPostMeta(post.type);
                  const Icon = meta.icon;
                  const isThreadExpanded = expandedThreads[post.id] ?? post.replies.length > 0;
                  const hasJoined = Boolean(
                    user && post.adopters.some((adopter) => adopter.uid === user.uid)
                  );

                  return (
                    <Card key={post.id} className="border-slate-200 bg-white/95 shadow-sm">
                      <CardContent className="p-5">
                        <div className="space-y-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="space-y-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge className={meta.badgeClass}>
                                  <Icon className="mr-1 h-3.5 w-3.5" />
                                  {meta.label}
                                </Badge>
                                {post.organizerName ? (
                                  <Badge variant="outline" className="border-slate-200 text-slate-600">
                                    {post.organizerName}
                                  </Badge>
                                ) : null}
                                {post.author.isAnonymous ? (
                                  <Badge variant="outline" className="border-slate-200 text-slate-500">
                                    Anonymous Citizen
                                  </Badge>
                                ) : null}
                              </div>
                              <div>
                                <h2 className="text-xl font-semibold text-slate-900">
                                  {post.title}
                                </h2>
                                <p className="mt-1 text-sm text-slate-500">
                                  {post.author.displayName} • {formatRelativeTime(post.createdAt)}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 text-xs text-slate-500">
                              <Users className="h-4 w-4" />
                              <span>
                                {post.adopters.length} supporter{post.adopters.length === 1 ? "" : "s"}
                              </span>
                            </div>
                          </div>

                          <p className="text-sm leading-6 text-slate-700">{post.body}</p>

                          {post.type === "EVENT" && (
                            <div className="grid gap-3 rounded-2xl border border-sky-100 bg-sky-50/80 p-4 sm:grid-cols-2">
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                                  Event Schedule
                                </p>
                                <p className="mt-1 text-sm font-medium text-slate-900">
                                  {formatEventDate(post.eventDate)}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                                  Meetup Location
                                </p>
                                <p className="mt-1 text-sm font-medium text-slate-900">
                                  {post.eventLocation || "Shared in thread"}
                                </p>
                              </div>
                            </div>
                          )}

                          {post.type === "ISSUE_ADOPTION" && post.issueLink && (
                            <div className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/80">
                              <div className="grid gap-4 p-4 sm:grid-cols-[120px_minmax(0,1fr)]">
                                {post.issueLink.imageUrl ? (
                                  <img
                                    src={post.issueLink.imageUrl}
                                    alt={post.issueLink.description}
                                    className="h-28 w-full rounded-xl object-cover"
                                  />
                                ) : (
                                  <div className="flex h-28 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                                    <Target className="h-7 w-7" />
                                  </div>
                                )}

                                <div className="space-y-3">
                                  <div>
                                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                                      Linked Unresolved Issue
                                    </p>
                                    <p className="mt-1 text-sm font-semibold text-slate-900">
                                      {post.issueLink.type.replace(/_/g, " ")}
                                    </p>
                                    <p className="mt-1 text-sm text-slate-700">
                                      {post.issueLink.description}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                                    {post.issueLink.address ? (
                                      <span className="inline-flex items-center gap-1">
                                        <MapPin className="h-3.5 w-3.5" />
                                        {post.issueLink.address}
                                      </span>
                                    ) : null}
                                    <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 font-medium text-amber-700">
                                      {post.issueLink.status}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    <Button
                                      size="sm"
                                      className="bg-amber-600 hover:bg-amber-700"
                                      onClick={() => void handleAdopt(post.id)}
                                      disabled={adoptingPostId === post.id || hasJoined}
                                    >
                                      {adoptingPostId === post.id ? (
                                        <>
                                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                          Joining...
                                        </>
                                      ) : hasJoined ? (
                                        "Already Joined"
                                      ) : (
                                        "Join Adoption Card"
                                      )}
                                    </Button>
                                    <Button asChild size="sm" variant="outline">
                                      <Link href="/map">
                                        View on Map
                                        <ArrowUpRight className="ml-1 h-4 w-4" />
                                      </Link>
                                    </Button>
                                  </div>
                                </div>
                              </div>

                              {post.adopters.length > 0 && (
                                <div className="border-t border-amber-200 bg-white/70 px-4 py-3">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Coordinating Now
                                  </p>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {post.adopters.map((adopter) => (
                                      <Badge
                                        key={`${post.id}-${adopter.uid}`}
                                        variant="outline"
                                        className="border-amber-200 bg-amber-50 text-amber-800"
                                      >
                                        {adopter.displayName}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <button
                                type="button"
                                className="text-sm font-medium text-slate-700 hover:text-slate-900"
                                onClick={() =>
                                  setExpandedThreads((current) => ({
                                    ...current,
                                    [post.id]: !isThreadExpanded,
                                  }))
                                }
                              >
                                {isThreadExpanded ? "Hide thread" : "Show thread"} •{" "}
                                {post.replies.length} repl{post.replies.length === 1 ? "y" : "ies"}
                              </button>
                              <span className="text-xs text-slate-500">
                                {user ? "Reply as your profile" : "Reply as Anonymous Citizen"}
                              </span>
                            </div>

                            {isThreadExpanded && (
                              <div className="mt-4 space-y-4">
                                {post.replies.length > 0 ? (
                                  <div className="space-y-3">
                                    {post.replies.map((reply) => (
                                      <div
                                        key={reply.id}
                                        className="rounded-xl border border-white bg-white px-4 py-3 shadow-sm"
                                      >
                                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                          <span className="font-semibold text-slate-700">
                                            {reply.author.displayName}
                                          </span>
                                          <span>•</span>
                                          <span>{formatRelativeTime(reply.createdAt)}</span>
                                        </div>
                                        <p className="mt-2 text-sm leading-6 text-slate-700">
                                          {reply.body}
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-sm text-slate-500">
                                    No replies yet. Start the thread for this post.
                                  </p>
                                )}

                                <div className="space-y-2">
                                  <Textarea
                                    rows={3}
                                    placeholder="Add context, coordination details, or support."
                                    value={replyDrafts[post.id] || ""}
                                    onChange={(event) =>
                                      setReplyDrafts((current) => ({
                                        ...current,
                                        [post.id]: event.target.value,
                                      }))
                                    }
                                  />
                                  <div className="flex justify-end">
                                    <Button
                                      size="sm"
                                      onClick={() => void handleReply(post.id)}
                                      disabled={replyingPostId === post.id}
                                    >
                                      {replyingPostId === post.id ? (
                                        <>
                                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                          Sending...
                                        </>
                                      ) : (
                                        <>
                                          <Send className="mr-2 h-4 w-4" />
                                          Add Reply
                                        </>
                                      )}
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
