import { Router, Response } from "express";
import type { Router as IRouter } from "express";
import { getAdminDb, COLLECTIONS } from "../shared/firebase";
import {
  createCommunityPostInputSchema,
  createCommunityReplyInputSchema,
  communityPostTypeSchema,
  paginationSchema,
} from "../shared/validation";
import {
  authMiddleware,
  optionalAuthMiddleware,
  AuthenticatedRequest,
} from "../middleware/auth";
import type {
  CommunityAdopter,
  CommunityAuthor,
  CommunityIssueLink,
  CommunityPost,
  CommunityReply,
  Issue,
} from "../shared/types";

const router: IRouter = Router();

function toDateValue(value: any): Date | null {
  if (!value) {
    return null;
  }

  if (typeof value?.toDate === "function") {
    return value.toDate();
  }

  return new Date(value);
}

function serializeCommunityPostDocument(
  doc:
    | FirebaseFirestore.QueryDocumentSnapshot
    | FirebaseFirestore.DocumentSnapshot
) {
  const data = doc.data();

  if (!data) {
    return null;
  }

  return {
    id: doc.id,
    ...data,
    eventDate: toDateValue(data.eventDate),
    createdAt: toDateValue(data.createdAt),
    updatedAt: toDateValue(data.updatedAt),
    adopters: Array.isArray(data.adopters)
      ? data.adopters.map((adopter: CommunityAdopter) => ({
          ...adopter,
          joinedAt: toDateValue(adopter.joinedAt),
        }))
      : [],
    replies: Array.isArray(data.replies)
      ? data.replies.map((reply: CommunityReply) => ({
          ...reply,
          createdAt: toDateValue(reply.createdAt),
        }))
      : [],
  };
}

function buildAuthor(req: AuthenticatedRequest): CommunityAuthor {
  if (req.user) {
    return {
      uid: req.user.uid,
      displayName: req.user.displayName,
      isAnonymous: false,
      role: req.user.role,
    };
  }

  return {
    uid: null,
    displayName: "Anonymous Citizen",
    isAnonymous: true,
    role: "ANONYMOUS",
  };
}

async function buildIssueLink(issueId: string): Promise<CommunityIssueLink | null> {
  const db = getAdminDb();
  const issueDoc = await db.collection(COLLECTIONS.ISSUES).doc(issueId).get();

  if (!issueDoc.exists) {
    return null;
  }

  const issueData = issueDoc.data() as Issue;

  return {
    issueId: issueDoc.id,
    type: issueData.type,
    description: issueData.description,
    status: issueData.status,
    imageUrl:
      issueData.imageUrls?.[0] || issueData.imageUrl || null,
    address: (issueData as any).location?.address || null,
    municipalityId: issueData.municipalityId,
  };
}

router.get("/posts", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getAdminDb();
    const { page, pageSize } = paginationSchema.parse(req.query);
    const typeQuery =
      typeof req.query.type === "string" && req.query.type.trim()
        ? req.query.type.trim()
        : null;

    let query: FirebaseFirestore.Query = db
      .collection(COLLECTIONS.COMMUNITY_POSTS)
      .orderBy("createdAt", "desc");

    if (typeQuery) {
      const parsedType = communityPostTypeSchema.safeParse(typeQuery);

      if (!parsedType.success) {
        return res.status(400).json({
          success: false,
          data: null,
          error: "Invalid community post type filter",
          timestamp: new Date().toISOString(),
        });
      }

      query = db
        .collection(COLLECTIONS.COMMUNITY_POSTS)
        .where("type", "==", parsedType.data)
        .orderBy("createdAt", "desc");
    }

    const [snapshot, countSnapshot] = await Promise.all([
      query
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .get(),
      query.count().get(),
    ]);

    const items = snapshot.docs
      .map((doc) => serializeCommunityPostDocument(doc))
      .filter(Boolean);
    const total = countSnapshot.data().count;

    res.json({
      success: true,
      data: {
        items,
        total,
        page,
        pageSize,
        hasMore: (page - 1) * pageSize + items.length < total,
      },
      error: null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching community posts:", error);
    res.status(500).json({
      success: false,
      data: null,
      error: "Failed to fetch community posts",
      timestamp: new Date().toISOString(),
    });
  }
});

router.post(
  "/posts",
  optionalAuthMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getAdminDb();
      const input = createCommunityPostInputSchema.parse(req.body);
      const author = buildAuthor(req);

      if (author.isAnonymous && input.type !== "DISCUSSION") {
        return res.status(401).json({
          success: false,
          data: null,
          error:
            "Sign in to publish events, NGO updates, or issue adoption cards",
          timestamp: new Date().toISOString(),
        });
      }

      let issueLink: CommunityIssueLink | null = null;
      let adopters: CommunityAdopter[] = [];

      if (input.type === "ISSUE_ADOPTION") {
        if (!req.user) {
          return res.status(401).json({
            success: false,
            data: null,
            error: "Sign in to adopt an unresolved issue",
            timestamp: new Date().toISOString(),
          });
        }

        issueLink = await buildIssueLink(input.issueId!);

        if (!issueLink) {
          return res.status(404).json({
            success: false,
            data: null,
            error: "Selected issue was not found",
            timestamp: new Date().toISOString(),
          });
        }

        if (issueLink.status !== "OPEN") {
          return res.status(400).json({
            success: false,
            data: null,
            error: "Only unresolved issues can be adopted by the community",
            timestamp: new Date().toISOString(),
          });
        }

        const existingAdoptionCard = await db
          .collection(COLLECTIONS.COMMUNITY_POSTS)
          .where("type", "==", "ISSUE_ADOPTION")
          .where("issueLink.issueId", "==", issueLink.issueId)
          .limit(1)
          .get();

        if (!existingAdoptionCard.empty) {
          return res.status(400).json({
            success: false,
            data: null,
            error: "This issue already has a community adoption card",
            timestamp: new Date().toISOString(),
          });
        }

        adopters = [
          {
            uid: req.user.uid,
            displayName: req.user.displayName,
            joinedAt: new Date(),
          },
        ];
      }

      const now = new Date();
      const postData: Omit<CommunityPost, "id"> = {
        type: input.type,
        title: input.title.trim(),
        body: input.body.trim(),
        author,
        organizerName:
          input.type === "EVENT" || input.type === "NGO_UPDATE"
            ? input.organizerName?.trim() || author.displayName
            : null,
        eventDate:
          input.type === "EVENT" && input.eventDate
            ? new Date(input.eventDate)
            : null,
        eventLocation:
          input.type === "EVENT" ? input.eventLocation?.trim() || null : null,
        issueLink,
        adopters,
        replies: [],
        createdAt: now,
        updatedAt: now,
      };

      const postRef = await db.collection(COLLECTIONS.COMMUNITY_POSTS).add(postData);
      const createdPost = await postRef.get();

      res.status(201).json({
        success: true,
        data: serializeCommunityPostDocument(createdPost),
        error: null,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("Error creating community post:", error);

      if (error.name === "ZodError") {
        return res.status(400).json({
          success: false,
          data: null,
          error: error.errors.map((item: any) => item.message).join(", "),
          timestamp: new Date().toISOString(),
        });
      }

      res.status(500).json({
        success: false,
        data: null,
        error: "Failed to create community post",
        timestamp: new Date().toISOString(),
      });
    }
  }
);

router.post(
  "/posts/:id/replies",
  optionalAuthMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getAdminDb();
      const { id } = req.params;
      const input = createCommunityReplyInputSchema.parse(req.body);
      const postRef = db.collection(COLLECTIONS.COMMUNITY_POSTS).doc(id);
      const postDoc = await postRef.get();

      if (!postDoc.exists) {
        return res.status(404).json({
          success: false,
          data: null,
          error: "Community post not found",
          timestamp: new Date().toISOString(),
        });
      }

      const postData = postDoc.data()!;
      const now = new Date();
      const reply: CommunityReply = {
        id: `reply_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
        body: input.body.trim(),
        author: buildAuthor(req),
        createdAt: now,
      };

      const replies = Array.isArray(postData.replies) ? [...postData.replies, reply] : [reply];

      await postRef.update({
        replies,
        updatedAt: now,
      });

      res.status(201).json({
        success: true,
        data: reply,
        error: null,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("Error creating community reply:", error);

      if (error.name === "ZodError") {
        return res.status(400).json({
          success: false,
          data: null,
          error: error.errors.map((item: any) => item.message).join(", "),
          timestamp: new Date().toISOString(),
        });
      }

      res.status(500).json({
        success: false,
        data: null,
        error: "Failed to add reply",
        timestamp: new Date().toISOString(),
      });
    }
  }
);

router.post(
  "/posts/:id/adopt",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getAdminDb();
      const { id } = req.params;
      const postRef = db.collection(COLLECTIONS.COMMUNITY_POSTS).doc(id);
      const postDoc = await postRef.get();

      if (!postDoc.exists) {
        return res.status(404).json({
          success: false,
          data: null,
          error: "Community post not found",
          timestamp: new Date().toISOString(),
        });
      }

      const postData = postDoc.data() as Omit<CommunityPost, "id">;

      if (postData.type !== "ISSUE_ADOPTION" || !postData.issueLink?.issueId) {
        return res.status(400).json({
          success: false,
          data: null,
          error: "Only issue adoption cards can be joined",
          timestamp: new Date().toISOString(),
        });
      }

      const latestIssueLink = await buildIssueLink(postData.issueLink.issueId);

      if (!latestIssueLink || latestIssueLink.status !== "OPEN") {
        await postRef.update({
          issueLink: latestIssueLink || postData.issueLink,
          updatedAt: new Date(),
        });

        return res.status(400).json({
          success: false,
          data: null,
          error: "This issue is no longer open for community adoption",
          timestamp: new Date().toISOString(),
        });
      }

      const existingAdopters = Array.isArray(postData.adopters)
        ? postData.adopters
        : [];
      const alreadyJoined = existingAdopters.some(
        (adopter: CommunityAdopter) => adopter.uid === req.user!.uid
      );

      if (alreadyJoined) {
        return res.json({
          success: true,
          data: {
            alreadyJoined: true,
            adopters: existingAdopters,
          },
          error: null,
          timestamp: new Date().toISOString(),
        });
      }

      const updatedAdopters = [
        ...existingAdopters,
        {
          uid: req.user!.uid,
          displayName: req.user!.displayName,
          joinedAt: new Date(),
        },
      ];

      await postRef.update({
        adopters: updatedAdopters,
        issueLink: latestIssueLink,
        updatedAt: new Date(),
      });

      res.json({
        success: true,
        data: {
          alreadyJoined: false,
          adopters: updatedAdopters,
        },
        error: null,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error joining community adoption:", error);
      res.status(500).json({
        success: false,
        data: null,
        error: "Failed to join issue adoption",
        timestamp: new Date().toISOString(),
      });
    }
  }
);

export { router as communityRoutes };
