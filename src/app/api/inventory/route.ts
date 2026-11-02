import { FieldValue } from "@/lib/firebase/rtdb-transforms";
import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import { inventoryRecordSchema } from "@/server/schemas/inventory";

export const dynamic = "force-dynamic";

function serialize(data: FirebaseFirestore.DocumentData): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (
      value &&
      typeof value === "object" &&
      "toDate" in value &&
      typeof value.toDate === "function"
    )
      result[key] = value.toDate().toISOString();
    else if (value instanceof Date) result[key] = value.toISOString();
    else if (Array.isArray(value))
      result[key] = value.map((item) => (item instanceof Date ? item.toISOString() : item));
    else if (["string", "number", "boolean"].includes(typeof value) || value === null)
      result[key] = value;
  }
  return result;
}

function rootFor(schoolId: string) {
  return getAdminServices().db.collection("schools").doc(schoolId);
}

function canRead(permissions: readonly string[]) {
  return (
    hasPermission(permissions, "inventory.read") ||
    hasPermission(permissions, "inventory.manage") ||
    hasPermission(permissions, "inventory.reports.read")
  );
}

function canManage(permissions: readonly string[]) {
  return hasPermission(permissions, "inventory.manage");
}

export async function GET() {
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!canRead(context.permissions))
    return NextResponse.json({ error: "Inventory access is restricted." }, { status: 403 });
  const root = rootFor(context.schoolId);
  const [assets, movements, suppliers] = await Promise.all([
    root.collection("inventoryItems").where("status", "!=", "archived").limit(500).get(),
    root
      .collection("inventoryMovements")
      .orderBy("createdAt", "desc")
      .limit(100)
      .get()
      .catch(() => root.collection("inventoryMovements").limit(100).get()),
    root.collection("suppliers").where("status", "!=", "archived").limit(200).get(),
  ]);
  const items: Array<Record<string, unknown> & { id: string }> = assets.docs.map((doc) => ({
    id: doc.id,
    ...serialize(doc.data()),
  }));
  const lowStock = items.filter(
    (item) => Number(item.quantity ?? 0) <= Number(item.minimumStock ?? 0),
  );
  return NextResponse.json({
    items,
    movements: movements.docs.map((doc) => ({ id: doc.id, ...serialize(doc.data()) })),
    suppliers: suppliers.docs.map((doc) => ({ id: doc.id, ...serialize(doc.data()) })),
    summary: {
      totalAssets: items.length,
      totalUnits: items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0),
      lowStock: lowStock.length,
      categories: new Set(items.map((item) => item.category)).size,
    },
  });
}

export async function POST(request: NextRequest) {
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!canManage(context.permissions))
    return NextResponse.json(
      { error: "Inventory changes require inventory.manage." },
      { status: 403 },
    );
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid security token." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const parsed = inventoryRecordSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: "The inventory request is invalid.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  const root = rootFor(context.schoolId);
  try {
    if (parsed.data.action === "create_asset") {
      const ref = root.collection("inventoryItems").doc();
      await ref.create({
        ...parsed.data,
        id: ref.id,
        status: "active",
        schoolId: context.schoolId,
        createdBy: context.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await root.collection("auditLogs").add({
        schoolId: context.schoolId,
        actorUid: context.uid,
        action: "inventory.asset.created",
        recordType: "inventoryItem",
        recordId: ref.id,
        occurredAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ id: ref.id });
    }
    if (parsed.data.action === "create_supplier") {
      const ref = root.collection("suppliers").doc();
      await ref.create({
        ...parsed.data,
        id: ref.id,
        status: "active",
        schoolId: context.schoolId,
        createdBy: context.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ id: ref.id });
    }
    const assetRef = root.collection("inventoryItems").doc(parsed.data.assetId);
    if (parsed.data.action === "create_maintenance") {
      const asset = await assetRef.get();
      if (!asset.exists)
        return NextResponse.json(
          { error: "The selected asset no longer exists." },
          { status: 404 },
        );
      const ref = root.collection("inventoryMaintenance").doc();
      await ref.create({
        ...parsed.data,
        id: ref.id,
        schoolId: context.schoolId,
        createdBy: context.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await root.collection("auditLogs").add({
        schoolId: context.schoolId,
        actorUid: context.uid,
        action: "inventory.maintenance.created",
        recordType: "inventoryMaintenance",
        recordId: ref.id,
        occurredAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ id: ref.id });
    }
    if (parsed.data.action === "transfer") {
      const transfer = parsed.data;
      const transferRef = root.collection("inventoryTransfers").doc();
      await getAdminServices().db.runTransaction(async (transaction) => {
        const asset = await transaction.get(assetRef);
        if (!asset.exists) throw new Error("ASSET_NOT_FOUND");
        transaction.update(assetRef, {
          location: transfer.toLocation,
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.create(transferRef, {
          ...transfer,
          id: transferRef.id,
          schoolId: context.schoolId,
          createdBy: context.uid,
          createdAt: FieldValue.serverTimestamp(),
        });
      });
      return NextResponse.json({ id: transferRef.id });
    }
    if (parsed.data.action === "movement") {
      const movement = parsed.data;
      const movementRef = root.collection("inventoryMovements").doc();
      await getAdminServices().db.runTransaction(async (transaction) => {
        const asset = await transaction.get(assetRef);
        if (!asset.exists) throw new Error("ASSET_NOT_FOUND");
        const current = Number(asset.get("quantity") ?? 0);
        const delta =
          movement.movementType === "stock_out"
            ? -movement.quantity
            : movement.movementType === "stock_in"
              ? movement.quantity
              : movement.quantity;
        const next = movement.movementType === "adjustment" ? movement.quantity : current + delta;
        if (next < 0) throw new Error("INSUFFICIENT_STOCK");
        transaction.update(assetRef, { quantity: next, updatedAt: FieldValue.serverTimestamp() });
        transaction.create(movementRef, {
          ...movement,
          id: movementRef.id,
          previousQuantity: current,
          resultingQuantity: next,
          schoolId: context.schoolId,
          createdBy: context.uid,
          createdAt: FieldValue.serverTimestamp(),
        });
      });
      return NextResponse.json({ id: movementRef.id });
    }
  } catch (error) {
    const message =
      error instanceof Error && error.message === "INSUFFICIENT_STOCK"
        ? "Stock-out would make the quantity negative."
        : error instanceof Error && error.message === "ASSET_NOT_FOUND"
          ? "The selected asset no longer exists."
          : "The inventory change could not be saved.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  return NextResponse.json({ error: "Unsupported inventory action." }, { status: 400 });
}
