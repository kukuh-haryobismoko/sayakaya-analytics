"""Run a .sql with {{BASE}} (cohort C CTEs: U users, B buys, A activity) and print JSON rows. Usage: q.py f.sql [dry] [csv_out]
HNWI list (SIDs with AUM>=500M on any snapshot) is inlined from a local cache so it is scanned once."""
import json,os,subprocess,sys,tempfile
H=os.path.dirname(os.path.abspath(__file__));C=os.path.expanduser('~/.hermes/cache/scratch/hnwi_sids.json')
if not os.path.exists(C):
    r=subprocess.run(['node',H+'/bq.js',H+'/16_hnwi_ever.sql'],capture_output=True,text=True,check=True)
    json.dump([x['sid_code'] for x in json.loads(r.stdout)],open(C,'w'))
L=",".join("'%s'"%s for s in json.load(open(C)))
OK="('completed','completed_payment','verified','verified_by_operational')"
NB="IFNULL(payment_method,'') NOT IN ('manual_bonus','bonus')"
BASE=f"""U AS (SELECT id, sid_code, referrer_code, sales_code, is_institution, verification_status, DATETIME_ADD(created_at,INTERVAL 7 HOUR) reg_at, DATETIME_ADD(verified_at,INTERVAL 7 HOUR) ver_at
  FROM `sayakaya.main.users` WHERE (referrer_code IS NULL OR UPPER(TRIM(referrer_code)) NOT IN ('RAIZ','RAIZKAYA')) AND IFNULL(sid_code,'') NOT IN ({L})),
B AS (SELECT t.user_id, DATETIME(MIN(t.created_at),'Asia/Jakarta') first_buy, DATETIME(MAX(t.created_at),'Asia/Jakarta') last_buy, COUNT(DISTINCT DATE(t.created_at,'Asia/Jakarta')) buy_days
  FROM `sayakaya.main.transactions` t JOIN U ON U.id=t.user_id WHERE t.type='buy' AND t.status IN {OK} AND {NB.replace('payment_method','t.payment_method')} GROUP BY 1),
A AS (SELECT t.user_id, DATE(t.created_at,'Asia/Jakarta') d FROM `sayakaya.main.transactions` t JOIN B ON B.user_id=t.user_id WHERE t.type IN ('buy','sell','SWITCH_IN') AND t.status IN {OK} AND {NB.replace('payment_method','t.payment_method')} AND DATETIME(t.created_at,'Asia/Jakarta')>=B.first_buy GROUP BY 1,2)"""
import re
parts=re.split(r'^-- Q:(\S+)\n',open(sys.argv[1]).read(),flags=re.M)
qs=[('',parts[0])] if len(parts)==1 else list(zip(parts[1::2],parts[2::2]))
for name,q in qs:
    f=tempfile.NamedTemporaryFile('w',suffix='.sql',delete=False);f.write(q.replace('{{BASE}}',BASE));f.close()
    r=subprocess.run(['node',H+'/bq.js',f.name]+(['dry'] if 'dry' in sys.argv[2:3] else []),capture_output=True,text=True)
    if name: print('## '+name)
    print(r.stdout.strip() if r.returncode==0 else 'ERROR '+r.stderr.strip()[:600])
