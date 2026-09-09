import type { OpportunityType } from '@salon/shared';
import type { ActionStatus, OpportunityActionResponseDto } from './action.dto';

export const ACTION_SELECT = {
  id: true,
  customerId: true,
  opportunityType: true,
  status: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  dismissedAt: true,
  customer: {
    select: {
      firstName: true,
      lastName: true,
    },
  },
} as const;

export type ActionRow = {
  id: string;
  customerId: string;
  opportunityType: OpportunityType;
  status: ActionStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  dismissedAt: Date | null;
  customer: { firstName: string; lastName: string };
};

export function toActionResponse(row: ActionRow): OpportunityActionResponseDto {
  return {
    id: row.id,
    customerId: row.customerId,
    firstName: row.customer.firstName,
    lastName: row.customer.lastName,
    opportunityType: row.opportunityType,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
  };
}
