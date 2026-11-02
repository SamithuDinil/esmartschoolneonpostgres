import { z } from "zod";

export const inventoryCategory = z.enum([
  "computers",
  "printers",
  "laboratory_equipment",
  "furniture",
  "sports_equipment",
  "office_supplies",
  "classroom_resources",
]);

export const inventoryCondition = z.enum(["new", "good", "needs_repair", "out_of_service"]);

export const inventoryAssetSchema = z.object({
  action: z.literal("create_asset"),
  name: z.string().trim().min(2).max(160),
  assetCode: z.string().trim().min(2).max(50),
  category: inventoryCategory,
  quantity: z.coerce.number().int().min(0).max(1_000_000),
  minimumStock: z.coerce.number().int().min(0).max(1_000_000),
  location: z.string().trim().min(1).max(160),
  condition: inventoryCondition,
  purchaseDate: z.string().trim().max(30).optional().default(""),
  supplier: z.string().trim().max(160).optional().default(""),
  unitCostMinor: z.coerce.number().int().min(0).max(10_000_000_000).optional().default(0),
});

export const inventoryMovementSchema = z.object({
  action: z.literal("movement"),
  assetId: z.string().trim().min(1).max(160),
  movementType: z.enum(["stock_in", "stock_out", "adjustment"]),
  quantity: z.coerce.number().int().min(1).max(1_000_000),
  reason: z.string().trim().min(2).max(500),
  reference: z.string().trim().max(160).optional().default(""),
});

export const supplierSchema = z.object({
  action: z.literal("create_supplier"),
  name: z.string().trim().min(2).max(160),
  contactName: z.string().trim().max(120).optional().default(""),
  phone: z.string().trim().max(30).optional().default(""),
  email: z.email().max(254).or(z.literal("")).optional().default(""),
});

export const maintenanceSchema = z.object({
  action: z.literal("create_maintenance"),
  assetId: z.string().trim().min(1).max(160),
  scheduledDate: z.string().trim().min(1).max(30),
  maintenanceType: z.string().trim().min(2).max(120),
  notes: z.string().trim().max(1000).optional().default(""),
  status: z.enum(["scheduled", "in_progress", "completed"]).default("scheduled"),
});

export const transferSchema = z.object({
  action: z.literal("transfer"),
  assetId: z.string().trim().min(1).max(160),
  fromLocation: z.string().trim().min(1).max(160),
  toLocation: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(2).max(500),
});

export const inventoryRecordSchema = z.discriminatedUnion("action", [
  inventoryAssetSchema,
  inventoryMovementSchema,
  supplierSchema,
  maintenanceSchema,
  transferSchema,
]);
export type InventoryRecordInput = z.infer<typeof inventoryRecordSchema>;
