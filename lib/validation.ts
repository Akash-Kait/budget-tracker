import { z } from 'zod';
import { ITEM_TYPES, STATUSES, ASSET_TYPES } from '@/lib/types';

export const profileSchema = z.object({
  reserveTarget: z.number().min(0),
  reserveCurrent: z.number().min(0),
  monthlyIncome: z.number().min(0),
  monthlyExpenses: z.number().min(0),
  monthlyInvestments: z.number().min(0),
});

export const wealthAssetSchema = z
  .object({
    name: z.string().min(1).max(200),
    type: z.enum(ASSET_TYPES),
    ticker: z.string().max(20).nullable().optional(),
    quantity: z.number().min(0).nullable().optional(),
    pricePerUnit: z.number().min(0).nullable().optional(),
    value: z.number().min(0).nullable().optional(),
    costBasis: z.number().min(0).nullable().optional(),
    purchaseDate: z.string().datetime().nullable().optional(),
  })
  .refine((d) => (d.quantity != null && d.pricePerUnit != null) || d.value != null, {
    message: 'Provide either quantity + price, or a manual value',
    path: ['value'],
  });

export const itemSchema = z
  .object({
    type: z.enum(ITEM_TYPES),
    title: z.string().min(1),
    amount: z.number().min(0),
    priority: z.number().int().min(1).max(5),
    dueDate: z.string().datetime().nullable().optional(),
    status: z.enum(STATUSES).nullable().optional(),
    notes: z.string().nullable().optional(),
    coolingPeriodDays: z.number().int().min(0).default(30),
  })
  .refine((d) => d.type === 'WISHLIST' || !!d.dueDate, {
    message: 'dueDate is required for non-wishlist items',
    path: ['dueDate'],
  });

export const fundingSchema = z.object({
  amount: z.number().positive(),
  note: z.string().optional(),
});

export const reorderSchema = z.object({
  ids: z.array(z.string()).min(1),
});

export const convertSchema = z.object({
  amount: z.number().min(0),
  dueDate: z.string().datetime(),
  priority: z.number().int().min(1).max(5),
});

export const simulateSchema = z.object({
  name: z.string().optional(),
  cost: z.number().positive(),
});
