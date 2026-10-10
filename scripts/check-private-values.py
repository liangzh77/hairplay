"""No values are printed. Scan public builds, Git-visible files, and stage-A logs."""
from pathlib import Path
import subprocess,re,sys
root=Path(__file__).resolve().parents[1]
values=[]
for name in ('mail.env','ark.env'):
    p=root/'.secrets'/name
    if not p.exists(): continue
    for line in p.read_text().splitlines():
        m=re.match(r'^(SMTP_USER|SMTP_PASS|SMTP_FROM|VOLCENGINE_ARK_API_KEY)=(.+)$',line)
        if m: values.append(m[2].encode())
if not values: print('PRIVATE_SCAN_BLOCKED: configuration missing');sys.exit(1)
paths=set()
for arg in (['ls-files','-z'],['ls-files','--others','--exclude-standard','-z']):
    paths.update(root/str(p,'utf8') for p in subprocess.check_output(['git',*arg],cwd=root).split(b'\0') if p)
for build in ('client/dist/build/h5','client/dist/build/mp-weixin'):
    paths.update(p for p in (root/build).rglob('*') if p.is_file())
paths.update(Path('/tmp/hairplay').glob('email-*.log'))
paths.update(Path('/tmp/hairplay').glob('email-implementation.diff'))
report=Path('/tmp/hairplay/implementation-report.md')
if report.exists(): paths.add(report)
failed=False
for p in paths:
    if not p.is_file():continue
    data=p.read_bytes()
    if any(v in data for v in values):failed=True
    if 'dist/build' in str(p) and re.search(r'(?:\.env|\.sqlite(?:-wal|-shm)?|\.db|\.pem|\.key)$',p.name):failed=True
# Only disclose aggregate status, not matched data or private paths.
print(('PRIVATE_SCAN_FAIL' if failed else 'PRIVATE_SCAN_PASS')+f': {len(paths)} files; credential/address literals and forbidden build files checked; values suppressed.')
sys.exit(1 if failed else 0)
