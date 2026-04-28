import { Router, Request, Response } from "express";
import type { Router as IRouter } from "express";
import { getAdminDb, COLLECTIONS } from "../shared/firebase";
import {
  createIssueInputSchema,
  createIssueCommentInputSchema,
  respondToIssueInputSchema,
  issueFiltersSchema,
  paginationSchema,
} from "../shared/validation";
import { generateIssueId, calculateMunicipalityScore } from "../shared/utils";
import {
  authMiddleware,
  optionalAuthMiddleware,
  requireRole,
  requireMunicipality,
  AuthenticatedRequest,
} from "../middleware/auth";
import {
  findMunicipalityForLocation,
  getAdministrativeRegion,
  classifyIssueWithGemini,
} from "../services/location";
import { predictSeverity } from "../services/ml";
import type {
  Issue,
  IssueStatus,
  GeoLocation,
  IssueComment,
  IssueCommentAuthor,
} from "../shared/types";
import { createIssueBudgetEstimate } from "../shared/budget";
import { sendNewIssueNotification } from "../services/notifications";
import { buildIssueSla } from "../shared/sla";
import {
  buildCacheKey,
  getCacheTtlSeconds,
  getOrSetCachedJson,
  normalizeBoundsForCache,
} from "../services/cache";

const router: IRouter = Router();

const issueListCacheTtlSeconds = getCacheTtlSeconds(
  "ISSUES_CACHE_TTL_SECONDS",
  60
);
const issueStatsCacheTtlSeconds = getCacheTtlSeconds(
  "ISSUE_STATS_CACHE_TTL_SECONDS",
  60
);
const issueMapCacheTtlSeconds = getCacheTtlSeconds(
  "ISSUE_MAP_CACHE_TTL_SECONDS",
  60
);

function parseFiniteNumber(value: unknown): number | null {
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMapBounds(query: Request["query"]) {
  const north = parseFiniteNumber(query.north);
  const south = parseFiniteNumber(query.south);
  const east = parseFiniteNumber(query.east);
  const west = parseFiniteNumber(query.west);

  if (
    north === null ||
    south === null ||
    east === null ||
    west === null ||
    north < south ||
    east < west
  ) {
    return null;
  }

  return { north, south, east, west };
}

function toDateValue(value: any): Date | null {
  if (!value) {
    return null;
  }

  if (typeof value?.toDate === "function") {
    return value.toDate();
  }

  return new Date(value);
}

function serializeIssueComment(comment: any): IssueComment | null {
  if (!comment) {
    return null;
  }

  const author = comment.author || {};

  return {
    ...comment,
    kind: comment.kind || "GENERAL",
    createdAt: toDateValue(comment.createdAt) ?? new Date(),
    author: {
      uid: author.uid ?? null,
      displayName: author.displayName || "Anonymous Citizen",
      isAnonymous: Boolean(author.isAnonymous),
      role: author.role || "ANONYMOUS",
    },
  } as IssueComment;
}

function serializeIssueDocument(
  doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot
) {
  const data = doc.data();

  if (!data) {
    return null;
  }

  const { reporterUid: _reporterUid, ...publicData } = data;

  return {
    id: doc.id,
    ...publicData,
    createdAt: toDateValue(publicData.createdAt),
    updatedAt: toDateValue(publicData.updatedAt),
    resolvedAt: toDateValue(publicData.resolvedAt),
    resolution: publicData.resolution
      ? {
          ...publicData.resolution,
          respondedAt: toDateValue(publicData.resolution.respondedAt),
          verifiedAt: toDateValue(publicData.resolution.verifiedAt),
        }
      : null,
    budget: publicData.budget
      ? {
          ...publicData.budget,
          aiEstimatedAt: toDateValue(publicData.budget.aiEstimatedAt),
          approvedAt: toDateValue(publicData.budget.approvedAt),
        }
      : null,
    comments: Array.isArray(publicData.comments)
      ? publicData.comments
          .map((comment: any) => serializeIssueComment(comment))
          .filter(Boolean)
          .sort(
            (left: IssueComment, right: IssueComment) =>
              right.createdAt.getTime() - left.createdAt.getTime()
          )
      : [],
    sla: publicData.sla
      ? {
          ...publicData.sla,
          dueAt: toDateValue(publicData.sla.dueAt),
          breachedAt: toDateValue(publicData.sla.breachedAt),
          breachAlertSentAt: toDateValue(publicData.sla.breachAlertSentAt),
        }
      : null,
  };
}

// Helper function to recalculate municipality score
async function recalculateMunicipalityScore(municipalityId: string) {
  const db = getAdminDb();

  // Get all open issues for this municipality
  const openIssuesSnapshot = await db
    .collection(COLLECTIONS.ISSUES)
    .where("municipalityId", "==", municipalityId)
    .where("status", "==", "OPEN")
    .get();

  const openIssues = openIssuesSnapshot.docs.map((doc) => ({
    id: doc.id,
    createdAt:
      doc.data().createdAt?.toDate?.() || new Date(doc.data().createdAt),
  }));

  // Get count of closed issues (for bonus)
  const closedIssuesSnapshot = await db
    .collection(COLLECTIONS.ISSUES)
    .where("municipalityId", "==", municipalityId)
    .where("status", "==", "CLOSED")
    .count()
    .get();

  const closedCount = closedIssuesSnapshot.data().count;

  // Calculate new score
  const { score } = calculateMunicipalityScore(openIssues, closedCount);

  // Update municipality score
  await db.collection(COLLECTIONS.MUNICIPALITIES).doc(municipalityId).update({
    score,
    updatedAt: new Date(),
  });

  return score;
}

// Get all issues (public)
router.get("/", async (req: Request, res: Response) => {
  try {
    const db = getAdminDb();
    const { page, pageSize } = paginationSchema.parse(req.query);
    const filters = issueFiltersSchema.parse(req.query);

    const hasStatusFilter = filters.status && filters.status.length > 0;
    const hasTypeFilter = filters.type && filters.type.length > 0;

    // Due to Firestore composite index requirements, we'll fetch all and filter in memory
    const cacheKey = buildCacheKey([
      "issues",
      "list",
      filters.municipalityId || "all",
    ]);

    let issues = await getOrSetCachedJson<any[]>(
      cacheKey,
      issueListCacheTtlSeconds,
      async () => {
        let query: FirebaseFirestore.Query = db
          .collection(COLLECTIONS.ISSUES)
          .orderBy("createdAt", "desc");

        if (filters.municipalityId) {
          query = query.where("municipalityId", "==", filters.municipalityId);
        }

        // Fetch a larger batch to allow for filtering
        const snapshot = await query.limit(100).get();

        return snapshot.docs
          .map((doc) => serializeIssueDocument(doc))
          .filter(Boolean) as any[];
      }
    );

    // Apply filters in memory
    if (hasStatusFilter) {
      issues = issues.filter((issue) => filters.status!.includes(issue.status));
    }

    if (hasTypeFilter) {
      issues = issues.filter((issue) => filters.type!.includes(issue.type));
    }

    // Get total count for the filtered results
    const total = issues.length;

    // Apply pagination
    const offset = (page - 1) * pageSize;
    const paginatedIssues = issues.slice(offset, offset + pageSize);

    res.json({
      success: true,
      data: {
        items: paginatedIssues,
        total,
        page,
        pageSize,
        hasMore: offset + paginatedIssues.length < total,
      },
      error: null,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("Error fetching issues:", error?.message || String(error));
    console.error("Full error:", error);
    res.status(500).json({
      success: false,
      data: null,
      error: "Failed to fetch issues: " + (error?.message || String(error)),
      timestamp: new Date().toISOString(),
    });
  }
});

// Get global stats (public) - must be before /:id to avoid route conflicts
router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const cacheKey = buildCacheKey(["issues", "stats", "global"]);
    const statsData = await getOrSetCachedJson(
      cacheKey,
      issueStatsCacheTtlSeconds,
      async () => {
        const db = getAdminDb();

        // Get total issues count
        const totalSnapshot = await db.collection(COLLECTIONS.ISSUES).count().get();
        const totalIssues = totalSnapshot.data().count;

        // Get resolved issues count (CLOSED status)
        const resolvedSnapshot = await db
          .collection(COLLECTIONS.ISSUES)
          .where("status", "==", "CLOSED")
          .count()
          .get();
        const resolvedIssues = resolvedSnapshot.data().count;

        // Get municipalities count
        const municipalitiesSnapshot = await db
          .collection(COLLECTIONS.MUNICIPALITIES)
          .count()
          .get();
        const totalMunicipalities = municipalitiesSnapshot.data().count;

        return {
          totalIssues,
          resolvedIssues,
          openIssues: totalIssues - resolvedIssues,
          totalMunicipalities,
          avgResponseTime: 48, // This would need more complex calculation
        };
      }
    );

    res.json({
      success: true,
      data: statsData,
      error: null,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error(
      "Error fetching global stats:",
      error?.message || String(error)
    );
    res.status(500).json({
      success: false,
      data: null,
      error: "Failed to fetch stats",
      timestamp: new Date().toISOString(),
    });
  }
});

// Get issues by bounds (for map)
router.get("/map/bounds", async (req: Request, res: Response) => {
  try {
    const db = getAdminDb();
    const bounds = parseMapBounds(req.query);

    if (!bounds) {
      return res.status(400).json({
        success: false,
        data: null,
        error: "Invalid or missing bounds parameters",
        timestamp: new Date().toISOString(),
      });
    }

    const cacheBounds = normalizeBoundsForCache(bounds);
    const cacheKey = buildCacheKey([
      "issues",
      "map",
      cacheBounds.south,
      cacheBounds.north,
      cacheBounds.west,
      cacheBounds.east,
    ]);

    const issues = await getOrSetCachedJson<any[]>(
      cacheKey,
      issueMapCacheTtlSeconds,
      async () => {
        const snapshot = await db
          .collection(COLLECTIONS.ISSUES)
          .where("location.latitude", ">=", cacheBounds.south)
          .where("location.latitude", "<=", cacheBounds.north)
          .limit(500)
          .get();

        return snapshot.docs
          .map((doc) => serializeIssueDocument(doc))
          .filter(Boolean)
          .filter((issue) => {
            const lng = (issue as any).location?.longitude;
            return lng >= cacheBounds.west && lng <= cacheBounds.east;
          }) as any[];
      }
    );

    res.json({
      success: true,
      data: issues,
      error: null,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error(
      "Error fetching map issues:",
      error?.message || String(error)
    );
    res.status(500).json({
      success: false,
      data: null,
      error: "Failed to fetch map issues",
      timestamp: new Date().toISOString(),
    });
  }
});

// Get single issue (public)
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const db = getAdminDb();
    const doc = await db
      .collection(COLLECTIONS.ISSUES)
      .doc(req.params.id)
      .get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        data: null,
        error: "Issue not found",
        timestamp: new Date().toISOString(),
      });
    }

    const issue = serializeIssueDocument(doc);

    res.json({
      success: true,
      data: issue,
      error: null,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("Error fetching issue:", error?.message || String(error));
    res.status(500).json({
      success: false,
      data: null,
      error: "Failed to fetch issue",
      timestamp: new Date().toISOString(),
    });
  }
});

// Create new issue (anonymous/public)
router.post("/", optionalAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const input = createIssueInputSchema.parse(req.body);
    const db = getAdminDb();

    const issueId = generateIssueId();
    const now = new Date();

    const { latitude, longitude } = input.location;
    const imageUrls =
      req.body.imageUrls || (input.imageUrl ? [input.imageUrl] : []);
    const primaryImageUrl =
      input.imageUrl || (Array.isArray(imageUrls) ? imageUrls[0] : null) || null;

    // Classify issue type using Gemini (if type not provided)
    let classifiedType: Issue["type"] = input.type || "POTHOLE";
    if (!input.type) {
      try {
        const classification = await classifyIssueWithGemini(input.description);
        if (classification && classification.confidence > 0.7) {
          classifiedType = classification.type as Issue["type"];
          console.log(
            `Issue classified as ${classifiedType} with confidence ${classification.confidence}`
          );
        }
      } catch (err) {
        console.warn("Issue classification failed, using default type:", err);
      }
    }

    // Find the appropriate municipality based on location first
    let municipalityId = "MUN-DEFAULT";
    let municipalityData: {
      name?: string;
      district?: string;
      state?: string;
    } | null = null;
    try {
      const municipalityMatch = await findMunicipalityForLocation(
        latitude,
        longitude,
        db
      );
      if (municipalityMatch) {
        municipalityId = municipalityMatch.municipalityId;
        console.log(
          `Issue assigned to municipality ${municipalityMatch.name} (${municipalityMatch.matchType})`
        );

        // Get municipality data for region fallback
        const muniDoc = await db
          .collection(COLLECTIONS.MUNICIPALITIES)
          .doc(municipalityId)
          .get();
        if (muniDoc.exists) {
          const data = muniDoc.data();
          municipalityData = {
            name: data?.name || municipalityMatch.name,
            district: data?.district,
            state: data?.state,
          };
        }
      }
    } catch (err) {
      console.warn("Failed to find municipality for location:", err);
    }

    // Get administrative region from coordinates
    let region = {
      state: "Unknown",
      district: "Unknown",
      municipality: "Unknown",
    };

    try {
      const adminRegion = await getAdministrativeRegion(latitude, longitude);
      if (adminRegion && adminRegion.state) {
        region = {
          state: adminRegion.state || "Unknown",
          district: adminRegion.district || "Unknown",
          municipality: adminRegion.municipality || "Unknown",
          ...(adminRegion.pincode && { pincode: adminRegion.pincode }),
        };
      } else if (municipalityData) {
        // Fallback to municipality data if geocoding failed
        console.log("Using municipality data as fallback for region");
        region = {
          state: municipalityData.state || "Unknown",
          district: municipalityData.district || "Unknown",
          municipality: municipalityData.name || "Unknown",
        };
      }
    } catch (err) {
      console.warn("Failed to get administrative region:", err);
      // Use municipality data as fallback
      if (municipalityData) {
        region = {
          state: municipalityData.state || "Unknown",
          district: municipalityData.district || "Unknown",
          municipality: municipalityData.name || "Unknown",
        };
      }
    }

    const location: GeoLocation = {
      latitude,
      longitude,
    };

    let budget: Issue["budget"] = null;
    try {
      const severityResult = primaryImageUrl
        ? await predictSeverity(primaryImageUrl, classifiedType)
        : null;
      budget = createIssueBudgetEstimate({
        issueType: classifiedType,
        now,
        severityScore: severityResult?.success
          ? severityResult.data?.score ?? null
          : null,
        confidence: severityResult?.success
          ? severityResult.data?.confidence ?? null
          : null,
        hadImage: Boolean(primaryImageUrl),
      });
    } catch (error) {
      console.warn("Budget estimation failed, using fallback estimate:", error);
      budget = createIssueBudgetEstimate({
        issueType: classifiedType,
        now,
        hadImage: Boolean(primaryImageUrl),
      });
    }

    const issue: Omit<Issue, "id"> = {
      type: classifiedType,
      description: input.description,
      imageUrl: input.imageUrl || (imageUrls.length > 0 ? imageUrls[0] : null),
      imageUrls: imageUrls,
      location,
      region,
      municipalityId,
      status: "OPEN" as IssueStatus,
      createdAt: now,
      updatedAt: now,
      resolution: null,
      budget,
      comments: [],
      sla: buildIssueSla(classifiedType, now),
      reporterUid: req.user?.uid ?? null,
    };

    await db
      .collection(COLLECTIONS.ISSUES)
      .doc(issueId)
      .set({
        ...issue,
        createdAt: now,
        updatedAt: now,
      });

    // Update municipality stats
    await db
      .collection(COLLECTIONS.MUNICIPALITIES)
      .doc(municipalityId)
      .update({
        totalIssues:
          require("firebase-admin").firestore.FieldValue.increment(1),
        updatedAt: now,
      })
      .catch(() => {
        // Municipality might not exist yet
      });

    // Recalculate municipality score (new issue might affect penalties)
    await recalculateMunicipalityScore(municipalityId).catch(() => {
      // Score calculation might fail if municipality doesn't exist
    });

    // Send push notification to municipality users (fire-and-forget)
    sendNewIssueNotification({
      issueId,
      issueType: classifiedType,
      description: input.description,
      municipalityId,
    }).catch((err) => {
      console.warn('Failed to send notification:', err);
    });

    res.status(201).json({
      success: true,
      data: { id: issueId, ...issue },
      error: null,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("Error creating issue:", error?.message || error);

    if (error.name === "ZodError") {
      return res.status(400).json({
        success: false,
        data: null,
        error:
          "Validation failed: " +
          error.errors.map((e: any) => e.message).join(", "),
        timestamp: new Date().toISOString(),
      });
    }

    res.status(500).json({
      success: false,
      data: null,
      error: "Failed to create issue",
      timestamp: new Date().toISOString(),
    });
  }
});

// Add a public comment to an issue
router.post(
  "/:id/comments",
  optionalAuthMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getAdminDb();
      const { id } = req.params;
      const parsedInput = createIssueCommentInputSchema.safeParse(req.body);

      if (!parsedInput.success) {
        return res.status(400).json({
          success: false,
          data: null,
          error:
            "Validation failed: " +
            parsedInput.error.errors.map((e) => e.message).join(", "),
          timestamp: new Date().toISOString(),
        });
      }

      const issueRef = db.collection(COLLECTIONS.ISSUES).doc(id);
      const issueDoc = await issueRef.get();

      if (!issueDoc.exists) {
        return res.status(404).json({
          success: false,
          data: null,
          error: "Issue not found",
          timestamp: new Date().toISOString(),
        });
      }

      const now = new Date();
      const shouldBeAnonymous = parsedInput.data.isAnonymous || !req.user;
      const author: IssueCommentAuthor = req.user
        ? shouldBeAnonymous
          ? {
              uid: null,
              displayName: "Anonymous Citizen",
              isAnonymous: true,
              role: "ANONYMOUS",
            }
          : {
              uid: req.user.uid,
              displayName: req.user.displayName || "Community Member",
              isAnonymous: false,
              role: req.user.role,
            }
        : {
            uid: null,
            displayName: "Anonymous Citizen",
            isAnonymous: true,
            role: "ANONYMOUS",
          };

      const comment: IssueComment = {
        id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        body: parsedInput.data.body.trim(),
        kind: parsedInput.data.kind || "GENERAL",
        author,
        createdAt: now,
      };

      await issueRef.update({
        comments: require("firebase-admin").firestore.FieldValue.arrayUnion(
          comment
        ),
        updatedAt: now,
      });

      res.status(201).json({
        success: true,
        data: comment,
        error: null,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("Error adding issue comment:", error?.message || error);

      if (error.name === "ZodError") {
        return res.status(400).json({
          success: false,
          data: null,
          error:
            "Validation failed: " +
            error.errors.map((e: any) => e.message).join(", "),
          timestamp: new Date().toISOString(),
        });
      }

      res.status(500).json({
        success: false,
        data: null,
        error: "Failed to add comment",
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// Respond to issue (municipality user only)
router.post(
  "/:id/respond",
  authMiddleware,
  requireRole("MUNICIPALITY_USER"),
    requireMunicipality,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const {
        response: responseText,
        resolutionImageUrl,
        resolutionNote,
      } = req.body;
      const parsedInput = respondToIssueInputSchema.safeParse({
        issueId: id,
        resolutionImageUrl,
        resolutionNote: resolutionNote || responseText,
      });

      if (!parsedInput.success) {
        return res.status(400).json({
          success: false,
          data: null,
          error: parsedInput.error.errors
            .map((item) => item.message)
            .join(", "),
          timestamp: new Date().toISOString(),
        });
      }

      const {
        resolutionImageUrl: validatedResolutionImageUrl,
        resolutionNote: validatedResolutionNote,
      } = parsedInput.data;

      const db = getAdminDb();

      // Get the issue
      const issueDoc = await db.collection(COLLECTIONS.ISSUES).doc(id).get();

      if (!issueDoc.exists) {
        return res.status(404).json({
          success: false,
          data: null,
          error: "Issue not found",
          timestamp: new Date().toISOString(),
        });
      }

      const issue = issueDoc.data() as Issue;

      // Check jurisdiction
      if (issue.municipalityId !== req.user?.municipalityId) {
        return res.status(403).json({
          success: false,
          data: null,
          error: "Issue not in your jurisdiction",
          timestamp: new Date().toISOString(),
        });
      }

      const now = new Date();

      await db
        .collection(COLLECTIONS.ISSUES)
        .doc(id)
        .update({
          status: "CLOSED",
          municipalityResponse: validatedResolutionNote,
          resolution: {
            resolutionImageUrl: validatedResolutionImageUrl,
            resolutionNote: validatedResolutionNote,
            respondedAt: now,
            respondedBy: req.user?.uid,
            verificationScore: null,
            verifiedAt: null,
          },
          resolvedAt: now,
          updatedAt: now,
        });

      // Update municipality resolved issues counter and recalculate score
      if (issue.status === "OPEN" && issue.municipalityId) {
        const muniRef = db
          .collection(COLLECTIONS.MUNICIPALITIES)
          .doc(issue.municipalityId);
        const muniDoc = await muniRef.get();
        if (muniDoc.exists) {
          const muniData = muniDoc.data();
          await muniRef.update({
            resolvedIssues: (muniData?.resolvedIssues || 0) + 1,
            updatedAt: now,
          });

          // Recalculate municipality score
          await recalculateMunicipalityScore(issue.municipalityId);
        }
      }

      res.json({
        success: true,
        data: {
          issueId: id,
          status: "CLOSED",
        },
        error: null,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error(
        "Error responding to issue:",
        error?.message || String(error)
      );

      if (error.name === "ZodError") {
        return res.status(400).json({
          success: false,
          data: null,
          error:
            "Validation failed: " +
            error.errors.map((e: any) => e.message).join(", "),
          timestamp: new Date().toISOString(),
        });
      }

      res.status(500).json({
        success: false,
        data: null,
        error: "Failed to respond to issue",
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// Update issue status (municipality user only)
router.patch(
  "/:id/status",
  authMiddleware,
  requireRole("MUNICIPALITY_USER"),
  requireMunicipality,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const validStatuses = ["OPEN", "CLOSED"];
      if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          data: null,
          error: "Invalid status. Must be one of: " + validStatuses.join(", "),
          timestamp: new Date().toISOString(),
        });
      }

      if (status === "CLOSED") {
        return res.status(400).json({
          success: false,
          data: null,
          error:
            "Close issues through the resolution flow so an after photo and comment are saved.",
          timestamp: new Date().toISOString(),
        });
      }

      const db = getAdminDb();

      // Get the issue
      const issueDoc = await db.collection(COLLECTIONS.ISSUES).doc(id).get();

      if (!issueDoc.exists) {
        return res.status(404).json({
          success: false,
          data: null,
          error: "Issue not found",
          timestamp: new Date().toISOString(),
        });
      }

      const issue = issueDoc.data() as Issue;

      // Check jurisdiction
      if (issue.municipalityId !== req.user?.municipalityId) {
        return res.status(403).json({
          success: false,
          data: null,
          error: "Issue not in your jurisdiction",
          timestamp: new Date().toISOString(),
        });
      }

      const now = new Date();

      await db
        .collection(COLLECTIONS.ISSUES)
        .doc(id)
        .update({
          status,
          updatedAt: now,
          ...(status === "CLOSED" ? { resolvedAt: now } : {}),
        });

      // Update municipality stats if resolved (CLOSED)
      if (status === "CLOSED" && issue.municipalityId) {
        const muniRef = db
          .collection(COLLECTIONS.MUNICIPALITIES)
          .doc(issue.municipalityId);
        const muniDoc = await muniRef.get();
        if (muniDoc.exists) {
          const muniData = muniDoc.data();
          await muniRef.update({
            resolvedIssues: (muniData?.resolvedIssues || 0) + 1,
            updatedAt: now,
          });
        }
      }

      res.json({
        success: true,
        data: { issueId: id, status },
        error: null,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error(
        "Error updating issue status:",
        error?.message || String(error)
      );
      res.status(500).json({
        success: false,
        data: null,
        error: "Failed to update issue status",
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// Recalculate all municipality scores (admin utility endpoint)
router.post("/recalculate-scores", async (_req: Request, res: Response) => {
  try {
    const db = getAdminDb();

    // Get all municipalities
    const municipalitiesSnapshot = await db
      .collection(COLLECTIONS.MUNICIPALITIES)
      .get();

    const results: {
      municipalityId: string;
      name: string;
      oldScore: number;
      newScore: number;
    }[] = [];

    for (const doc of municipalitiesSnapshot.docs) {
      const muniData = doc.data();
      const oldScore = muniData.score || 0;

      try {
        // Also recalculate totalIssues and resolvedIssues from actual issues
        const allIssuesSnapshot = await db
          .collection(COLLECTIONS.ISSUES)
          .where("municipalityId", "==", doc.id)
          .get();

        const closedIssuesSnapshot = await db
          .collection(COLLECTIONS.ISSUES)
          .where("municipalityId", "==", doc.id)
          .where("status", "==", "CLOSED")
          .count()
          .get();

        const totalIssues = allIssuesSnapshot.size;
        const resolvedIssues = closedIssuesSnapshot.data().count;

        // Update municipality with correct counts
        await db.collection(COLLECTIONS.MUNICIPALITIES).doc(doc.id).update({
          totalIssues,
          resolvedIssues,
          updatedAt: new Date(),
        });

        const newScore = await recalculateMunicipalityScore(doc.id);
        results.push({
          municipalityId: doc.id,
          name: muniData.name,
          oldScore,
          newScore,
        });
      } catch (err) {
        console.error(`Failed to recalculate score for ${doc.id}:`, err);
      }
    }

    res.json({
      success: true,
      data: {
        updated: results.length,
        results,
      },
      error: null,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error(
      "Error recalculating scores:",
      error?.message || String(error)
    );
    res.status(500).json({
      success: false,
      data: null,
      error: "Failed to recalculate scores",
      timestamp: new Date().toISOString(),
    });
  }
});

// Delete an issue (admin only)
router.delete(
  "/:issueId",
  authMiddleware,
  requireRole("PLATFORM_MAINTAINER"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getAdminDb();
      const { issueId } = req.params;

      // Get the issue first
      const issueRef = db.collection(COLLECTIONS.ISSUES).doc(issueId);
      const issueDoc = await issueRef.get();

      if (!issueDoc.exists) {
        return res.status(404).json({
          success: false,
          data: null,
          error: "Issue not found",
          timestamp: new Date().toISOString(),
        });
      }

      const issueData = issueDoc.data();
      const municipalityId = issueData?.municipalityId;

      // Delete the issue
      await issueRef.delete();

      // Update municipality stats if applicable
      if (municipalityId) {
        const municipalityRef = db
          .collection(COLLECTIONS.MUNICIPALITIES)
          .doc(municipalityId);
        const municipalityDoc = await municipalityRef.get();

        if (municipalityDoc.exists) {
          const muniData = municipalityDoc.data();
          const totalIssues = Math.max(0, (muniData?.totalIssues || 1) - 1);
          const resolvedIssues =
            issueData?.status === "CLOSED"
              ? Math.max(0, (muniData?.resolvedIssues || 1) - 1)
              : muniData?.resolvedIssues || 0;

          await municipalityRef.update({
            totalIssues,
            resolvedIssues,
            updatedAt: new Date(),
          });

          // Recalculate score
          await recalculateMunicipalityScore(municipalityId);
        }
      }

      res.json({
        success: true,
        data: { deleted: issueId },
        error: null,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("Error deleting issue:", error?.message || String(error));
      res.status(500).json({
        success: false,
        data: null,
        error: "Failed to delete issue",
        timestamp: new Date().toISOString(),
      });
    }
  }
);

export { router as issueRoutes };
