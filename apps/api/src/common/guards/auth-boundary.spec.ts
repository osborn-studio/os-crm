import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../database/prisma.service';

/** In-process HTTP tests: real guards, JWT verification, validation, routing and serialization. DB is a fixture. */
describe('HTTP authorization and capability boundary', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let token: string;
  const user = { id: 7, tenantId: 1, username: 'fixture', name: 'Fixture', deptId: 2,
    roles: [{ role: { code: 'sales', dataScope: 'self', permissions: ['customer:read'] } }] };
  const findUser = jest.fn();
  const findCustomers = jest.fn();
  const findCustomer = jest.fn();
  const writeAudit = jest.fn();
  const tenantDb = { customer: { findMany: findCustomers, count: jest.fn().mockResolvedValue(1), findFirst: findCustomer } };
  const prisma = { onModuleInit: jest.fn(), onModuleDestroy: jest.fn(),
    system: { user: { findFirst: findUser }, authSession: { findFirst: jest.fn().mockResolvedValue({ id: 'fixture-session' }) }, auditLog: { create: writeAudit } },
    forTenant: jest.fn().mockReturnValue(tenantDb) };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-only-secret-with-more-than-32-characters';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    jwt = app.get(JwtService);
    token = jwt.sign({ sub: 7, tid: 1, sid: 'fixture-session' });
  });
  beforeEach(() => {
    jest.clearAllMocks();
    findUser.mockResolvedValue(user);
    prisma.system.authSession.findFirst.mockResolvedValue({ id: 'fixture-session' });
    findCustomers.mockResolvedValue([{ id: 12, code: 'KH001', name: 'Fixture customer', industry: '制造', poolType: 'private',
      phone: 'should-never-return', aiProfile: 'internal-only' }]);
    writeAudit.mockResolvedValue({ id: 1 });
  });
  afterAll(async () => { await app.close(); });

  it('allows public health but blocks unauthenticated customer access', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200).expect(({ body }) => expect(body.code).toBe(0));
    await request(app.getHttpServer()).get('/api/v1/customers').expect(401);
    expect(prisma.forTenant).not.toHaveBeenCalled();
  });
  it('rejects refresh tokens used as access tokens', async () => {
    const refresh = jwt.sign({ sub: 7, tid: 1, type: 'refresh' });
    await request(app.getHttpServer()).get('/api/v1/capabilities').auth(refresh, { type: 'bearer' }).expect(401);
  });
  it('rejects old sessionless JWTs after the session migration', async () => {
    await request(app.getHttpServer()).get('/api/v1/capabilities').auth(jwt.sign({ sub: 7, tid: 1 }), { type: 'bearer' }).expect(401);
  });
  it('rejects revoked sessions even when the signed access token is unexpired', async () => {
    prisma.system.authSession.findFirst.mockResolvedValueOnce(null);
    await request(app.getHttpServer()).get('/api/v1/capabilities').auth(token, { type: 'bearer' }).expect(401);
    expect(findCustomers).not.toHaveBeenCalled();
  });
  it('rejects disabled or mismatching tenant identities', async () => {
    findUser.mockResolvedValue(null);
    await request(app.getHttpServer()).get('/api/v1/capabilities').auth(token, { type: 'bearer' }).expect(401);
    expect(findUser.mock.calls[0][0].where).toMatchObject({ id: 7, tenantId: 1, status: 'active' });
  });
  it('hides tools and denies invocation after permission revocation', async () => {
    findUser.mockResolvedValue({ ...user, roles: [{ role: { code: 'sales', dataScope: 'self', permissions: [] } }] });
    await request(app.getHttpServer()).get('/api/v1/capabilities').auth(token, { type: 'bearer' }).expect(200)
      .expect(({ body }) => expect(body.data).toEqual([]));
    await request(app.getHttpServer()).post('/api/v1/capabilities/customer.search/invoke')
      .auth(token, { type: 'bearer' }).send({}).expect(403);
    expect(findCustomers).not.toHaveBeenCalled();
  });
  it('uses tenant and ownership scopes and returns a bounded projection with execution evidence', async () => {
    await request(app.getHttpServer()).post('/api/v1/capabilities/customer.search/invoke')
      .auth(token, { type: 'bearer' }).send({ keyword: 'Fixture', pageSize: 10 }).expect(201)
      .expect(({ body }) => {
        expect(body.data.executionId).toMatch(/^[0-9a-f-]{36}$/);
        expect(body.data.result.items).toEqual([{ id: 12, code: 'KH001', name: 'Fixture customer', industry: '制造', poolType: 'private' }]);
      });
    expect(prisma.forTenant).toHaveBeenCalledWith(1);
    expect(findCustomers.mock.calls[0][0].where.AND).toEqual([{ OR: [{ poolType: 'public' }, { ownerId: 7 }] }]);
    expect(writeAudit.mock.calls[0][0].data).toMatchObject({ tenantId: 1, userId: 7, action: 'capability.succeeded' });
  });
  it.each([{ tenantId: 9 }, { pageSize: 101 }, { page: -1 }, { keyword: {} }])('rejects invalid or injected input %p', async (input) => {
    await request(app.getHttpServer()).post('/api/v1/capabilities/customer.search/invoke')
      .auth(token, { type: 'bearer' }).send(input).expect(400);
    expect(findCustomers).not.toHaveBeenCalled();
  });
  it('does not disclose a customer outside the visible scope', async () => {
    findCustomer.mockResolvedValue(null);
    await request(app.getHttpServer()).post('/api/v1/capabilities/customer.get/invoke')
      .auth(token, { type: 'bearer' }).send({ customerId: 99 }).expect(404);
    expect(writeAudit.mock.calls[0][0].data.action).toBe('capability.failed');
  });
  it('does not expose unimplemented write capabilities', async () => {
    await request(app.getHttpServer()).post('/api/v1/capabilities/contract.sign/invoke')
      .auth(token, { type: 'bearer' }).send({}).expect(404);
  });
});
