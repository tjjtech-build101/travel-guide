import type { ToolInput } from '@build101/shared';
import { addBlockImpl } from './add_block';
import type { ToolCtx } from './types';

/** add_idea = add_block con day_id null (banco de ideas del tramo). */
export const add_idea = (input: ToolInput<'add_idea'>, ctx: ToolCtx) =>
  addBlockImpl({ ...input, day_id: null, status: input.status ?? 'idea' }, ctx);
