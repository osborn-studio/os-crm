import { PrismaClient, Prisma } from '@prisma/client';
const p = new PrismaClient();
const days = (n: number) => new Date(Date.now() + n * 86400000);
async function main() {
  if (process.env.DEMO_MODE !== 'true' || !/(demo|test)/.test(new URL(process.env.DATABASE_URL!).pathname))
    throw new Error('仅允许DEMO_MODE=true的demo/test数据库');
  const tenant = await p.tenant.findUniqueOrThrow({ where: { code: 'TINGMENG' } }),
    t = tenant.id;
  const sales = await p.user.findFirstOrThrow({ where: { tenantId: t, username: 'sales' } }),
    other = await p.user.findFirstOrThrow({ where: { tenantId: t, username: 'sales03' } }),
    peer = await p.user.findFirstOrThrow({ where: { tenantId: t, username: 'sales01' } }),
    manager = await p.user.findFirstOrThrow({ where: { tenantId: t, username: 'manager' } }),
    boss = await p.user.findFirstOrThrow({ where: { tenantId: t, username: 'boss' } });
  const owners = [sales, peer, other],
    names = ['星河', '青禾', '远帆', '云岭', '澄海', '松原', '景辰', '北辰', '锦川', '溪桥'];
  for (let i = 0; i < 40; i++) {
    const owner = owners[i % 3],
      pub = i % 5 === 0;
    const c = await p.customer.upsert({
      where: { tenantId_code: { tenantId: t, code: `DEMO-KH-${i + 1}` } },
      update: {},
      create: {
        tenantId: t,
        code: `DEMO-KH-${i + 1}`,
        name: `${names[i % 10]}${Math.floor(i / 10) + 1}号演示企业`,
        industry: ['制造/工业', 'IT/互联网', '餐饮', '医院/医疗'][i % 4],
        level: i % 3 === 0 ? '重点客户' : '普通客户',
        region: ['上海', '杭州', '苏州', '南京'][i % 4],
        poolType: pub ? 'public' : 'private',
        ownerId: pub ? null : owner.id,
        ownerDeptId: pub ? null : owner.deptId,
        lastFollowAt: days(-(i % 20)),
        createdBy: owner.id,
        remark: '合成演示数据',
      },
    });
    if (!pub)
      await p.privateHolding.upsert({
        where: { tenantId_userId_customerId: { tenantId: t, userId: owner.id, customerId: c.id } },
        update: {},
        create: { tenantId: t, userId: owner.id, customerId: c.id, claimedAt: days(-3), protectUntil: days(27) },
      });
    if (!(await p.contact.count({ where: { tenantId: t, customerId: c.id } })))
      for (let n = 0; n < (i < 20 ? 2 : 1); n++)
        await p.contact.create({
          data: {
            tenantId: t,
            customerId: c.id,
            name: `演示联系人${i + 1}-${n + 1}`,
            title: n ? '技术负责人' : '采购负责人',
            isPrimary: n === 0,
            createdBy: owner.id,
          },
        });
    if (!pub && !(await p.followUp.count({ where: { tenantId: t, customerId: c.id } })))
      await p.followUp.create({
        data: {
          tenantId: t,
          customerId: c.id,
          targetType: 'customer',
          targetId: c.id,
          method: 'visit',
          content: '已完成初次需求访谈，确认系统建设范围。',
          nextAction: '提交业务方案',
          createdBy: owner.id,
        },
      });
    if (!pub && i < 30) {
      const stages = ['intention', 'contact', 'requirement', 'proposal', 'negotiation', 'signing'];
      const stage = stages[Math.floor(i / 3) % 6],
        amount = new Prisma.Decimal((i + 1) * 12000);
      const o = await p.opportunity.upsert({
        where: { tenantId_code: { tenantId: t, code: `DEMO-SJ-${i + 1}` } },
        update: {},
        create: {
          tenantId: t,
          code: `DEMO-SJ-${i + 1}`,
          name: `${c.name}数字化建设`,
          customerId: c.id,
          ownerId: owner.id,
          stage,
          amount,
          weightedAmount: amount.mul('0.4'),
          expectedCloseDate: days(10 + i),
          demandSummary: '客户管理、销售过程与交付协同',
          createdBy: owner.id,
        },
      });
      if (i < 15) {
        const status = Math.floor(i / 3) % 3 === 0 ? 'draft' : Math.floor(i / 3) % 3 === 1 ? 'signed' : 'executing';
        const ct = await p.contract.upsert({
          where: { tenantId_contractNo: { tenantId: t, contractNo: `DEMO-HT-${i + 1}` } },
          update: {},
          create: {
            tenantId: t,
            contractNo: `DEMO-HT-${i + 1}`,
            name: `${c.name}服务合同`,
            customerId: c.id,
            opportunityId: o.id,
            contractType: 'implementation',
            amount,
            amountExclTax: amount.div('1.06').toDecimalPlaces(2),
            taxRate: 6,
            taxAmount: amount.sub(amount.div('1.06').toDecimalPlaces(2)),
            totalOutstanding: amount,
            ownerId: owner.id,
            status,
            signDate: status === 'draft' ? null : days(-30),
            createdBy: owner.id,
          },
        });
        if (status !== 'draft') {
          await p.order.upsert({
            where: { tenantId_orderNo: { tenantId: t, orderNo: `DEMO-DD-${i + 1}` } },
            update: {},
            create: {
              tenantId: t,
              orderNo: `DEMO-DD-${i + 1}`,
              contractId: ct.id,
              customerId: c.id,
              ownerId: owner.id,
              totalAmount: amount,
              totalAmountInclTax: amount,
              orderDate: days(-20),
              status: i % 2 ? 'confirmed' : 'delivered',
              createdBy: owner.id,
            },
          });
          for (let n = 0; n < 3; n++) {
            const part = n === 2 ? amount.sub(amount.mul('0.3').mul(2)) : amount.mul('0.3');
            const received = n === 0 ? part : n === 1 ? part.div(2) : new Prisma.Decimal(0),
              outstanding = part.sub(received);
            await p.paymentPlan.upsert({
              where: { tenantId_planNo: { tenantId: t, planNo: `DEMO-HK-${i + 1}-${n}` } },
              update: {},
              create: {
                tenantId: t,
                contractId: ct.id,
                planNo: `DEMO-HK-${i + 1}-${n}`,
                amount: part,
                receivedAmount: received,
                outstandingAmount: outstanding,
                dueDate: days(n === 2 ? 20 : -10),
                status: n === 0 ? 'completed' : n === 1 ? 'partial' : 'pending',
                triggerCondition: '合成演示计划',
              },
            });
          }
          const project = await p.project.upsert({
            where: { tenantId_projectNo: { tenantId: t, projectNo: `DEMO-XM-${i + 1}` } },
            update: {},
            create: {
              tenantId: t,
              projectNo: `DEMO-XM-${i + 1}`,
              name: `${c.name}实施项目`,
              customerId: c.id,
              contractId: ct.id,
              pmId: owner.id,
              salesOwnerId: owner.id,
              status: 'active',
              progress: 25,
              stage: 'blueprint',
              plannedStartDate: days(-15),
              plannedEndDate: days(60),
              createdBy: owner.id,
            },
          });
          if (!(await p.projectMilestone.count({ where: { tenantId: t, projectId: project.id } })))
            for (const [n, name] of ['项目启动', '方案确认', '系统上线', '验收交付'].entries())
              await p.projectMilestone.create({
                data: {
                  tenantId: t,
                  projectId: project.id,
                  name,
                  stage: 'implementation',
                  sortOrder: n + 1,
                  weight: 25,
                  plannedDate: days(n * 15),
                  status: n === 0 ? 'completed' : 'pending',
                },
              });
          if (!(await p.projectTask.count({ where: { tenantId: t, projectId: project.id } })))
            await p.projectTask.create({
              data: {
                tenantId: t,
                projectId: project.id,
                title: '确认业务蓝图',
                assigneeId: owner.id,
                dueDate: days(3),
                createdBy: owner.id,
              },
            });
        }
      }
    }
  }
  for (let i = 0; i < 20; i++)
    await p.lead.upsert({
      where: { tenantId_code: { tenantId: t, code: `DEMO-XS-${i + 1}` } },
      update: {},
      create: {
        tenantId: t,
        code: `DEMO-XS-${i + 1}`,
        companyName: `潜在客户${i + 1}号演示企业`,
        source: ['website', 'referral', 'exhibition'][i % 3],
        contactName: `线索联系人${i + 1}`,
        status: 'assigned',
        score: 40 + i * 2,
        assigneeId: owners[i % 3].id,
        createdBy: owners[i % 3].id,
        demand: '销售协同与客户经营',
      },
    });
  for (const [bizType, name] of [
    ['contract', '合同审批'],
    ['order', '订单审批'],
    ['project_initiation', '立项审批'],
    ['expense', '费用申请'],
    ['general', '通用事项申请'],
  ])
    if (!(await p.approvalFlow.count({ where: { tenantId: t, name } }))) {
      const flow = await p.approvalFlow.create({
        data: {
          tenantId: t,
          name,
          bizType,
          isActive: true,
          conditionExpr: 'always',
          version: 1,
          definition: {
            fields: bizType === 'general' ? [{ key: 'reason', label: '申请事由', type: 'text', required: true }] : [],
          },
        },
      });
      await p.approvalFlowNode.createMany({
        data: [
          {
            tenantId: t,
            flowId: flow.id,
            nodeOrder: 1,
            nodeName: '销售主管审批',
            approverType: 'user',
            approverValue: String(manager.id),
            conditionExpr: 'always',
          },
          {
            tenantId: t,
            flowId: flow.id,
            nodeOrder: 2,
            nodeName: '老板审批',
            approverType: 'user',
            approverValue: String(boss.id),
            conditionExpr: 'amount >= 100000',
          },
        ],
      });
    }
  const demoContracts = await p.contract.findMany({
    where: { tenantId: t, contractNo: { startsWith: 'DEMO-HT-' }, status: { in: ['signed', 'executing'] } },
  });
  for (const ct of demoContracts) {
    const received = ct.amount.mul('0.45'),
      outstanding = ct.amount.sub(received);
    await p.contract.update({
      where: { id: ct.id },
      data: { totalReceived: received, totalOutstanding: outstanding, totalInvoiced: ct.amount },
    });
    await p.invoice.upsert({
      where: { tenantId_invoiceNo: { tenantId: t, invoiceNo: `DEMO-FP-${ct.id}` } },
      update: {},
      create: {
        tenantId: t,
        invoiceNo: `DEMO-FP-${ct.id}`,
        contractId: ct.id,
        customerId: ct.customerId,
        amount: ct.amount,
        amountExclTax: ct.amountExclTax!,
        taxRate: 6,
        taxAmount: ct.taxAmount!,
        invoiceTitle: '合成演示单位',
        taxNo: 'DEMO-NOT-A-TAX-ID',
        status: 'invoiced',
        remark: '合成演示记录，不是真实发票',
      },
    });
    await p.receipt.upsert({
      where: { tenantId_receiptNo: { tenantId: t, receiptNo: `DEMO-SK-${ct.id}` } },
      update: {},
      create: {
        tenantId: t,
        receiptNo: `DEMO-SK-${ct.id}`,
        customerId: ct.customerId,
        contractId: ct.id,
        amount: received,
        allocatedAmount: received,
        unallocatedAmount: 0,
        receiptDate: days(-5),
        status: 'confirmed',
        remark: '合成演示记录，不是真实收款',
      },
    });
  }
  const demoReceipts = await p.receipt.findMany({ where: { tenantId: t, receiptNo: { startsWith: 'DEMO-SK-' } } });
  for (const receipt of demoReceipts) {
    const plans = await p.paymentPlan.findMany({
      where: { tenantId: t, contractId: receipt.contractId!, receivedAmount: { gt: 0 } },
    });
    for (const plan of plans)
      if (
        !receipt.ledgerManaged &&
        !(await p.receiptAllocation.findFirst({
          where: { tenantId: t, receiptId: receipt.id, paymentPlanId: plan.id },
        }))
      )
        await p.receiptAllocation.create({
          data: {
            tenantId: t,
            receiptId: receipt.id,
            paymentPlanId: plan.id,
            amount: plan.receivedAmount,
            allocatedBy: 1,
            remark: '合成演示核销关联',
          },
        });
  }
  for (const owner of owners) {
    const customer = await p.customer.findFirstOrThrow({ where: { tenantId: t, ownerId: owner.id } });
    if (!(await p.actionPlan.count({ where: { tenantId: t, assigneeId: owner.id } })))
      for (let i = 0; i < 3; i++)
        await p.actionPlan.create({
          data: {
            tenantId: t,
            targetType: 'customer',
            targetId: customer.id,
            title: ['确认需求清单', '提交方案报价', '安排客户回访'][i],
            assigneeId: owner.id,
            dueDate: days(i + 1),
            createdBy: owner.id,
          },
        });
  }
  const customers = await p.customer.findMany({ where: { tenantId: t } });
  for (const c of customers) {
    const signed = await p.contract.findMany({
      where: { tenantId: t, customerId: c.id, status: { in: ['signed', 'executing', 'completed'] } },
    });
    await p.customer.update({
      where: { id: c.id },
      data: {
        contractCount: signed.length,
        contractAmount: signed.reduce((s, c) => s.add(c.amount), new Prisma.Decimal(0)),
        isTrading: signed.length > 0,
      },
    });
  }
  console.log('演示数据初始化完成：四角色、客户/联系人/线索/商机/合同/订单/项目/计划与审批流。');
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());
