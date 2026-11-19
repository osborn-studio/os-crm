"""Edit the retained Tianyu Word design; keep its page geometry, styles and headers."""
from pathlib import Path
import argparse
from docx import Document
from docx.shared import Inches, Pt

ROOT = Path(__file__).resolve().parent
NAMES = ['天雨阀门CRM_业务应用全景.docx', '天雨阀门CRM_演示账号与操作手册.docx']
REPLACEMENTS = {
 '经营工作台、销售预测、漏斗和回款分析支持时间与人员范围。默认查看本人，有权限的管理者可选公司、部门或人员；汇总数字可下钻到具体机会与业务单据，便于会议中直接分配下一步行动。':
 '工作台直接显示合同总金额、合同已收款、合同待收款、已开票金额、已开票已收款、已开票待收款和在建项目金额。销售看本人，主管看部门及下属，老板和管理员看全公司；点击金额可查明细。',
 '图 6  销售预测结合阶段、金额、预计成交时间和人员范围。':
 '图 6  合同与回款分开核对，渠道往来和软件返佣单列，金额可以下钻。',
 '先核对页眉公司为天雨阀门。报表默认本人；老板查看经营全景时选择“全公司（当前帐套）”。总体分析可选 2025-01-01 至 2027-12-31；商机看板选本月及“华东销售1”，方便逐项查看。':
 '先核对页眉公司为天雨阀门。老板和管理员默认全公司，主管默认部门及下属，销售默认本人。总体分析可选2025-01-01至2027-12-31；选华东销售主管时可同时查看其下属销售，再选本人作对照。',
 '6万客户、2.4万联系人、9000商机、3万跟进、1200合同、800订单、3600审批、3200回款计划、2200开票记录、602收款登记、240项目、960里程碑、960任务、30售后工单、42日程。初始清单见 manifest.json；现场操作会追加记录。':
 '6万客户、2.4万联系人、9000商机、3万跟进、1200合同、800订单；3710审批、3200回款分期、2200发票、602收款；240项目、960里程碑、960任务、30工单；7802行动、7700日程。初始清单见manifest，补充验证见enrichment-verification。',
 '老板进入“销售预测与回款分析”。先选择2025-01-01至2027-12-31及全公司，再按现场主题切换本月、本年、部门或个人。销售账号默认本人，主管只能选权限范围内人员，老板可查看全公司。':
 '老板从“销售预测与回款分析”进入合同与回款经营统计。先选2025-01-01至2027-12-31，查看五项主金额，再按部门、人员或公司切换。主管包含下属团队，销售查看本人；每个表格可选排序依据及正序、倒序。',
 '从开放商机金额、加权金额、赢单和阶段分布说明当前管道。预计成交时间决定预测归期；点击阶段或明细查看客户、金额、负责人和下一步。总体统计与业务明细使用相同人员范围。':
 '先看合同、未回款、有效开票、开票未回和在建金额；它们按所选签约日期的合同批次汇总当前累计。逐笔回款安排列出预计日期、待回金额、规则权重与依据。商机报价与阶段参考另页查看，原整包报价和我方业务金额分别保留。',
 '用老板打开销售预测与回款分析，选择时间和全公司。区分实际开票日期、实际到账日期、计划到期日期三个统计角度；点击明细定位合同，形成负责人及下一步回款安排。':
 '用老板打开合同与回款经营统计，查看同一批合同的累计开票与回款；按到账日、计划到期日核对时进入回款台账页。点击合同查看明细和行动安排。有效发票按关联分期核销计算未回金额，与合同未回不重复相加。',
 '进入我的日程查看本人后续安排。查看报价反馈、技术资料确认、交付协调和回款核对等后续安排，结合行动计划明确负责人及推进时间。':
 '进入“日程与业务推进”，查看报价反馈、技术确认、供货协调和回款核对。主管按团队查看推进安排；点开日程进入对应行动。完成行动后，其关联本地推进日程同步完成。拟定工作安排和实际客户沟通分别留痕。',
}

def replace_text(document):
    paragraphs = list(document.paragraphs)
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                paragraphs.extend(cell.paragraphs)
    plain={'合同未回款':'合同待收款','合同未回':'合同待收款','开票未回款':'已开票待收款','开票未回':'已开票待收款','已签合同':'已签合同','到期日期':'预计收款日','到期日':'预计收款日','按到账日、计划到期日':'按收款日期、预计收款日期','销售预测与回款分析':'合同与收款统计','建设中项目金额':'在建项目金额','五项主金额':'合同和开票的已收、待收金额'}
    for paragraph in paragraphs:
        text = REPLACEMENTS.get(paragraph.text, paragraph.text)
        text = text.replace('3,600 次审批', '3,710 次审批')
        for old,new in sorted(plain.items(),key=lambda item:-len(item[0])):text=text.replace(old,new)
        if text != paragraph.text:
            size = paragraph.runs[0].font.size if paragraph.runs else None
            paragraph.clear()
            run = paragraph.add_run(text)
            if size:
                run.font.size = size

def picture(document, name, caption, width=6.95):
    document.add_picture(str(ROOT/'screenshots'/name), width=Inches(width))
    document.paragraphs[-1].paragraph_format.line_spacing = 1.0
    p = document.add_paragraph(caption, 'Caption')
    for r in p.runs:
        r.font.size = Pt(8)

def page(document, title):
    document.add_page_break()
    document.add_paragraph(title, 'Heading 1')

def enhance_existing(reference_dir, output_dir):
    output_dir.mkdir(parents=True, exist_ok=True)
    for index, name in enumerate(NAMES):
        document = Document(reference_dir/name)
        replace_text(document)
        if index == 0:
            for shape, name_image in zip(document.inline_shapes, ['01-dashboard.jpg','03-customer.jpg','02-pipeline.jpg','04-contract.jpg','05-project.jpg','07-forecast.jpg','09-ai-actions.jpg']):
                rid = shape._inline.graphic.graphicData.pic.blipFill.blip.embed
                document.part.related_parts[rid]._blob = (ROOT/'screenshots'/name_image).read_bytes()
            analysis = next(p for p in document.paragraphs if p.text == '05  经营分析与 AI 原生协同')
            analysis.text = '05  合同、开票与收款'
            ai = next(p for p in document.paragraphs if p.text == '让业务能力成为智能体可调用的服务')
            ai.text = '06  AI原生协同：业务可调用，执行有记录'
            ai.style = 'Heading 1'
            ai.paragraph_format.page_break_before = True
            page(document, '07  团队经营：看得全，也推得动')
            document.add_paragraph('选择华东销售主管时，下属销售和部门后代的客户、商机及业务单据一并纳入当前权限范围。老板和管理员可查看公司全貌；人员筛选、业务归属和关联记录遵守同一数据范围。')
            picture(document, '10-team-scope.jpg', '图 7  指定主管“含下属团队”，经营工作台展示其团队业务。')
            document.add_paragraph('6640个开放商机各有后续行动，800份已签合同各有成交路径与收款节点核对。看板显示客户、负责人、下一步和跟进入口，日程承接执行安排；正反序排序帮助优先处理近期工作。')
            document.add_paragraph('通用审批样板覆盖22种业务场景，包含待审、通过、驳回、撤回和修订重提。业务合同、订单及立项由相应受控流程推进，审批意见与历史保持可追溯。')
        else:
            # Keep the full account table on the opening page; give preparation its own breathing room.
            paragraphs = list(document.paragraphs)
            preparation = next(p for p in paragraphs if p.text == '演示前准备')
            preparation_text = paragraphs[paragraphs.index(preparation)+1]
            host = next(p for p in paragraphs if p.text.startswith('01  主持人总流程'))
            host._p.addnext(preparation_text._p)
            host._p.addnext(preparation._p)
            account_note = next(p for p in document.paragraphs if p.text.startswith('财务复核与管理员使用两个不同账号'))
            preparation_text._p.addnext(account_note._p)
            page(document, '08  团队权限、排序与商机行动')
            for title, text in [
                ('A. 老板查看主管团队', '用ty_boss登录，进入工作台，选择华东销售主管（含下属团队）。查看其销售数据；切到本人作对照。再用ty_mgr_east登录，核对默认部门及下属范围。'),
                ('B. 看板直达客户与跟进', '进入商机看板，调整日期和排序。每张卡片显示客户名称、负责人、跟进次数和下一步；点击客户打开档案，点击“查看跟进”进入该商机记录。新增实际跟进时可勾选生成后续行动。'),
                ('C. 近期工作排在前面', '进入行动计划，排序依据选计划完成日；正序从早到晚，倒序从晚到早。可改为更新日期、优先级或名称。换方向回到第一页，分页列表对全部匹配记录排序；导出沿用当前页顺序。'),
            ]:
                document.add_paragraph(title, 'Heading 2')
                document.add_paragraph(text)
            picture(document, '11-sorting.jpg', '日期、金额及名称等支持明确的正序和倒序按钮。', width=6.5)
            page(document, '09  通用审批、回款安排与手机操作')
            for title, text in [
                ('A. 查看22套审批样板', '用admin进入审批设计器，查看阀门询价、技术、图纸、合同、发运、验收及回款相关流程。审批中心包含110个补充表单实例：待审44、通过22、驳回22、撤回22，待审中包含修订重提。选择独立练习实例操作，保留历史。'),
                ('B. 核对回款时间与金额', '经营统计先选签约时间和人员，查看合同总金额、已收款、待收款，再看开票已收与待收。点击金额卡定位合同，逐笔收款安排写明预计日期、金额和判断依据。已开票待收属于合同待收的一部分，不重复相加。'),
                ('C. 确认渠道往来口径', '渠道作为甲方付款时，实施、开发及外包属于业务；软件返佣单列。管理员在合同或商机详情确认分类与依据。整包报价可拆我方金额和厂商产品部分，原价和报价版本保留。'),
                ('D. 手机H5', '手机和本地服务器连接同一局域网，在浏览器输入公司管理页显示的局域网地址，选天雨阀门并用相同账号登录。表格内部横向滚动，金额保持正常字号。外出可使用已配置的VPN或HTTPS入口，管理员在外网配置页维护。'),
                ('E. AI调用与执行边界', '新建智能体委托时可明确勾选合同回款经营报表；读取沿用本人实时权限、调用限额和审计。行动先预演，由人员核对批准，再执行并保留回执。日程中的本地推进安排不会自动当成外发邀请。'),
            ]:
                document.add_paragraph(title, 'Heading 2')
                document.add_paragraph(text)
        document.core_properties.comments = 'Tianyu public delivery v2; synthetic data only'
        document.save(output_dir/name)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--reference-dir', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, default=ROOT)
    args = parser.parse_args()
    enhance_existing(args.reference_dir, args.output_dir)
