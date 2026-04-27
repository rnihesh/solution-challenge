import { z } from "zod";

// ============================================
// CONSTANTS
// ============================================

export const ISSUE_TYPES = [
  "POTHOLE", // Potholes and Road Damage
  "GARBAGE", // Littering/Garbage on Public Places
  "ILLEGAL_PARKING", // Illegal Parking Issues
  "DAMAGED_SIGN", // Broken Road Sign Issues
  "FALLEN_TREE", // Fallen trees
  "VANDALISM", // Vandalism Issues (Graffiti)
  "DEAD_ANIMAL", // Dead Animal Pollution
  "DAMAGED_CONCRETE", // Damaged concrete structures
  "DAMAGED_ELECTRICAL", // Damaged Electric wires and poles
] as const;

export const ISSUE_STATUS = ["OPEN", "CLOSED"] as const;
export const BUDGET_ESTIMATE_SOURCES = [
  "PHOTO_ANALYSIS",
  "TYPE_FALLBACK",
] as const;
export const SOS_REPORT_STATUS = [
  "ACTIVE",
  "ACKNOWLEDGED",
  "RESOLVED",
] as const;
export const ISSUE_COMMENT_KINDS = [
  "GENERAL",
  "CONTEXT",
  "WORSENED",
  "FIX_CONFIRMED",
] as const;
export const COMMUNITY_POST_TYPES = [
  "DISCUSSION",
  "EVENT",
  "ISSUE_ADOPTION",
  "NGO_UPDATE",
] as const;

export const MUNICIPALITY_TYPES = [
  "MUNICIPAL_CORPORATION",
  "MUNICIPALITY",
  "NAGAR_PANCHAYAT",
  "GRAM_PANCHAYAT",
  "CANTONMENT_BOARD",
] as const;

export const USER_ROLES = [
  "CITIZEN",
  "MUNICIPALITY_USER",
  "PLATFORM_MAINTAINER",
] as const;

// ============================================
// BASE SCHEMAS
// ============================================

export const geoLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const administrativeRegionSchema = z.object({
  state: z.string().min(1).max(100),
  district: z.string().min(1).max(100),
  municipality: z.string().min(1).max(100),
  ward: z.string().max(50).optional(),
  pincode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

export const boundsSchema = z.object({
  north: z.number().min(-90).max(90),
  south: z.number().min(-90).max(90),
  east: z.number().min(-180).max(180),
  west: z.number().min(-180).max(180),
});

// ============================================
// ISSUE SCHEMAS
// ============================================

export const issueTypeSchema = z.enum(ISSUE_TYPES);
export const issueStatusSchema = z.enum(ISSUE_STATUS);

export const resolutionMetadataSchema = z.object({
  resolutionImageUrl: z.string().url(),
  resolutionNote: z.string().min(10).max(1000),
  respondedAt: z.coerce.date(),
  respondedBy: z.string().min(1),
  verificationScore: z.number().min(0).max(1).nullable(),
  verifiedAt: z.coerce.date().nullable(),
});

export const budgetEstimateSourceSchema = z.enum(BUDGET_ESTIMATE_SOURCES);
export const issueCommentKindSchema = z.enum(ISSUE_COMMENT_KINDS);
export const issueCommentAuthorRoleSchema = z.enum([
  "USER",
  "MUNICIPALITY_USER",
  "PLATFORM_MAINTAINER",
  "ANONYMOUS",
]);

export const issueCommentAuthorSchema = z.object({
  uid: z.string().nullable(),
  displayName: z.string().min(1).max(120),
  isAnonymous: z.boolean(),
  role: issueCommentAuthorRoleSchema,
});

export const issueCommentSchema = z.object({
  id: z.string().min(1),
  body: z.string().min(1).max(1000),
  kind: issueCommentKindSchema.default("GENERAL"),
  author: issueCommentAuthorSchema,
  createdAt: z.coerce.date(),
});

export const issueSlaSchema = z.object({
  deadlineDays: z.number().int().min(1).max(365),
  dueAt: z.coerce.date(),
  breachedAt: z.coerce.date().nullable(),
  breachAlertSentAt: z.coerce.date().nullable(),
});

export const issueBudgetSchema = z.object({
  currency: z.literal("INR"),
  aiEstimatedAmount: z.number().min(0).nullable(),
  aiEstimatedAt: z.coerce.date().nullable(),
  aiEstimateSource: budgetEstimateSourceSchema.nullable(),
  aiEstimateConfidence: z.number().min(0).max(1).nullable(),
  aiSeverityScore: z.number().min(0).max(10).nullable(),
  aiReasoning: z.string().max(1000).nullable(),
  approvedAmount: z.number().min(0).nullable(),
  approvedAt: z.coerce.date().nullable(),
  approvedBy: z.string().nullable(),
  approvalNote: z.string().max(1000).nullable(),
});

export const issueSchema = z.object({
  id: z.string().min(1),
  type: issueTypeSchema,
  description: z.string().min(10).max(500),
  imageUrl: z.string().url().nullable(),
  imageUrls: z.array(z.string().url()).optional(),
  location: geoLocationSchema,
  region: administrativeRegionSchema,
  municipalityId: z.string().min(1),
  municipalityResponse: z.string().max(2000).optional(),
  status: issueStatusSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  resolvedAt: z.coerce.date().optional(),
  resolution: resolutionMetadataSchema.nullable(),
  budget: issueBudgetSchema.nullable(),
  comments: z.array(issueCommentSchema).default([]),
  sla: issueSlaSchema.nullable(),
});

export const createIssueInputSchema = z.object({
  description: z
    .string()
    .min(10, "Description must be at least 10 characters")
    .max(500, "Description must be less than 500 characters"),
  imageUrl: z.string().url("Invalid image URL").optional(),
  location: geoLocationSchema,
  type: issueTypeSchema.optional(),
});

export const respondToIssueInputSchema = z.object({
  issueId: z.string().min(1),
  resolutionImageUrl: z.string().url("Invalid resolution image URL"),
  resolutionNote: z
    .string()
    .min(10, "Resolution note must be at least 10 characters")
    .max(1000, "Resolution note must be less than 1000 characters"),
});

export const createIssueCommentInputSchema = z.object({
  body: z
    .string()
    .min(2, "Comment must be at least 2 characters")
    .max(1000, "Comment must be less than 1000 characters"),
  kind: issueCommentKindSchema.optional(),
  isAnonymous: z.boolean().optional().default(false),
});

export const sosReportStatusSchema = z.enum(SOS_REPORT_STATUS);

export const sosReportSchema = z.object({
  id: z.string().min(1),
  note: z.string().max(300).nullable(),
  location: geoLocationSchema,
  region: administrativeRegionSchema,
  municipalityId: z.string().min(1),
  status: sosReportStatusSchema,
  reportedByUid: z.string().nullable(),
  acknowledgedAt: z.coerce.date().nullable(),
  acknowledgedBy: z.string().nullable(),
  resolvedAt: z.coerce.date().nullable(),
  resolvedBy: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const createSosReportInputSchema = z.object({
  location: geoLocationSchema,
  note: z
    .string()
    .max(300, "SOS note must be less than 300 characters")
    .optional()
    .nullable(),
});

export const updateSosReportStatusInputSchema = z.object({
  status: sosReportStatusSchema,
});

export const communityPostTypeSchema = z.enum(COMMUNITY_POST_TYPES);

export const communityAuthorSchema = z.object({
  uid: z.string().nullable(),
  displayName: z.string().min(1).max(120),
  isAnonymous: z.boolean(),
  role: z.string().min(1),
});

export const communityReplySchema = z.object({
  id: z.string().min(1),
  body: z.string().min(1).max(1000),
  author: communityAuthorSchema,
  createdAt: z.coerce.date(),
});

export const communityIssueLinkSchema = z.object({
  issueId: z.string().min(1),
  type: issueTypeSchema,
  description: z.string().min(1).max(500),
  status: issueStatusSchema,
  imageUrl: z.string().url().nullable(),
  address: z.string().max(300).nullable(),
  municipalityId: z.string().min(1),
});

export const communityAdopterSchema = z.object({
  uid: z.string().min(1),
  displayName: z.string().min(1).max(120),
  joinedAt: z.coerce.date(),
});

export const communityPostSchema = z.object({
  id: z.string().min(1),
  type: communityPostTypeSchema,
  title: z.string().min(4).max(120),
  body: z.string().min(10).max(2000),
  author: communityAuthorSchema,
  organizerName: z.string().max(120).nullable(),
  eventDate: z.coerce.date().nullable(),
  eventLocation: z.string().max(200).nullable(),
  issueLink: communityIssueLinkSchema.nullable(),
  adopters: z.array(communityAdopterSchema),
  replies: z.array(communityReplySchema),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const createCommunityPostInputSchema = z
  .object({
    type: communityPostTypeSchema,
    title: z
      .string()
      .min(4, "Title must be at least 4 characters")
      .max(120, "Title must be less than 120 characters"),
    body: z
      .string()
      .min(10, "Post content must be at least 10 characters")
      .max(2000, "Post content must be less than 2000 characters"),
    organizerName: z.string().min(2).max(120).optional().nullable(),
    eventDate: z.coerce.date().optional().nullable(),
    eventLocation: z.string().min(2).max(200).optional().nullable(),
    issueId: z.string().min(1).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "EVENT") {
      if (!value.eventDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Event date is required for event posts",
          path: ["eventDate"],
        });
      }

      if (!value.eventLocation) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Event location is required for event posts",
          path: ["eventLocation"],
        });
      }
    }

    if (value.type === "ISSUE_ADOPTION" && !value.issueId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select an unresolved issue to create an adoption card",
        path: ["issueId"],
      });
    }
  });

export const createCommunityReplyInputSchema = z.object({
  body: z
    .string()
    .min(2, "Reply must be at least 2 characters")
    .max(1000, "Reply must be less than 1000 characters"),
});

// Helper to handle query params that can be string or string[]
const stringOrArraySchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.union([
    z.array(itemSchema),
    itemSchema.transform((val) => [val]),
  ]).optional();

export const issueFiltersSchema = z.object({
  status: stringOrArraySchema(issueStatusSchema),
  type: stringOrArraySchema(issueTypeSchema),
  municipalityId: z.string().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  bounds: boundsSchema.optional(),
});

// ============================================
// MUNICIPALITY SCHEMAS
// ============================================

export const municipalityTypeSchema = z.enum(MUNICIPALITY_TYPES);

export const municipalitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  type: municipalityTypeSchema,
  state: z.string().min(1).max(100),
  district: z.string().min(1).max(100),
  score: z.number().int(),
  totalIssues: z.number().int().min(0),
  resolvedIssues: z.number().int().min(0),
  avgResolutionTime: z.number().min(0).nullable(),
  bounds: boundsSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// Municipality registration request input (pending approval)
export const municipalityRegistrationSchema = z.object({
  // User details
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(10, "Phone number must be at least 10 digits").max(15),

  // Municipality details
  municipalityName: z
    .string()
    .min(3, "Municipality name must be at least 3 characters")
    .max(200),
  municipalityType: municipalityTypeSchema,
  state: z.string().min(1, "State is required").max(100),
  district: z.string().min(1, "District is required").max(100),
  address: z
    .string()
    .min(10, "Address must be at least 10 characters")
    .max(500),
  population: z.number().int().min(0).optional(),

  // Location bounds for jurisdiction
  bounds: boundsSchema.optional(),

  // Verification
  registrationNumber: z
    .string()
    .min(3, "Registration number is required")
    .max(100),

  // Note: status and rejectionReason are server-controlled, not in input schema
});

// Create municipality (admin only)
export const createMunicipalitySchema = z.object({
  name: z.string().min(3).max(200),
  type: municipalityTypeSchema,
  state: z.string().min(1).max(100),
  district: z.string().min(1).max(100),
  bounds: boundsSchema,
});

// Update municipality (admin only)
export const updateMunicipalitySchema = z.object({
  name: z.string().min(3).max(200).optional(),
  type: municipalityTypeSchema.optional(),
  state: z.string().min(1).max(100).optional(),
  district: z.string().min(1).max(100).optional(),
  bounds: boundsSchema.optional(),
});

// ============================================
// USER SCHEMAS
// ============================================

export const userRoleSchema = z.enum(USER_ROLES);

export const userSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  role: userRoleSchema,
  municipalityId: z.string().nullable(),
  displayName: z.string().min(1).max(100),
  isActive: z.boolean(),
  createdAt: z.coerce.date(),
  lastLoginAt: z.coerce.date().nullable(),
});

export const loginInputSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// ============================================
// VERIFICATION SCHEMAS
// ============================================

export const classificationResultSchema = z.object({
  type: issueTypeSchema,
  confidence: z.number().min(0).max(1),
  alternatives: z.array(
    z.object({
      type: issueTypeSchema,
      confidence: z.number().min(0).max(1),
    })
  ),
});

export const verificationResultSchema = z.object({
  isResolved: z.boolean(),
  confidence: z.number().min(0).max(1),
  factors: z.object({
    imageSimilarity: z.number().min(0).max(1),
    cleanlinessScore: z.number().min(0).max(1),
    structuralChange: z.number().min(0).max(1),
  }),
  explanation: z.string(),
});

// ============================================
// API SCHEMAS
// ============================================

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
});

// ============================================
// TYPE EXPORTS
// ============================================

export type GeoLocation = z.infer<typeof geoLocationSchema>;
export type GeoPoint = z.infer<typeof geoPointSchema>;
export type AdministrativeRegion = z.infer<typeof administrativeRegionSchema>;
export type Bounds = z.infer<typeof boundsSchema>;
export type IssueType = z.infer<typeof issueTypeSchema>;
export type IssueStatus = z.infer<typeof issueStatusSchema>;
export type ResolutionMetadata = z.infer<typeof resolutionMetadataSchema>;
export type BudgetEstimateSource = z.infer<typeof budgetEstimateSourceSchema>;
export type IssueCommentKind = z.infer<typeof issueCommentKindSchema>;
export type IssueCommentAuthor = z.infer<typeof issueCommentAuthorSchema>;
export type IssueComment = z.infer<typeof issueCommentSchema>;
export type IssueSla = z.infer<typeof issueSlaSchema>;
export type IssueBudget = z.infer<typeof issueBudgetSchema>;
export type Issue = z.infer<typeof issueSchema>;
export type CreateIssueInput = z.infer<typeof createIssueInputSchema>;
export type RespondToIssueInput = z.infer<typeof respondToIssueInputSchema>;
export type CreateIssueCommentInput = z.infer<
  typeof createIssueCommentInputSchema
>;
export type SosReportStatus = z.infer<typeof sosReportStatusSchema>;
export type SosReport = z.infer<typeof sosReportSchema>;
export type CreateSosReportInput = z.infer<typeof createSosReportInputSchema>;
export type UpdateSosReportStatusInput = z.infer<
  typeof updateSosReportStatusInputSchema
>;
export type CommunityPostType = z.infer<typeof communityPostTypeSchema>;
export type CommunityAuthor = z.infer<typeof communityAuthorSchema>;
export type CommunityReply = z.infer<typeof communityReplySchema>;
export type CommunityIssueLink = z.infer<typeof communityIssueLinkSchema>;
export type CommunityAdopter = z.infer<typeof communityAdopterSchema>;
export type CommunityPost = z.infer<typeof communityPostSchema>;
export type CreateCommunityPostInput = z.infer<
  typeof createCommunityPostInputSchema
>;
export type CreateCommunityReplyInput = z.infer<
  typeof createCommunityReplyInputSchema
>;
export type IssueFilters = z.infer<typeof issueFiltersSchema>;
export type MunicipalityType = z.infer<typeof municipalityTypeSchema>;
export type Municipality = z.infer<typeof municipalitySchema>;
export type MunicipalityRegistration = z.infer<
  typeof municipalityRegistrationSchema
>;
export type CreateMunicipality = z.infer<typeof createMunicipalitySchema>;
export type UpdateMunicipality = z.infer<typeof updateMunicipalitySchema>;
export type UserRole = z.infer<typeof userRoleSchema>;
export type User = z.infer<typeof userSchema>;
export type LoginInput = z.infer<typeof loginInputSchema>;
export type ClassificationResult = z.infer<typeof classificationResultSchema>;
export type VerificationResult = z.infer<typeof verificationResultSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
