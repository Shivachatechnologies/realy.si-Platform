import { AppError, invalid, notFound } from "@/server/core/errors";
import type { Db, Tx } from "@/server/core/db";
import { attachmentInput, ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from "./transactions";
import type { z } from "zod";

export type DocTarget = { billId: string } | { expenseClaimId: string };

/** Validate an uploaded file (type, size) and return its bytes. */
export function decodeAttachment(raw: z.input<typeof attachmentInput>) {
  const input = attachmentInput.parse(raw);
  if (!ATTACHMENT_TYPES.has(input.contentType)) throw invalid("Unsupported file type", { reason: "finance_attachment_type" });
  const data = Buffer.from(input.dataBase64, "base64");
  if (!data.length) throw invalid("Empty file", { reason: "finance_attachment_empty" });
  if (data.length > MAX_ATTACHMENT_BYTES) throw new AppError("payload_too_large", "Attachments are limited to 5 MB", { reason: "finance_attachment_too_large" });
  return { fileName: input.fileName.replace(/[\\/\r\n"]/g, "_"), contentType: input.contentType, data };
}

export async function upsertDocAttachment(tx: Tx, organizationId: string, companyId: string, target: DocTarget, file: ReturnType<typeof decodeAttachment>) {
  const where = "billId" in target ? { billId: target.billId } : { expenseClaimId: target.expenseClaimId };
  return tx.financeDocAttachment.upsert({
    where,
    create: { organizationId, companyId, ...where, fileName: file.fileName, contentType: file.contentType, sizeBytes: file.data.length, data: file.data },
    update: { fileName: file.fileName, contentType: file.contentType, sizeBytes: file.data.length, data: file.data, createdAt: new Date() },
    select: { id: true, fileName: true, sizeBytes: true },
  });
}

export async function findDocAttachment(client: Tx | Db, organizationId: string, companyId: string, target: DocTarget) {
  const a = await client.financeDocAttachment.findFirst({ where: { organizationId, companyId, ...target } });
  if (!a) throw notFound("Attachment");
  return a;
}

/** HTTP response for an attachment download (inline for PDFs and images, sandboxed). */
export function attachmentResponse(a: { data: Uint8Array; contentType: string; sizeBytes: number; fileName: string }) {
  const inline = a.contentType === "application/pdf" || a.contentType.startsWith("image/");
  return new Response(new Uint8Array(a.data), {
    headers: {
      "content-type": a.contentType,
      "content-length": String(a.sizeBytes),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.fileName)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "cache-control": "private, no-store",
    },
  });
}
