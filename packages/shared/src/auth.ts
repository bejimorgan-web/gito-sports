import type { EntityId, EntityStatus } from "./naming.js";

export type OperatorRole = "admin" | "operator" | "viewer";

export interface OperatorUser {
  id: EntityId;
  name: string;
  email: string;
  role: OperatorRole;
  status: EntityStatus;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  id: EntityId;
  operatorUserId: EntityId;
  tokenId: string;
  expiresAt: string;
  createdAt: string;
}
