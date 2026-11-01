"""Historical v0.2 demo.2 packager; use package-candidate.py for C11 materials.

Create a UTF-8 local demo handoff from clean tracked source and approved delivery assets.

Usage: SEED_ADMIN_PASSWORD=... python3 scripts/package-release.py ASSETS_DIR OUTPUT_DIR
ASSETS_DIR contains output/*.docx, output/*.html, output/*.pptx, screenshots/*.jpg
and acceptance.md. No local environment, database or node_modules is copied.
"""
from pathlib import Path
import hashlib
import html
import json
import os
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, timezone

repo = Path(__file__).resolve().parents[1]
assets = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2]).resolve()
password = os.environ.get('SEED_ADMIN_PASSWORD', '')
if not password or not password.isalnum() or len(password) < 5:
    raise SystemExit('Set an alphanumeric SEED_ADMIN_PASSWORD of at least 5 characters')
def git(*args):
    return subprocess.check_output(['git', *args], cwd=repo).decode().strip()
if git('status', '--porcelain'):
    raise SystemExit('Commit the reviewed source before packaging')
version = json.loads((repo / 'package.json').read_text())['version']
commit = git('rev-parse', 'HEAD')
name = f'tb-crm-demo-{version}'
stage = destination / name
if stage.exists():
    raise SystemExit('Use a new output directory; existing releases are never overwritten')
stage.mkdir(parents=True)
source = stage / '01_安装源码' / 'tb-crm'
source.mkdir(parents=True)
tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=repo).decode().split('\0')
for relative in filter(None, tracked):
    path = Path(relative)
    if path.is_absolute() or '..' in path.parts or path.name == '.env' or any(p in path.parts for p in ['.local', 'node_modules', '.git', '.artifacts', 'reference']):
        raise SystemExit('Unexpected tracked private/build path: ' + relative)
    if (repo / path).is_symlink():
        raise SystemExit('Symlinks must be reviewed before delivery: ' + relative)
    target = source / path
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(repo / path, target)
for folder in ['apps/api/dist', 'apps/web/dist', 'packages/shared/dist']:
    if not (repo / folder).is_dir():
        raise SystemExit('Build first: missing ' + folder)
    shutil.copytree(repo / folder, source / folder, ignore=shutil.ignore_patterns('*.map', '*.tsbuildinfo'))
# Credentials here are newly chosen demo seed values, never copied from the original environment.
shell = '#!/bin/sh\nset -eu\ncd "$(dirname "$0")"\nexport SEED_ADMIN_PASSWORD=' + password + '\nexec sh deploy/start.sh\n'
for filename in ['本地部署.sh', '本地部署.command']:
    path = source / filename
    path.write_text(shell)
    path.chmod(0o755)
(source / '本地部署.ps1').write_text("$env:SEED_ADMIN_PASSWORD = '" + password + "'\n& (Join-Path $PSScriptRoot 'deploy/start.ps1')\n")
folders = {'02_Demo介绍': ['*.pptx'], '03_演示与操作手册': ['*.docx', '*.html']}
for folder, patterns in folders.items():
    target = stage / folder
    target.mkdir()
    for pattern in patterns:
        for path in sorted((assets / 'output').glob(pattern)):
            shutil.copy2(path, target / path.name)
screens = list((assets / 'screenshots').glob('*.jpg'))
if len(screens) != 9:
    raise SystemExit('Exactly 9 actual screenshots are required')
shutil.copytree(assets / 'screenshots', stage / '04_九张功能截图')
records = stage / '05_版本与验收'
records.mkdir()
shutil.copy2(assets / 'acceptance.md', records / '验收记录.md')
shutil.copy2(repo / 'CHANGELOG.md', records / '版本更新记录.md')
if (assets / 'build/audit.json').exists():
    shutil.copy2(assets / 'build/audit.json', records / '依赖审计.json')
shutil.copy2(repo / 'LICENSE', stage / 'LICENSE')
(stage / '00_演示账号.txt').write_text('伴圆CRM演示账号\nadmin 管理员\nmanager 销售主管\nsales 销售\nboss 老板\n统一演示密码 ' + password + '\n首次安装生成独立数据库与JWT密钥。已有数据卷不会因修改种子变量自动改密码。\n')
intro = f'''伴圆CRM完整交付包 {version}
先阅读00_先读我.html，再按03_演示与操作手册中的本地部署手册启动。
推荐Docker Desktop或Engine和Compose v2，首次安装需联网下载镜像与依赖。
macOS双击01_安装源码/tb-crm/本地部署.command。
Linux运行 sh 本地部署.sh。Windows在PowerShell运行 本地部署.ps1。
就绪后打开 http://localhost:3000。四角色与口令见00_演示账号.txt。
02_Demo介绍为17页可编辑PPT，03为4套Word和HTML手册，04为9张真实截图和说明。
AI特点见独立说明：7个只读MCP工具可接入，摘要为规则生成，未接大模型。
财务只有展示，企业平台凭证联调及生产验收待完成。剩余依赖公告见05_版本与验收。
源码提交 {commit}
包内SHA256SUMS.txt为逐文件清单，包外.sha256校验整个ZIP。
'''
(stage / '00_先读我.txt').write_text(intro)
links = [('部署手册', '03_演示与操作手册/伴圆CRM_本地部署手册.html'), ('演示手册', '03_演示与操作手册/伴圆CRM_演示手册.html'), ('逐项操作手册', '03_演示与操作手册/伴圆CRM_逐项功能操作手册.html'), ('AI特点与智能体接入', '03_演示与操作手册/伴圆CRM_AI特点与智能体接入说明.html'), ('九张功能图说明', '04_九张功能截图/九张功能截图说明.html'), ('Demo介绍PPT', '02_Demo介绍/伴圆CRM_Demo介绍_v'+version+'.pptx'), ('演示账号', '00_演示账号.txt'), ('验收记录', '05_版本与验收/验收记录.md')]
(stage / '00_先读我.html').write_text('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>伴圆CRM完整交付</title><style>body{max-width:1000px;margin:48px auto;font:18px/1.9 sans-serif;color:#17233b}a{color:#1e40af}li{margin:10px 0}pre{white-space:pre-wrap;font:inherit}</style><body><h1>伴圆CRM完整交付包</h1><p>安装源码 演示资料 功能手册 AI接入与本地部署</p><ol>'+''.join('<li><a href="'+html.escape(u)+'">'+html.escape(t)+'</a></li>' for t,u in links)+'</ol><pre>'+html.escape(intro)+'</pre></body></html>')
manifest = {'product':'伴圆CRM', 'version':version, 'sourceCommit':commit, 'branch':git('branch', '--show-current'), 'createdAt':datetime.now(timezone.utc).isoformat(), 'license':'MIT', 'stage':'local demo and synthetic data testing', 'firstInstallRequiresNetwork':True, 'screenshots':9, 'slides':17, 'manualPages':{'operations':26,'demo':6,'ai':5,'deployment':6}, 'originalMachineSecretsIncluded':False, 'demoSeedPasswordIncluded':True, 'realCustomerDatabaseIncluded':False}
(stage / 'MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
files = sorted(p for p in stage.rglob('*') if p.is_file())
(stage / 'SHA256SUMS.txt').write_text(''.join(digest(p)+'  '+p.relative_to(stage).as_posix()+'\n' for p in files))
archive = destination / f'伴圆CRM_AI原生演示与本地部署完整交付包_{version}.zip'
with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for path in sorted(stage.rglob('*')):
        if path.is_file():
            z.write(path, path.relative_to(destination).as_posix())
(destination / (archive.name + '.sha256')).write_text(digest(archive)+'  '+archive.name+'\n')
print(json.dumps({'archive':str(archive),'sha256':digest(archive),'bytes':archive.stat().st_size,'sourceCommit':commit,'files':len(files)+1},ensure_ascii=False))
