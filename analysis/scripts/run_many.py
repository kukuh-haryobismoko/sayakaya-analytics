"""Run a multi-query .sql file split by '-- Q:<name>' markers; prints rows per query. Usage: python3 run_many.py file.sql"""
import subprocess,sys,json,re,tempfile,os
txt=open(sys.argv[1]).read()
parts=re.split(r'^-- Q:(\S+)\s*$',txt,flags=re.M)
here=os.path.dirname(os.path.abspath(__file__))
for name,sql in zip(parts[1::2],parts[2::2]):
    f=tempfile.NamedTemporaryFile('w',suffix='.sql',delete=False);f.write(sql);f.close()
    r=subprocess.run(['node',os.path.join(here,'bq.js'),f.name],capture_output=True,text=True)
    print('##',name)
    print(r.stdout.strip()[:3000] if r.returncode==0 else 'ERROR '+r.stderr.strip()[:400])
