import { Router, Response } from "express";
import type { Router as IRouter } from "express";
import { COLLECTIONS, getAdminDb } from "../shared/firebase";
import {
  authMiddleware,
  optionalAuthMiddleware,
  requireRole,
  type AuthenticatedRequest,
} from "../middleware/auth";
import {
  createSosReportInputSchema,
  paginationSchema,
  updateSosReportStatusInputSchema,
} from "../shared/validation";
import { findMunicipalityForLocation, getAdministrativeRegion } from "../services/location";
import { generateSosId } from "../shared/utils";
import { sendSosNotification } from "../services/notifications";
import type { AdministrativeRegion, SosReport as SosReportEntity } from "../shared/types";

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

function serializeSosDocument(
  doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot
): {
  id: string;
  note: string | null;
  location: { latitude: number; longitude: number };
  region: AdministrativeRegion;
  municipalityId: string;
  status: string;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
} | null {
  const data = doc.data();

  if (!data) {
    return null;
  }

  const { reportedByUid: _reportedByUid, ...publicData } = data;

  return {
    id: doc.id,
    note: (publicData.note as string | null | undefined) ?? null,
    location: publicData.location as { latitude: number; longitude: number },
    region: publicData.region as AdministrativeRegion,
    municipalityId: publicData.municipalityId as string,
    status: publicData.status as string,
    acknowledgedBy: (publicData.acknowledgedBy as string | null | undefined) ?? null,
    resolvedBy: (publicData.resolvedBy as string | null | undefined) ?? null,
    createdAt: toDateValue(publicData.createdAt),
    updatedAt: toDateValue(publicData.updatedAt),
    acknowledgedAt: toDateValue(publicData.acknowledgedAt),
    resolvedAt: toDateValue(publicData.resolvedAt),
  };
}

router.post(
  "/",
  optionalAuthMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const input = createSosReportInputSchema.parse(req.body);
      const db = getAdminDb();
      const now = new Date();
      const sosId = generateSosId();
      const { latitude, longitude } = input.location;

      let municipalityId = "MUN-DEFAULT";
      let municipalityData: {
        name?: string;
        district?: string;
        state?: string;
      } | null = null;

      try {
        const municipalityMatch = await findMunicipalityForLocation(latitude, longitude, db);
        if (municipalityMatch) {
          municipalityId = municipalityMatch.municipalityId;

          const municipalityDoc = await db
            .collection(COLLECTIONS.MUNICIPALITIES)
            .doc(municipalityId)
            .get();

          if (municipalityDoc.exists) {
            const data = municipalityDoc.data();
            municipalityData = {
              name: data?.name || municipalityMatch.name,
              district: data?.district,
              state: data?.state,
            };
          }
        }
      } catch (error) {
        console.warn("Failed to assign municipality for SOS:", error);
      }

      let region: AdministrativeRegion = {
        state: "Unknown",
        district: "Unknown",
        municipality: "Unknown",
      };

      try {
        const adminRegion = await getAdministrativeRegion(latitude, longitude);
        if (adminRegion?.state) {
          region = {
            state: adminRegion.state || "Unknown",
            district: adminRegion.district || "Unknown",
            municipality: adminRegion.municipality || "Unknown",
            ...(adminRegion.pincode ? { pincode: adminRegion.pincode } : {}),
          };
        } else if (municipalityData) {
          region = {
            state: municipalityData.state || "Unknown",
            district: municipalityData.district || "Unknown",
            municipality: municipalityData.name || "Unknown",
          };
        }
      } catch (error) {
        console.warn("Failed to resolve SOS region:", error);
        if (municipalityData) {
          region = {
            state: municipalityData.state || "Unknown",
            district: municipalityData.district || "Unknown",
            municipality: municipalityData.name || "Unknown",
          };
        }
      }

      const sosReport: Omit<SosReportEntity, "id"> = {
        note: input.note?.trim() || null,
        location: {
          latitude,
          longitude,
        },
        region,
        municipalityId,
        status: "ACTIVE" as const,
        reportedByUid: req.user?.uid ?? null,
        acknowledgedAt: null,
        acknowledgedBy: null,
        resolvedAt: null,
        resolvedBy: null,
        createdAt: now,
        updatedAt: now,
      };

      await db.collection(COLLECTIONS.SOS_REPORTS).doc(sosId).set(sosReport);

      sendSosNotification({
        sosId,
        municipalityId,
        note: sosReport.note,
        location: sosReport.location,
      }).catch((error) => {
        console.warn("Failed to send SOS notification:", error);
      });

      res.status(201).json({
        success: true,
        data: {
          id: sosId,
          note: sosReport.note,
          location: sosReport.location,
          region: sosReport.region,
          municipalityId: sosReport.municipalityId,
          status: sosReport.status,
          reportedByUid: null,
          acknowledgedAt: null,
          acknowledgedBy: null,
          resolvedAt: null,
          resolvedBy: null,
          createdAt: now,
          updatedAt: now,
        },
        error: null,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("Error creating SOS report:", error?.message || error);

      if (error.name === "ZodError") {
        return res.status(400).json({
          success: false,
          data: null,
          error:
            "Validation failed: " +
            error.errors.map((item: any) => item.message).join(", "),
          timestamp: new Date().toISOString(),
        });
      }

      res.status(500).json({
        success: false,
        data: null,
        error: "Failed to create SOS report",
        timestamp: new Date().toISOString(),
      });
    }
  }
);

router.get(
  "/",
  authMiddleware,
  requireRole("MUNICIPALITY_USER", "PLATFORM_MAINTAINER"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getAdminDb();
      const { page, pageSize } = paginationSchema.parse(req.query);
      const statusFilter =
        typeof req.query.status === "string" && req.query.status.trim()
          ? req.query.status
          : "ACTIVE";

      const snapshot = await db
        .collection(COLLECTIONS.SOS_REPORTS)
        .orderBy("createdAt", "desc")
        .limit(200)
        .get();

      let reports = snapshot.docs
        .map((doc) => serializeSosDocument(doc))
        .filter(
          (
            report
          ): report is NonNullable<ReturnType<typeof serializeSosDocument>> =>
            Boolean(report)
        );

      if (req.user?.role === "MUNICIPALITY_USER") {
        if (!req.user.municipalityId) {
          return res.status(403).json({
            success: false,
            data: null,
            error: "Municipality binding required",
            timestamp: new Date().toISOString(),
          });
        }

        reports = reports.filter(
          (report) => report?.municipalityId === req.user?.municipalityId
        );
      }

      if (statusFilter !== "all") {
        reports = reports.filter((report) => report?.status === statusFilter);
      }

      const total = reports.length;
      const startIndex = (page - 1) * pageSize;
      reports = reports.slice(startIndex, startIndex + pageSize);

      res.json({
        success: true,
        data: {
          items: reports,
          total,
          page,
          pageSize,
          hasMore: startIndex + reports.length < total,
        },
        error: null,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("Error fetching SOS reports:", error?.message || error);
      res.status(500).json({
        success: false,
        data: null,
        error: "Failed to fetch SOS reports",
        timestamp: new Date().toISOString(),
      });
    }
  }
);

router.patch(
  "/:id/status",
  authMiddleware,
  requireRole("MUNICIPALITY_USER", "PLATFORM_MAINTAINER"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsedInput = updateSosReportStatusInputSchema.parse(req.body);
      const db = getAdminDb();
      const docRef = db.collection(COLLECTIONS.SOS_REPORTS).doc(req.params.id);
      const doc = await docRef.get();

      if (!doc.exists) {
        return res.status(404).json({
          success: false,
          data: null,
          error: "SOS report not found",
          timestamp: new Date().toISOString(),
        });
      }

      const data = doc.data()!;
      if (
        req.user?.role === "MUNICIPALITY_USER" &&
        data.municipalityId !== req.user.municipalityId
      ) {
        return res.status(403).json({
          success: false,
          data: null,
          error: "SOS report not in your jurisdiction",
          timestamp: new Date().toISOString(),
        });
      }

      const now = new Date();
      const updateData: Record<string, unknown> = {
        status: parsedInput.status,
        updatedAt: now,
      };

      if (parsedInput.status === "ACKNOWLEDGED") {
        updateData.acknowledgedAt = now;
        updateData.acknowledgedBy = req.user?.uid || null;
      }

      if (parsedInput.status === "RESOLVED") {
        updateData.resolvedAt = now;
        updateData.resolvedBy = req.user?.uid || null;
        if (!data.acknowledgedAt) {
          updateData.acknowledgedAt = now;
          updateData.acknowledgedBy = req.user?.uid || null;
        }
      }

      await docRef.update(updateData);

      res.json({
        success: true,
        data: {
          id: req.params.id,
          ...updateData,
        },
        error: null,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("Error updating SOS status:", error?.message || error);

      if (error.name === "ZodError") {
        return res.status(400).json({
          success: false,
          data: null,
          error:
            "Validation failed: " +
            error.errors.map((item: any) => item.message).join(", "),
          timestamp: new Date().toISOString(),
        });
      }

      res.status(500).json({
        success: false,
        data: null,
        error: "Failed to update SOS status",
        timestamp: new Date().toISOString(),
      });
    }
  }
);

export { router as sosRoutes };
