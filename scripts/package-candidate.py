"""Package the committed C11 source and reviewed materials without local secrets.

Run after pnpm check from a clean checkout:
  python3 scripts/package-candidate.py NEW_OUTPUT_DIRECTORY
This creates a new engineering-candidate handoff, never a production acceptance.
"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import html
import json
import shutil
import subprocess
import sys
import zipfile
import xml.etree.ElementTree as ET

repo = Path(__file__).resolve().parents[1]
def git(*args):
    return subprocess.check_output(['git', *args], cwd=repo).decode().strip()
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
if len(sys.argv) != 2:
    raise SystemExit('Provide a new output directory')
if git('status', '--porcelain'):
    raise SystemExit('Commit reviewed changes before packaging')
destination = Path(sys.argv[1]).resolve()
if destination.exists():
    raise SystemExit('Output directory already exists; use a new one')
assets = repo / 'docs/releases/C11'
metadata = json.loads((assets / 'materials.json').read_text())
decks = list(assets.glob('*.pptx'))
if len(decks) != 1 or len(list(assets.glob('*.docx'))) != 4:
    raise SystemExit('Expected one final deck and four manuals')
with zipfile.ZipFile(decks[0]) as deck:
    tree = ET.fromstring(deck.read('ppt/presentation.xml'))
    count = len(tree.findall('.//{http://schemas.openxmlformats.org/presentationml/2006/main}sldId'))
    if count != metadata['slides']:
        raise SystemExit('Deck/metadata slide count mismatch')
commit = git('rev-parse', 'HEAD')
name = f'OS-CRM-C11-{commit[:7]}'
stage = destination / name
source = stage / '01_安装源码/tb-crm'
source.mkdir(parents=True)
tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=repo).decode().split('\0')
for relative in filter(None, tracked):
    path = Path(relative)
    if path.is_absolute() or '..' in path.parts or any(p in path.parts for p in ['.local', '.artifacts', 'node_modules', '.git', 'reference']):
        raise SystemExit('Unexpected private path: ' + relative)
    if path.name == '.env' or path.name.endswith(('.env', '.crmbackup', '.pem', '.key')):
        raise SystemExit('Unexpected environment/key/backup: ' + relative)
    if (repo / path).is_symlink():
        raise SystemExit('Unexpected symlink: ' + relative)
    target = source / path
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(repo / path, target)
prebuilt = {}
for folder in ['apps/api/dist', 'apps/web/dist', 'packages/shared/dist']:
    if not (repo / folder).is_dir():
        raise SystemExit('Build first: missing ' + folder)
    shutil.copytree(repo / folder, source / folder, ignore=shutil.ignore_patterns('*.map', '*.tsbuildinfo'))
    for p in (source / folder).rglob('*'):
        if p.is_file():
            prebuilt[p.relative_to(source).as_posix()] = digest(p)
shell = '#!/bin/sh\nset -eu\ncd "$(dirname "$0")"\nexport SEED_ADMIN_PASSWORD=12345\nexec sh deploy/start.sh\n'
for filename in ['本地部署.sh', '本地部署.command']:
    target = source / filename
    target.write_text(shell)
    target.chmod(0o755)
(source / '本地部署.ps1').write_text("$env:SEED_ADMIN_PASSWORD = '12345'\n& (Join-Path $PSScriptRoot 'deploy/start.ps1')\n")
for folder, patterns in [('02_Demo介绍', ['*.pptx']), ('03_演示与操作手册', ['*.docx', '*.html', '伴圆*.md'])]:
    target = stage / folder
    target.mkdir()
    for pattern in patterns:
        for p in sorted(assets.glob(pattern)):
            shutil.copy2(p, target / p.name)
screens = stage / '04_功能截图'
shutil.copytree(assets / 'overview-screenshots', screens / '01_原九张总体图')
shutil.copytree(repo / 'docs/screenshots', screens / '02_专题图')
screen_count = sum(1 for p in screens.rglob('*') if p.suffix.lower() in ['.jpg', '.png'])
if screen_count != metadata['screenshots']:
    raise SystemExit('Screenshot/metadata count mismatch')
(screens / '先读截图说明.txt').write_text('原九张为早期总体演示界面；新增专题图对应C2—C11。均为演示/合成资料，不是真实客户签收或银行交易。旧截图的财务、AI及审批限制以本包当前手册为准。\n')
captions = {
    'c2-account-security': '账号与安全：密码修改、有效会话及退出设备。',
    'c3-contract-change': '合同变更：核对固定前后值、依据和审批字段；画面为预检。',
    'c3-handover': '销售交接：先预检整个关联销售业务范围，再确认交接。',
    'c3-import': '客户导入：实际合成导入结果，明确列出重复跳过与新增。',
    'c4-delivery-history': '项目验收：拒收、整改、重新交付及另一人确认的历史。',
    'c41-handover-people': '交付交接：当前合格接收人与原因字段，不改历史执行者。',
    'c5-ledger-history': '本地核销：有效及撤销记录、前后余额；不等于银行退款。',
    'c5-ui-registration': '合成收款登记：页面提交小额记录，保持待另一管理员复核。',
    'c51-receipt-correction': '同凭据更正：保留旧金额，新登记重新独立复核。',
    'c6-approval-transfer': '审批转审：原节点、新接收人及交接原因全部保留。',
    'c7-delegated-action': 'AI委托：原委托人核对建议；批准不自动执行，不展示凭证。',
    'c8-service-ticket': '内部售后：当前解决方案、独立关闭入口与处理历史。',
    'c10-private-evidence': '私有附件：有效原件与撤回历史、文件摘要和按业务范围下载。',
    'c11-countersign-designer': '会签设计：明确选择同组人员，可混合后续单人步骤。',
    'c11-countersign-review': '会签执行：同一步保留独立的已同意与待处理意见。',
}
gallery = '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>24张功能截图</title><style>body{max-width:1300px;margin:40px auto;padding:20px;font:18px/1.8 system-ui}img{width:100%;height:auto;border:1px solid #ddd}section{margin:50px 0}</style><body><h1>伴圆CRM · 24张功能截图</h1><p>实际演示/合成界面；旧总体图须结合当前专题说明解读。截图不代表真实交易、客户签收或第三方联调。</p>'
for p in sorted(screens.rglob('*')):
    if p.suffix.lower() in ['.jpg', '.png']:
        caption = captions.get(p.stem, p.stem+'（早期总体演示界面）')
        gallery += '<section><h2>'+html.escape(caption)+'</h2><img alt="'+html.escape(caption)+'" src="'+html.escape(p.relative_to(screens).as_posix())+'"></section>'
(screens / '功能截图讲解.html').write_text(gallery+'</body></html>')
records = stage / '05_版本与验收'
records.mkdir()
for original, target in [(assets/'VALIDATION.md', '验收记录.md'), (repo/'CHANGELOG.md', '版本更新记录.md'), (repo/'docs/COMMERCIAL_ACCEPTANCE.md', '商用验收清单.md')]:
    shutil.copy2(original, records / target)
shutil.copy2(repo / 'LICENSE', stage / 'LICENSE')
(stage / '00_演示账号.txt').write_text('隔离演示企业：TINGMENG\nadmin 管理员\nmanager 销售主管\nsales 销售\nboss 老板\n统一公开演示密码：12345\n空企业正式安装另设独立强密码，不创建这四个演示用户。已有卷不因修改种子变量自动改密码。\n')
intro = f'''伴圆CRM / OS-CRM · C11工程候选
源码提交：{commit}
先阅读03_演示与操作手册中的本地部署手册。首次安装需要联网，须自行准备Docker Engine/Desktop与Compose v2，或Node24/pnpm11/MySQL8.4。
macOS：双击01_安装源码/tb-crm/本地部署.command。Linux：在源码目录运行sh 本地部署.sh。Windows：PowerShell运行本地部署.ps1。
演示就绪后打开http://localhost:3000。四账号密码见00_演示账号.txt。
正式企业使用deploy/start-production入口，生成独立随机密钥与强密码，不灌演示业务。
包含全部提交源码、预构建文件、24页可编辑PPT、四套手册、24张截图、迁移/种子/部署脚本与验收记录。
AI摘要是规则生成，未接大模型。独立委托限定客户查询及人工批准的内部行动，不提供代理审批/财务写入。
本地台账不核验银行到账，不执行税务、会计或退款。真实钉钉飞书企业尚未联调。
工程候选尚未生产验收；不是离线安装包。包内SHA256SUMS.txt核对逐文件，包外.sha256核对整个ZIP。
'''
(stage / '00_先读我.txt').write_text(intro)
links = [(p.stem, p.relative_to(stage).as_posix()) for p in sorted((stage/'03_演示与操作手册').glob('*.html'))]
links += [('可编辑介绍PPT', '02_Demo介绍/'+decks[0].name), ('24张功能截图及讲解', '04_功能截图/功能截图讲解.html'), ('演示账号', '00_演示账号.txt'), ('验收记录', '05_版本与验收/验收记录.md')]
(stage / '00_先读我.html').write_text('<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>C11交付</title><style>body{max-width:1000px;margin:40px auto;padding:24px;font:18px/1.8 system-ui}pre{white-space:pre-wrap}a{color:#1658ae}</style><body><h1>伴圆CRM · C11工程候选</h1><ul>'+''.join('<li><a href="'+html.escape(u)+'">'+html.escape(t)+'</a></li>' for t,u in links)+'</ul><pre>'+html.escape(intro)+'</pre></body></html>')
manifest = {'product':'伴圆CRM / OS-CRM','candidate':'C11','applicationPackageVersion':json.loads((repo/'package.json').read_text())['version'],'sourceCommit':commit,'branch':git('branch','--show-current'),'createdAt':datetime.now(timezone.utc).isoformat(),'license':'MIT','productionAccepted':False,'firstInstallRequiresNetwork':True,'originalMachineSecretsIncluded':False,'realCustomerDatabaseIncluded':False,'publicDemoPassword':'12345',**metadata,'migrations':sorted(p.parent.name for p in (repo/'packages/database/prisma/migrations').glob('*/migration.sql')),'prebuiltFiles':prebuilt}
(stage/'MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
files = sorted(p for p in stage.rglob('*') if p.is_file())
(stage/'SHA256SUMS.txt').write_text(''.join(digest(p)+'  '+p.relative_to(stage).as_posix()+'\n' for p in files))
archive = destination / (name+'-complete-handoff.zip')
with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in sorted(stage.rglob('*')):
        if p.is_file():z.write(p,p.relative_to(destination).as_posix())
(destination/(archive.name+'.sha256')).write_text(digest(archive)+'  '+archive.name+'\n')
print(json.dumps({'archive':str(archive),'sourceCommit':commit,'sha256':digest(archive),'bytes':archive.stat().st_size,'files':len(files)+1},ensure_ascii=False))
