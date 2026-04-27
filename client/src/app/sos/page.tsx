"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Header, Footer } from "@/components/layout";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPicker } from "@/components/map";
import { sosApi, type SosReport, type SosReportStatus } from "@/lib/api";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  LocateFixed,
  Loader2,
  MapPin,
  RefreshCw,
} from "lucide-react";

type UserRole = "USER" | "MUNICIPALITY_USER" | "PLATFORM_MAINTAINER" | "admin" | null;

const statusLabel: Record<SosReportStatus, string> = {
  ACTIVE: "Active",
  ACKNOWLEDGED: "Acknowledged",
  RESOLVED: "Resolved",
};

const statusClasses: Record<SosReportStatus, string> = {
  ACTIVE: "bg-red-100 text-red-700 border-red-200",
  ACKNOWLEDGED: "bg-amber-100 text-amber-700 border-amber-200",
  RESOLVED: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

export default function SosPage() {
  const { userProfile, getToken, loading, profileLoading } = useAuth();
  const role = (userProfile?.role ?? null) as UserRole;
  const isOpsView = role === "MUNICIPALITY_USER" || role === "PLATFORM_MAINTAINER" || role === "admin";

  const [note, setNote] = useState("");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [alerts, setAlerts] = useState<SosReport[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<SosReportStatus | "all">("ACTIVE");
  const [actingId, setActingId] = useState<string | null>(null);

  const fetchCurrentLocation = useCallback(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      toast.error("Location services are not available in this browser");
      return;
    }

    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setLocationLoading(false);
      },
      () => {
        setLocationLoading(false);
        toast.error("Could not fetch your location. You can still pick it on the map.");
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  }, []);

  const fetchAlerts = useCallback(async () => {
    if (!isOpsView) {
      setAlertsLoading(false);
      return;
    }

    setAlertsLoading(true);
    try {
      const token = await getToken();
      const response = await sosApi.getAll(
        { status: statusFilter, pageSize: 50 },
        token
      );

      if (response.success && response.data) {
        setAlerts(response.data.items);
      } else {
        toast.error(response.error || "Failed to load SOS alerts");
      }
    } catch (error) {
      console.error("Error fetching SOS alerts:", error);
      toast.error("Failed to load SOS alerts");
    } finally {
      setAlertsLoading(false);
    }
  }, [getToken, isOpsView, statusFilter]);

  useEffect(() => {
    if (!isOpsView) {
      fetchCurrentLocation();
    }
  }, [fetchCurrentLocation, isOpsView]);

  useEffect(() => {
    void fetchAlerts();
  }, [fetchAlerts]);

  const handleSendSos = async () => {
    if (!location) {
      toast.error("Add your location before sending an SOS");
      return;
    }

    setSubmitting(true);
    try {
      const token = await getToken();
      const response = await sosApi.create(
        {
          location: {
            latitude: location.lat,
            longitude: location.lng,
          },
          note: note.trim() || null,
        },
        token
      );

      if (response.success) {
        toast.success("Emergency SOS sent", {
          description: "Nearby authorities and platform admins were alerted.",
        });
        setNote("");
      } else {
        toast.error(response.error || "Failed to send SOS alert");
      }
    } catch (error) {
      console.error("Error sending SOS:", error);
      toast.error("Failed to send SOS alert");
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (id: string, status: SosReportStatus) => {
    setActingId(id);
    try {
      const token = await getToken();
      if (!token) {
        toast.error("You must be signed in to manage SOS alerts");
        return;
      }

      const response = await sosApi.updateStatus(id, status, token);
      if (response.success) {
        toast.success(`SOS alert marked as ${statusLabel[status].toLowerCase()}`);
        await fetchAlerts();
      } else {
        toast.error(response.error || "Failed to update SOS alert");
      }
    } catch (error) {
      console.error("Error updating SOS alert:", error);
      toast.error("Failed to update SOS alert");
    } finally {
      setActingId(null);
    }
  };

  const title = useMemo(() => {
    if (isOpsView) {
      return "Emergency SOS Alerts";
    }
    return "Emergency SOS";
  }, [isOpsView]);

  return (
    <div className="min-h-screen flex flex-col bg-muted/30">
      <Header />

      <main className="flex-1 container px-4 py-8">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="rounded-2xl border border-red-200 bg-gradient-to-br from-red-50 via-white to-red-100 p-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Critical Civic Emergency
                </div>
                <h1 className="text-3xl font-bold tracking-tight text-gray-900">{title}</h1>
                <p className="max-w-2xl text-sm text-gray-600">
                  {isOpsView
                    ? "Track and respond to high-priority SOS alerts reported by citizens in real time."
                    : "Use this only for urgent civic emergencies. This is separate from regular issue reporting and immediately alerts authorities with your live location."}
                </p>
              </div>
              {!isOpsView ? (
                <Button
                  variant="outline"
                  className="border-red-200 text-red-700 hover:bg-red-50"
                  onClick={fetchCurrentLocation}
                  disabled={locationLoading}
                >
                  {locationLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <LocateFixed className="mr-2 h-4 w-4" />
                  )}
                  Refresh Location
                </Button>
              ) : (
                <Button
                  variant="outline"
                  className="border-red-200 text-red-700 hover:bg-red-50"
                  onClick={() => void fetchAlerts()}
                  disabled={alertsLoading}
                >
                  {alertsLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Refresh Alerts
                </Button>
              )}
            </div>
          </div>

          {loading || profileLoading ? (
            <Card>
              <CardContent className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </CardContent>
            </Card>
          ) : isOpsView ? (
            <Card>
              <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle>Manage SOS Queue</CardTitle>
                  <CardDescription>
                    Active alerts appear here first, with quick actions for acknowledgment and resolution.
                  </CardDescription>
                </div>
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as SosReportStatus | "all")}>
                  <SelectTrigger className="w-full md:w-[180px]">
                    <SelectValue placeholder="Filter status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="ACKNOWLEDGED">Acknowledged</SelectItem>
                    <SelectItem value="RESOLVED">Resolved</SelectItem>
                    <SelectItem value="all">All Alerts</SelectItem>
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent className="space-y-4">
                {alertsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : alerts.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                    No SOS alerts found for this filter.
                  </div>
                ) : (
                  alerts.map((alert) => (
                    <div
                      key={alert.id}
                      className="rounded-xl border bg-white p-4 shadow-sm"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className={statusClasses[alert.status]}>
                              {statusLabel[alert.status]}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {new Date(alert.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-sm font-medium text-gray-900">
                            {alert.note?.trim() || "No extra note was attached to this SOS."}
                          </p>
                          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="h-3.5 w-3.5" />
                              {alert.region.municipality}, {alert.region.district}
                            </span>
                            <span>
                              {alert.location.latitude.toFixed(5)}, {alert.location.longitude.toFixed(5)}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {alert.status === "ACTIVE" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleStatusChange(alert.id, "ACKNOWLEDGED")}
                              disabled={actingId === alert.id}
                            >
                              {actingId === alert.id ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <Clock3 className="mr-2 h-4 w-4" />
                              )}
                              Acknowledge
                            </Button>
                          )}
                          {alert.status !== "RESOLVED" && (
                            <Button
                              size="sm"
                              className="bg-emerald-600 hover:bg-emerald-700"
                              onClick={() => void handleStatusChange(alert.id, "RESOLVED")}
                              disabled={actingId === alert.id}
                            >
                              {actingId === alert.id ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <CheckCircle2 className="mr-2 h-4 w-4" />
                              )}
                              Resolve
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <Card className="border-red-200">
                <CardHeader>
                  <CardTitle>One-Tap Emergency Trigger</CardTitle>
                  <CardDescription>
                    Your current location is the key input. Add an optional note only if it helps.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="sos-note">Optional emergency note</Label>
                    <Textarea
                      id="sos-note"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      rows={3}
                      placeholder="Example: tree fallen across road, electric wire down, water main burst..."
                    />
                  </div>

                  <div className="rounded-xl border border-red-100 bg-red-50/60 p-4">
                    <div className="flex items-start gap-3">
                      <MapPin className="mt-0.5 h-5 w-5 text-red-600" />
                      <div className="space-y-1 text-sm">
                        <p className="font-medium text-red-800">Live location</p>
                        <p className="text-red-700">
                          {location
                            ? `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`
                            : "Waiting for location. You can refresh or choose the spot on the map below."}
                        </p>
                      </div>
                    </div>
                  </div>

                  <MapPicker
                    selectedLocation={location}
                    onLocationSelect={(selected) => setLocation(selected)}
                    height="260px"
                  />

                  <Button
                    className="w-full bg-red-600 text-white hover:bg-red-700"
                    size="lg"
                    onClick={handleSendSos}
                    disabled={submitting || locationLoading || !location}
                  >
                    {submitting ? (
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    ) : (
                      <AlertTriangle className="mr-2 h-5 w-5" />
                    )}
                    Send Emergency SOS
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>When To Use SOS</CardTitle>
                  <CardDescription>
                    This is for urgent civic hazards, not standard complaints.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm text-muted-foreground">
                  <div className="rounded-xl border bg-muted/30 p-4">
                    Use SOS for situations like fallen electric wires, road-blocking fallen trees, major water leaks, or other immediate public-safety risks.
                  </div>
                  <div className="rounded-xl border bg-muted/30 p-4">
                    For normal potholes, garbage, signage, or non-urgent maintenance, use the regular report flow.
                  </div>
                  <div className="rounded-xl border bg-muted/30 p-4">
                    Signed-in users can receive follow-up notifications. Anonymous SOS reports still work, but they cannot receive push updates.
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
