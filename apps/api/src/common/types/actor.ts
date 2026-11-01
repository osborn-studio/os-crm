export interface Actor {
  userId: number;
  tenantId: number;
  deptId: number | null;
  roles: string[];
  permissions: string[];
  dataScope: 'self' | 'team' | 'dept' | 'custom' | 'all';
  sessionId?: string;
}
