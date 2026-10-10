"""Copy only required production SMTP fields. Never prints values; never writes WiseCut."""
from pathlib import Path
import os, re, sys
try:
    src = Path(__file__).resolve().parents[2] / 'wisecut/.secrets/account-2131138237/prod-application.env'
    values = {}
    for line in src.read_text().splitlines():
        m = re.match(r'^(?:export\s+)?([A-Z0-9_]+)=(.*)$', line.strip())
        if m:
            v=m[2].strip()
            if len(v)>1 and v[0]==v[-1] and v[0] in '\"\'': v=v[1:-1]
            values[m[1]]=v
    mapping={'SMTP_HOST':'SPRING_MAIL_HOST','SMTP_PORT':'SPRING_MAIL_PORT','SMTP_USER':'SPRING_MAIL_USERNAME','SMTP_PASS':'SPRING_MAIL_PASSWORD','SMTP_FROM':'MOJIAN_MONITORING_MAILFROM'}
    selected={k:values.get(v,'') for k,v in mapping.items()}
    if not selected['SMTP_FROM']: selected['SMTP_FROM']=selected['SMTP_USER']
    if any(not v or '\n' in v or '\r' in v for v in selected.values()) or selected['SMTP_PORT']!='465': raise ValueError()
    root=Path(__file__).resolve().parents[1]/'.secrets'
    root.mkdir(mode=0o700,exist_ok=True)
    target=root/'mail.env'
    fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as f: f.write(''.join(k+'='+v+'\n' for k,v in selected.items()))
    print('SMTP necessary fields copied (owner-only); no values displayed.')
except FileExistsError:
    print('Destination exists; not overwritten.')
except Exception:
    print('SMTP copy blocked; no source values displayed.')
    sys.exit(1)
