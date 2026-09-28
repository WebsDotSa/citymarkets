/**
 * Auth-related schemas: phone-OTP login, admin password login, password
 * change, and native push token registration (APNs/FCM).
 */

import { z } from "zod";
import { phoneSchema } from "./common";

export const loginSchema = z.object({
  phone: phoneSchema,
  name: z.string().max(100).optional(),
  email: z.string().email().optional(),
});

/**
 * OTP verification schema
 */
export const otpVerifySchema = z.object({
  phone: phoneSchema,
  code: z.string().length(4, "رمز التحقق يجب أن يكون 4 أرقام").regex(/^\d{4}$/),
});

/**
 * Admin login schema
 */
export const adminLoginSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1),
});

/**
 * Password change schema
 */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل"),
});

export const apnsRegisterSchema = z.object({
  platform: z.enum(["apns", "fcm"]),
  deviceToken: z
    .string()
    .min(8, "deviceToken too short")
    .max(512, "deviceToken too long")
    .regex(/^[A-Za-z0-9_-]+$/, "deviceToken must be hex/base64url"),
  environment: z.enum(["production", "sandbox"]).optional(),
  bundleId: z.string().min(1).max(128).optional(),
  locale: z
    .string()
    .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, "invalid locale")
    .max(35)
    .optional(),
});

export const apnsUnregisterSchema = z.object({
  platform: z.enum(["apns", "fcm"]),
  deviceToken: z.string().min(8).max(512),
});