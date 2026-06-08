import { z } from 'zod';
import { ITEM_TYPES, STATUSES } from '@/lib/types';

export const profileSchema = z.object({
  protectedCapital: z.number().min(0),
  reserveTarget: z.number().min(0),
  reserveCurrent: z.number().min(0),
  monthlyIncome: z.number().min(0),
  monthlyExpenses: z.number().min(0),
  monthlyInvestments: z.number().min(0),
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

export const simulateSchema = z.object({
  name: z.string().optional(),
  cost: z.number().positive(),
});
