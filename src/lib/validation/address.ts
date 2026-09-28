/**
 * Address validation schemas — used by /api/v1/addresses (customer
 * addresses) and /api/v1/orders/direct (delivery address inside an
 * order).
 */

import { z } from "zod";

export const createAddressSchema = z.object({
  label: z.string().min(1).max(50),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  addressText: z.string().min(1).max(500),
  description: z.string().max(200).optional(),
  placeImages: z.array(z.string().url()).max(5).optional(),
  isDefault: z.boolean().optional(),
});

export const deliveryAddressSchema = z.object({
  label: z.string().min(1).max(80),
  address_text: z.string().min(1).max(240),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  plus_code: z.string().max(40).optional().nullable(),
  city: z.string().max(80).optional().nullable(),
  district: z.string().max(80).optional().nullable(),
  description: z.string().max(240).optional().nullable(),
  place_images: z.array(z.string()).max(8).optional().default([]),
});