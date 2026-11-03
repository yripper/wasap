import { z } from 'zod';

/// Lowercase slug so "Work" and "work" can't become two separate profiles.
export const category = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9_-]+$/, 'lowercase letters, digits, - and _ only');
