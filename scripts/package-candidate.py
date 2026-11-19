"""Package the latest clean, audited source and TIANYU-only synthetic demonstration."""
from pathlib import Path
import subprocess,json,shutil,hashlib,zipfile,sys,html
repo=Path(__file__).resolve().parents[1]
def git(*args):return subprocess.check_output(['git',*args],cwd=repo,text=True).strip()
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
if len(sys.argv)!=2:raise SystemExit('Usage: python3 scripts/package-candidate.py NEW_OUTPUT_DIRECTORY')
if git('status','--porcelain'):raise SystemExit('Commit reviewed changes before packaging')
subprocess.run(['node','scripts/audit-public-tree.mjs'],cwd=repo,check=True)
head=git('rev-parse','HEAD');dest=Path(sys.argv[1]).resolve()
if dest.exists():raise SystemExit('Choose a new output directory; existing handoffs are preserved')
name='OS-CRM-Tianyu-AI-2.0-'+head[:7];stage=dest/name;source=stage/'01_源码与安装';source.mkdir(parents=True)
for f in subprocess.check_output(['git','ls-files','-z'],cwd=repo,text=True).split('\0'):
 if not f:continue
 p=repo/f
 if p.is_symlink():raise SystemExit('Unexpected symlink: '+f)
 target=source/f;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
for f in ['apps/api/dist','apps/web/dist','packages/shared/dist']:
 if not(repo/f).is_dir():raise SystemExit('Run pnpm build first')
 shutil.copytree(repo/f,source/f,ignore=shutil.ignore_patterns('*.map','*.tsbuildinfo'))
readme='伴圆CRM AI操作型CRM\n\n全部公开业务样本均为虚构天雨演示数据，不含真实企业业务、连接、凭证、数据库或备份。\n\n先读01_源码与安装/README.md及demo/tianyu/README.md。需要Node24、pnpm11.25.0、MySQL8；首次安装需联网。先安装空公司，再按说明创建独立TIANYU测试帐套。14个演示账号统一密码12345，仅供隔离测试。正式公司使用独立强密码和随机密钥。\n\nAI根据明确授权的资料形成历史记录和未来计划，写入遵守当前权限、来源、版本和事务回执；审批、签约、验收与到账分别核实。\n\n源码提交：'+head+'\n'
(stage/'00_先读我.txt').write_text(readme)
(stage/'00_先读我.html').write_text('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>伴圆CRM当前交付</title><style>body{max-width:960px;margin:40px auto;padding:24px;font:16px/1.9 system-ui;color:#234}pre{font:inherit;white-space:pre-wrap}a{color:#245ac0}</style><h1>伴圆CRM AI操作型CRM</h1><p><a href="01_源码与安装/README.md">产品与流程介绍</a></p><pre>'+html.escape(readme)+'</pre></html>')
manifest={'product':'伴圆CRM','sourceCommit':head,'demoVersion':'2.0','fictional':True,'publicBusinessData':'TIANYU only','realCompanyDataIncluded':False,'machineConfigurationIncluded':False,'credentialsIncluded':False,'demoPasswordPublic':True,'productionAccepted':False,'firstInstallRequiresNetwork':True,'dataset':json.loads((repo/'demo/tianyu/manifest.json').read_text())['counts']};(stage/'MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
files=sorted(p for p in stage.rglob('*')if p.is_file());(stage/'SHA256SUMS.txt').write_text(''.join(digest(p)+'  '+p.relative_to(stage).as_posix()+'\n'for p in files))
zpath=dest/(name+'.zip')
with zipfile.ZipFile(zpath,'x',zipfile.ZIP_DEFLATED,compresslevel=6)as z:
 for p in sorted(stage.rglob('*')):
  if p.is_file():z.write(p,p.relative_to(dest).as_posix())
with zipfile.ZipFile(zpath)as z:assert z.testzip()is None
(zpath.with_suffix('.zip.sha256')).write_text(digest(zpath)+'  '+zpath.name+'\n')
print(json.dumps({'status':'PASS','archive':str(zpath),'sha256':digest(zpath),'bytes':zpath.stat().st_size,'sourceCommit':head,'files':len(files)+1},ensure_ascii=False))
