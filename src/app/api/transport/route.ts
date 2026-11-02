import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = NonNullable<Awaited<ReturnType<typeof getSchoolContext>>>;
type RecordItem = Record<string, unknown> & { id: string };
type Point = { id: string; name: string; kind: "pickup" | "dropoff"; time?: string; order: number };

const pointSchema = z.object({
  id: z.string().trim().max(80).optional(),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["pickup", "dropoff"]),
  time: z.string().trim().max(20).optional(),
  order: z.number().int().min(1).max(200),
});
const vehicleFields = {
  registrationNumber: z.string().trim().min(1).max(30),
  vehicleType: z.string().trim().min(1).max(60),
  capacity: z.number().int().min(1).max(200),
  driver: z.string().trim().max(120),
  routeId: z.string().trim().max(128).optional().or(z.literal("")),
  status: z.enum(["available", "unavailable", "maintenance", "retired"]).default("available"),
  availability: z.enum(["available", "unavailable"]).default("available"),
  schedule: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(500).optional(),
};
const routeFields = {
  name: z.string().trim().min(2).max(100),
  schedule: z.string().trim().min(1).max(300),
  feeAmount: z.number().nonnegative().max(100000000),
  pickupPoints: z.array(pointSchema).min(1).max(100),
  assignedVehicleId: z.string().trim().max(128).optional().or(z.literal("")),
  status: z.enum(["active", "inactive"]).default("active"),
};

const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_vehicle"), ...vehicleFields }),
  z.object({ action: z.literal("create_route"), ...routeFields }),
  z.object({
    action: z.literal("assign_student"),
    studentId: z.string().trim().min(1).max(128),
    routeId: z.string().trim().min(1).max(128),
    pickupPointId: z.string().trim().min(1).max(80),
    dropoffPointId: z.string().trim().min(1).max(80),
    feeAmount: z.number().nonnegative().max(100000000).optional(),
  }),
  z.object({
    action: z.literal("record_maintenance"),
    vehicleId: z.string().trim().min(1).max(128),
    serviceDate: z.string().date(),
    nextServiceDate: z.string().date(),
    description: z.string().trim().min(2).max(500),
    status: z.enum(["scheduled", "in_progress", "completed", "overdue"]).default("scheduled"),
    cost: z.number().nonnegative().max(100000000).optional(),
  }),
  z.object({
    action: z.literal("link_fee_invoice"),
    assignmentId: z.string().trim().min(1).max(128),
    financeInvoiceId: z.string().trim().min(1).max(128),
  }),
]);

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update_vehicle"),
    id: z.string().min(1),
    ...z.object(vehicleFields).partial().shape,
  }),
  z.object({
    action: z.literal("update_route"),
    id: z.string().min(1),
    ...z.object(routeFields).partial().shape,
  }),
  z.object({
    action: z.literal("update_assignment"),
    id: z.string().min(1),
    routeId: z.string().min(1).optional(),
    pickupPointId: z.string().min(1).optional(),
    dropoffPointId: z.string().min(1).optional(),
    status: z.enum(["active", "inactive"]).optional(),
    feeAmount: z.number().nonnegative().max(100000000).optional(),
  }),
  z.object({
    action: z.literal("update_maintenance"),
    id: z.string().min(1),
    nextServiceDate: z.string().date().optional(),
    status: z.enum(["scheduled", "in_progress", "completed", "overdue"]).optional(),
    description: z.string().trim().min(2).max(500).optional(),
    cost: z.number().nonnegative().max(100000000).optional(),
  }),
]);

function denied(message = "Transport access denied") {
  return NextResponse.json({ error: message }, { status: 403 });
}
function rootFor(context: Context) {
  return getAdminServices().db.collection("schools").doc(context.schoolId);
}
function toItem(
  doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot,
): RecordItem {
  return { id: doc.id, ...((doc.data() ?? {}) as Record<string, unknown>) };
}
function csvValue(value: unknown) {
  const text = Array.isArray(value)
    ? value
        .map((item) => (typeof item === "object" ? JSON.stringify(item) : String(item)))
        .join("; ")
    : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}
function csv(items: Record<string, unknown>[]) {
  const keys = [...new Set(items.flatMap((item) => Object.keys(item)))];
  return [
    keys.map(csvValue).join(","),
    ...items.map((item) => keys.map((key) => csvValue(item[key])).join(",")),
  ].join("\n");
}
function orderedPoints(points: Point[]) {
  return [...points].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}
async function audit(
  context: Context,
  action: string,
  recordType: string,
  recordId: string,
  extra: Record<string, unknown> = {},
) {
  await rootFor(context)
    .collection("auditLogs")
    .add({
      schoolId: context.schoolId,
      actorUid: context.uid,
      action,
      recordType,
      recordId,
      occurredAt: new Date(),
      ...extra,
    });
}
async function ensureRoute(context: Context, routeId: string) {
  const route = await rootFor(context).collection("transportRoutes").doc(routeId).get();
  return route.exists ? route : null;
}
async function ensureVehicle(context: Context, vehicleId: string) {
  const vehicle = await rootFor(context).collection("transportVehicles").doc(vehicleId).get();
  return vehicle.exists ? vehicle : null;
}
async function ensureStudent(context: Context, studentId: string) {
  const student = await rootFor(context).collection("students").doc(studentId).get();
  if (!student.exists) return false;
  const data = student.data() ?? {};
  if (
    data.status === "archived" ||
    (typeof data.schoolId === "string" && data.schoolId !== context.schoolId) ||
    (typeof data.activeSchoolId === "string" && data.activeSchoolId !== context.schoolId)
  )
    return false;
  return true;
}
function permissionForRead(context: Context) {
  return (
    hasPermission(context.permissions, "transport.read") ||
    hasPermission(context.permissions, "transport.manage")
  );
}

export async function GET(request: NextRequest) {
  const context = await getSchoolContext();
  if (!context) return denied("School access required");
  if (!permissionForRead(context)) return denied();
  const type = request.nextUrl.searchParams.get("type") ?? "dashboard";
  const dataset = request.nextUrl.searchParams.get("dataset") ?? type;
  const root = rootFor(context);
  try {
    const [vehicleSnap, routeSnap, assignmentSnap, maintenanceSnap] = await Promise.all([
      root.collection("transportVehicles").limit(500).get(),
      root.collection("transportRoutes").limit(500).get(),
      root.collection("transportAssignments").limit(1500).get(),
      root.collection("transportMaintenance").limit(1000).get(),
    ]);
    const vehicles = vehicleSnap.docs.map(toItem);
    const routes = routeSnap.docs.map(toItem);
    const assignments = assignmentSnap.docs.map(toItem);
    const maintenance = maintenanceSnap.docs.map(toItem);
    const routeById = new Map(routes.map((route) => [route.id, route]));
    const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
    const passengerItems = assignments.map((assignment) => ({
      ...assignment,
      routeName: routeById.get(String(assignment.routeId))?.name ?? "Unknown route",
      configuredFee:
        assignment.feeAmount ?? routeById.get(String(assignment.routeId))?.feeAmount ?? 0,
    }));
    const feeItems = routes.map((route) => ({
      id: route.id,
      routeId: route.id,
      routeName: route.name,
      feeAmount: route.feeAmount ?? 0,
      passengerCount: assignments.filter(
        (item) => item.routeId === route.id && item.status !== "inactive",
      ).length,
      linkedInvoiceCount: assignments.filter(
        (item) => item.routeId === route.id && item.financeInvoiceId,
      ).length,
    }));
    if (type === "csv") {
      const source =
        dataset === "vehicles"
          ? vehicles
          : dataset === "routes"
            ? routes
            : dataset === "maintenance"
              ? maintenance
              : dataset === "fees"
                ? feeItems
                : passengerItems;
      return new NextResponse(csv(source), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="transport-${dataset}.csv"`,
          "Cache-Control": "private,no-store",
        },
      });
    }
    if (type === "dashboard") {
      const today = new Date().toISOString().slice(0, 10);
      const dueMaintenance = maintenance.filter(
        (item) =>
          typeof item.nextServiceDate === "string" &&
          item.nextServiceDate <= today &&
          item.status !== "completed",
      );
      return NextResponse.json(
        {
          dashboard: {
            vehicleCount: vehicles.length,
            availableVehicles: vehicles.filter(
              (item) => item.availability === "available" && item.status !== "retired",
            ).length,
            routeCount: routes.filter((item) => item.status !== "inactive").length,
            passengerCount: assignments.filter((item) => item.status !== "inactive").length,
            configuredFees: feeItems.reduce((sum, item) => sum + Number(item.feeAmount ?? 0), 0),
            maintenanceDue: dueMaintenance.length,
            noLiveLocation: true,
          },
          vehicles,
          routes,
          passengers: passengerItems,
          maintenance,
          fees: feeItems,
        },
        { headers: { "Cache-Control": "private,no-store" } },
      );
    }
    const items =
      type === "vehicles"
        ? vehicles.map((item) => ({
            ...item,
            routeName: routeById.get(String(item.routeId))?.name ?? "Unassigned",
          }))
        : type === "routes"
          ? routes.map((item) => ({
              ...item,
              vehicleRegistration:
                vehicleById.get(String(item.assignedVehicleId))?.registrationNumber ?? "Unassigned",
              passengerCount: assignments.filter(
                (assignment) => assignment.routeId === item.id && assignment.status !== "inactive",
              ).length,
            }))
          : type === "passengers" || type === "roster"
            ? passengerItems
            : type === "maintenance"
              ? maintenance.map((item) => ({
                  ...item,
                  registrationNumber:
                    vehicleById.get(String(item.vehicleId))?.registrationNumber ?? "Unknown",
                }))
              : type === "fees"
                ? feeItems
                : [];
    if (!["vehicles", "routes", "passengers", "roster", "maintenance", "fees"].includes(type))
      return NextResponse.json({ error: "Unknown transport data" }, { status: 400 });
    return NextResponse.json({ items }, { headers: { "Cache-Control": "private,no-store" } });
  } catch {
    return NextResponse.json({ error: "Transport data unavailable" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const context = await getSchoolContext();
  if (!context) return denied("School access required");
  if (!hasPermission(context.permissions, "transport.manage"))
    return denied("Transport management permission required");
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid transport request", fields: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  const root = rootFor(context);
  try {
    const data = parsed.data;
    if (data.action === "create_vehicle") {
      if (data.routeId && !(await ensureRoute(context, data.routeId)))
        return NextResponse.json({ error: "Route not found in this school" }, { status: 400 });
      const ref = root.collection("transportVehicles").doc();
      await ref.set({
        ...data,
        routeId: data.routeId || null,
        schoolId: context.schoolId,
        createdAt: new Date(),
        createdBy: context.uid,
        updatedAt: new Date(),
      });
      await audit(context, "transport.vehicle.created", "transportVehicle", ref.id);
      return NextResponse.json({ id: ref.id }, { status: 201 });
    }
    if (data.action === "create_route") {
      if (data.assignedVehicleId && !(await ensureVehicle(context, data.assignedVehicleId)))
        return NextResponse.json(
          { error: "Assigned vehicle not found in this school" },
          { status: 400 },
        );
      const points = orderedPoints(
        data.pickupPoints.map((point, index) => ({
          ...point,
          id: point.id || `point-${index + 1}`,
        })),
      );
      if (
        !points.some((point) => point.kind === "pickup") ||
        !points.some((point) => point.kind === "dropoff")
      )
        return NextResponse.json(
          { error: "A route must include at least one pickup and one drop-off point" },
          { status: 400 },
        );
      const ref = root.collection("transportRoutes").doc();
      await ref.set({
        ...data,
        pickupPoints: points,
        assignedVehicleId: data.assignedVehicleId || null,
        schoolId: context.schoolId,
        createdAt: new Date(),
        createdBy: context.uid,
        updatedAt: new Date(),
      });
      await audit(context, "transport.route.created", "transportRoute", ref.id);
      return NextResponse.json({ id: ref.id }, { status: 201 });
    }
    if (data.action === "assign_student") {
      const route = await ensureRoute(context, data.routeId);
      if (!route)
        return NextResponse.json({ error: "Route not found in this school" }, { status: 404 });
      if (!(await ensureStudent(context, data.studentId)))
        return NextResponse.json(
          { error: "Student is not registered in this school" },
          { status: 400 },
        );
      const points = (route.get("pickupPoints") ?? []) as Point[];
      const pickup = points.find(
        (point) => point.id === data.pickupPointId && point.kind === "pickup",
      );
      const dropoff = points.find(
        (point) => point.id === data.dropoffPointId && point.kind === "dropoff",
      );
      if (!pickup || !dropoff)
        return NextResponse.json(
          { error: "Pickup and drop-off points must belong to the selected route" },
          { status: 400 },
        );
      const assignmentRef = root.collection("transportAssignments").doc(data.studentId);
      const existing = await assignmentRef.get();
      if (existing.exists && existing.get("status") !== "inactive")
        return NextResponse.json(
          { error: "This student already has an active transport assignment" },
          { status: 409 },
        );
      const vehicleId = route.get("assignedVehicleId");
      if (typeof vehicleId === "string" && vehicleId) {
        const vehicle = await ensureVehicle(context, vehicleId);
        const current = await root
          .collection("transportAssignments")
          .where("routeId", "==", data.routeId)
          .limit(500)
          .get();
        const activeCount = current.docs.filter(
          (assignment) => assignment.get("status") === "active",
        ).length;
        if (vehicle && activeCount >= Number(vehicle.get("capacity") ?? 0))
          return NextResponse.json(
            { error: "The assigned vehicle has reached capacity" },
            { status: 409 },
          );
      }
      await assignmentRef.set(
        {
          ...data,
          id: assignmentRef.id,
          feeAmount: data.feeAmount ?? route.get("feeAmount") ?? 0,
          status: "active",
          studentId: data.studentId,
          schoolId: context.schoolId,
          assignedAt: new Date(),
          assignedBy: context.uid,
          updatedAt: new Date(),
        },
        { merge: true },
      );
      await audit(context, "transport.student.assigned", "transportAssignment", assignmentRef.id, {
        routeId: data.routeId,
        studentId: data.studentId,
      });
      return NextResponse.json({ id: assignmentRef.id }, { status: 201 });
    }
    if (data.action === "record_maintenance") {
      if (data.nextServiceDate < data.serviceDate)
        return NextResponse.json(
          { error: "Next service date must be on or after service date" },
          { status: 400 },
        );
      if (!(await ensureVehicle(context, data.vehicleId)))
        return NextResponse.json({ error: "Vehicle not found in this school" }, { status: 404 });
      const ref = root.collection("transportMaintenance").doc();
      await ref.set({
        ...data,
        schoolId: context.schoolId,
        createdAt: new Date(),
        createdBy: context.uid,
        updatedAt: new Date(),
      });
      await audit(context, "transport.maintenance.created", "transportMaintenance", ref.id, {
        vehicleId: data.vehicleId,
      });
      return NextResponse.json({ id: ref.id }, { status: 201 });
    }
    const assignment = await root.collection("transportAssignments").doc(data.assignmentId).get();
    if (!assignment.exists)
      return NextResponse.json({ error: "Transport assignment not found" }, { status: 404 });
    if (!hasPermission(context.permissions, "finance.manage"))
      return denied("Finance permission is required to link a transport fee to an invoice");
    const invoice = await root.collection("invoices").doc(data.financeInvoiceId).get();
    if (!invoice.exists)
      return NextResponse.json(
        { error: "Finance invoice not found in this school" },
        { status: 404 },
      );
    await assignment.ref.update({
      financeInvoiceId: data.financeInvoiceId,
      feeTracking: "finance_invoice",
      updatedAt: new Date(),
      updatedBy: context.uid,
    });
    await audit(context, "transport.fee.invoice_linked", "transportAssignment", data.assignmentId, {
      financeInvoiceId: data.financeInvoiceId,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Transport record could not be saved" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const context = await getSchoolContext();
  if (!context) return denied("School access required");
  if (!hasPermission(context.permissions, "transport.manage"))
    return denied("Transport management permission required");
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid transport update", fields: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  const root = rootFor(context);
  try {
    const data = parsed.data;
    const collection =
      data.action === "update_vehicle"
        ? "transportVehicles"
        : data.action === "update_route"
          ? "transportRoutes"
          : data.action === "update_assignment"
            ? "transportAssignments"
            : "transportMaintenance";
    const recordId = String(data.id);
    const ref = root.collection(collection).doc(recordId);
    const current = await ref.get();
    if (!current.exists)
      return NextResponse.json({ error: "Transport record not found" }, { status: 404 });
    const changes: Record<string, unknown> = { ...data };
    delete changes.action;
    delete changes.id;
    const routeId = typeof changes.routeId === "string" ? changes.routeId : "";
    const assignedVehicleId =
      typeof changes.assignedVehicleId === "string" ? changes.assignedVehicleId : "";
    if (data.action === "update_vehicle" && routeId && !(await ensureRoute(context, routeId)))
      return NextResponse.json({ error: "Route not found in this school" }, { status: 400 });
    if (
      data.action === "update_route" &&
      assignedVehicleId &&
      !(await ensureVehicle(context, assignedVehicleId))
    )
      return NextResponse.json({ error: "Vehicle not found in this school" }, { status: 400 });
    if (data.action === "update_route" && Array.isArray(changes.pickupPoints)) {
      const points = changes.pickupPoints as Point[];
      changes.pickupPoints = orderedPoints(
        points.map((point, index) => ({ ...point, id: point.id || `point-${index + 1}` })),
      );
    }
    if (data.action === "update_assignment" && routeId) {
      const route = await ensureRoute(context, routeId);
      if (!route)
        return NextResponse.json({ error: "Route not found in this school" }, { status: 400 });
      const points = (route.get("pickupPoints") ?? []) as Point[];
      const pickupPointId = typeof changes.pickupPointId === "string" ? changes.pickupPointId : "";
      const dropoffPointId =
        typeof changes.dropoffPointId === "string" ? changes.dropoffPointId : "";
      if (
        pickupPointId &&
        !points.some((point) => point.id === pickupPointId && point.kind === "pickup")
      )
        return NextResponse.json({ error: "Pickup point is not on this route" }, { status: 400 });
      if (
        dropoffPointId &&
        !points.some((point) => point.id === dropoffPointId && point.kind === "dropoff")
      )
        return NextResponse.json({ error: "Drop-off point is not on this route" }, { status: 400 });
    }
    await ref.update({ ...changes, updatedAt: new Date(), updatedBy: context.uid });
    await audit(context, `transport.${collection}.updated`, collection, recordId, {
      changedFields: Object.keys(changes),
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Transport update failed" }, { status: 500 });
  }
}
