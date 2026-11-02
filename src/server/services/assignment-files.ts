import "server-only";
import { getAdminServices } from "@/lib/firebase/admin";

export const SAFE_ASSIGNMENT_FILE_TYPES = {
  "application/pdf": ["pdf"],
  "application/msword": ["doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "text/plain": ["txt"],
  "text/csv": ["csv"],
} as const;
export type AssignmentMime = keyof typeof SAFE_ASSIGNMENT_FILE_TYPES;

const ZIP_LOCAL_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * Verifies that file contents match the declared MIME type (magic bytes), independent of the
 * browser-supplied `file.type`. OOXML files must be ZIP containers holding the expected part folder.
 */
export function signatureMatches(type: string, bytes: Buffer) {
  if (type === "application/pdf") return bytes.subarray(0, 5).toString() === "%PDF-";
  if (type === "image/png")
    return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === "image/jpeg")
    return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/webp")
    return (
      bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP"
    );
  if (type === "application/msword")
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  if (type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    return bytes.subarray(0, 4).equals(ZIP_LOCAL_HEADER) && bytes.includes("word/");
  if (type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    return bytes.subarray(0, 4).equals(ZIP_LOCAL_HEADER) && bytes.includes("xl/");
  if (type === "text/plain" || type === "text/csv")
    return !bytes.subarray(0, Math.min(bytes.length, 8192)).includes(0);
  return false;
}

export function validateAssignmentFile(
  file: File,
  bytes: Buffer,
  allowedMimeTypes: string[],
  maxBytes: number,
) {
  const type = file.type as AssignmentMime;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const allowedExtensions = SAFE_ASSIGNMENT_FILE_TYPES[type];
  if (
    !allowedExtensions ||
    !allowedMimeTypes.includes(type) ||
    !allowedExtensions.includes(extension as never)
  )
    return "This file type is not approved by the school.";
  if (file.size < 1 || file.size > maxBytes)
    return `File size must be between 1 byte and ${Math.floor(maxBytes / (1024 * 1024))} MB.`;
  if (!signatureMatches(file.type, bytes))
    return "The file content does not match its declared type.";
  return null;
}

export async function savePrivateAssignmentFile(
  path: string,
  file: File,
  bytes: Buffer,
  schoolId: string,
  uploadedBy: string,
) {
  const { bucket } = getAdminServices();
  await bucket.file(path).save(bytes, {
    resumable: false,
    metadata: {
      contentType: file.type,
      cacheControl: "private, no-store",
      metadata: { schoolId, uploadedBy },
    },
  });
  return {
    name: file.name.split(/[\\/]/).pop()?.slice(0, 150) ?? "attachment",
    contentType: file.type,
    size: file.size,
    storagePath: path,
    uploadedBy,
    uploadedAt: new Date(),
    schoolId,
  };
}
