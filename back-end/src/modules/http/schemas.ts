import { z } from "zod";
import { MAX_NOTE_LENGTH } from "../../shared/types.js";

export const emailSchema = z.string().trim().email().max(254);
export const passwordSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/[A-Za-z]/)
  .regex(/\d/);
export const loginPasswordSchema = z.string().min(1).max(128);
export const publicIdSchema = z.string().uuid();
export const pageLimitSchema = z.coerce.number().int().min(1).max(50).optional();
export const historyDaysSchema = z.enum(["1", "7", "30", "90", "120"]).transform(Number).optional();

export const transferSchema = z
  .object({
    authorizationId: z.string().trim().uuid(),
    recipientAddress: z.string().trim().min(1).max(128),
    amount: z.string().min(1).max(32),
    note: z.string().max(MAX_NOTE_LENGTH).optional(),
    transferPassword: z.string().min(1).max(128).optional(),
    twoFactorCode: z.string().min(6).max(64).optional(),
  })
  .strict();

export const transferPreviewSchema = z
  .object({
    recipientAddress: z.string().trim().min(1).max(128),
    amount: z.string().min(1).max(32).optional(),
    note: z.string().max(MAX_NOTE_LENGTH).optional(),
  })
  .strict();

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    displayName: z.string().trim().min(1).max(32),
  })
  .strict();

export const loginSchema = z
  .object({ email: emailSchema, password: loginPasswordSchema })
  .strict();

export const totpCodeSchema = z.string().trim().regex(/^\d{6}$/);

export const authBody = (_schema: z.ZodType) => ({
  body: { type: "object", additionalProperties: true },
});
