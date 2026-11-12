"""Phase 2 report builder. Re-runs saved queries via q.py, writes outputs/*.md|csv and charts. Usage: python3 build_phase2.py"""
import csv,json,math,os,re,subprocess,sys
from collections import defaultdict
H=os.path.dirname(os.path.abspath(__file__));O=os.path.join(H,'..','outputs');os.makedirs(O+'/charts',exist_ok=True)
def Q(f):
    r=subprocess.run(['python3',H+'/q.py',H+'/'+f],capture_output=True,text=True).stdout.strip()
    assert not r.startswith('ERROR'),r
    return json.loads(r)
def wil(a,n):
    if n==0:return (0,0)
    p=a/n;d=1.96;den=1+d*d/n;m=(p+d*d/(2*n))/den;h=d*math.sqrt(p*(1-p)/n+d*d/(4*n*n))/den;return 100*(m-h),100*(m+h)
def z(a,n1,b,n2):
    p=(a+b)/(n1+n2);se=math.sqrt(p*(1-p)*(1/n1+1/n2));return (a/n1-b/n2)/se
def pct(a,n):return '%.1f%%'%(100*a/n) if n else 'n/a'
def ci(a,n):l,h=wil(a,n);return '%.1f-%.1f%%'%(l,h)
def c10(n):return '<10' if n<10 else f'{n:,}'
# ---- funnel
F={x['stage']:int(x['n']) for x in Q('40_funnel.sql')}
reg,sub,ver,fail,inv,rep=F['registered'],F['kyc_submitted(verified|failed)'],F['kyc_approved'],F['kyc_rejected'],F['investor'],F['repeat_investor(buy_days>=2)']
ch90,ch180,act=F['investor_churned_gt90'],F['investor_churned_gt180'],F['investor_active_le90']
young=F['investor_first_buy_le90d_ago']
T={x['k']:x for x in Q('41_timing.sql')}
C=Q('42_cohorts.sql')
with open(O+'/cohorts.csv','w',newline='') as f:
    w=csv.writer(f);w.writerow(['reg_month_wib','registered','verified','failed','investor_ever','investor_within_7d','investor_within_30d','repeat_investor','ver_pct','inv_pct','inv30_pct'])
    for x in C:
        r=int(x['reg']);w.writerow([x['m'],r,x['ver'],x['failed'],x['inv'],x['inv7'],x['inv30'],x['repeat_inv'],round(100*int(x['ver'])/r,1),round(100*int(x['inv'])/r,1),round(100*int(x['inv30'])/r,1)])
assert sum(int(x['reg']) for x in C)==reg and sum(int(x['inv']) for x in C)==inv  # cross-check: cohort rows add up to funnel
V=Q('46_leak.sql')
def S(rows,k):return sum(int(x[k]) for x in rows)
ms=lambda a,b:[x for x in C if a<=x['m']<=b]
js,oc=ms('2026-01','2026-09'),ms('2026-10','2026-10')
jsr,ocr=S(js,'reg'),S(oc,'reg')
jsv,ocv=S(js,'ver'),S(oc,'ver')
jsu,ocu=jsr-jsv-S(js,'failed'),ocr-ocv-S(oc,'failed')
vjs=[x for x in V if '2026-01'<=x['vm']<='2026-09'];voc=[x for x in V if x['vm']=='2026-10'][0]
vjs_v,vjs_7=S(vjs,'ver'),S(vjs,'b7');vo_v,vo_7=int(voc['ver']),int(voc['b7'])
v13=[x for x in V if x['vm']>='2025-11'];v13v,v13n=S(v13,'ver'),S(v13,'never')
gap_exp=vo_v*vjs_7/vjs_v;gap=gap_exp-vo_7
unv13=S(ms('2025-11','2026-11'),'reg')-S(ms('2025-11','2026-11'),'ver')-S(ms('2025-11','2026-11'),'failed')
iv_js=S(js,'inv')/jsv
unv_gap=jsu-jsr*ocu/ocr
L=lambda a,b:f'{a:,} / {b:,} = {pct(a,b)}'
with open(O+'/funnel_overview.md','w') as f:
    f.write(f"""# Funnel overview (Phase 2)
Run {os.popen("date '+%Y-%m-%d %H:%M WIB'").read().strip()}. Cohort C (excl. RAIZ/RAIZKAYA and HNWI), all-time to 2026-11-09, Asia/Jakarta. Scripts: `40_funnel.sql`, `41_timing.sql`, `42_cohorts.sql`, `46_leak.sql` (via `q.py`, `build_phase2.py`). All numbers Observed unless labelled.

## 1. Stage conversion (n = {reg:,} registered)
| Stage | Users | % of registered | Step conversion | 95% CI of step |
|---|---|---|---|---|
| Registered | {reg:,} | 100% | | |
| KYC submitted (verified or failed) | {sub:,} | {pct(sub,reg)} | {pct(sub,reg)} of registered | {ci(sub,reg)} |
| KYC approved | {ver:,} | {pct(ver,reg)} | {pct(ver,sub)} of submitted | {ci(ver,sub)} |
| KYC rejected | {fail:,} | {pct(fail,reg)} | {pct(fail,sub)} of submitted | {ci(fail,sub)} |
| Investor (first paid buy) | {inv:,} | {pct(inv,reg)} | {pct(inv,ver)} of approved | {ci(inv,ver)} |
| Repeat investor (buys on 2+ days) | {rep:,} | {pct(rep,reg)} | {pct(rep,inv)} of investors | {ci(rep,inv)} |
| Still active (last activity within 90 d) | {act:,} | {pct(act,reg)} | {pct(act,inv)} of investors | {ci(act,inv)} |
| Churned (no activity > 90 d) | {ch90:,} | | {pct(ch90,inv)} of investors | {ci(ch90,inv)} |

Not finished KYC (status unverified): {F['kyc_unverified']:,} = {pct(F['kyc_unverified'],reg)} of registered. Investors not verified: {F['investor_not_verified']}. Verified, never bought: {F['verified_not_investor']:,} = {pct(F['verified_not_investor'],ver)} of approved.
Churn base note: {young} investors made their first buy within 90 days, so are not yet classifiable; excluding them churn is {ch90:,} / {inv-young:,} = {pct(ch90,inv-young)}.
Sensitivity: with a 180-day line, {ch180:,} of {inv:,} investors are churned ({pct(ch180,inv)}) vs {pct(ch90,inv)} at 90 days; the funnel shape does not change.
Cohort size is {reg:,}, 2 more than the 63,793 of Phase 1: users who registered after the Phase 1 run (Observed; same rules).
Churn count here (activity = buy, sell, SWITCH_IN) is {ch90:,}. Phase 1 `definitions.md` quoted 3,165 using buys only; the 165 difference are users whose last buy is older than 90 d but who sold or switched in the last 90 d (`49_chk.sql`). Phase 2 uses the activity definition.

Before/after exclusion (Observed, Phase 1 `20_cohort_stages.sql`): registered 320,606 -> 63,912 (excl. RAIZ/RAIZKAYA) -> 63,793 (excl. HNWI); approved 17,210 -> 16,776 -> 16,657; investors 260,219 -> 3,706 -> 3,587.

## 2. Time between stages (days, cohort C; users with a valid timestamp pair)
| Transition | n | p50 | p90 | Pairs with negative gap (dropped) |
|---|---|---|---|---|
| Register -> approved | {T['reg_to_verified']['n']:,} | {T['reg_to_verified']['p50']} | {T['reg_to_verified']['p90']} | {T['reg_to_verified']['neg']} |
| Approved -> first buy | {T['verified_to_first_buy']['n']:,} | {T['verified_to_first_buy']['p50']} | {T['verified_to_first_buy']['p90']} | {T['verified_to_first_buy']['neg']} |
| Register -> first buy | {T['reg_to_first_buy']['n']:,} | {T['reg_to_first_buy']['p50']} | {T['reg_to_first_buy']['p90']} | {T['reg_to_first_buy']['neg']} |

n for register -> approved is lower than {ver:,} approved because `verified_at` is empty for {ver-int(T['reg_to_verified']['n']):,} approved users (data quality #5). Reading: half of approved users are approved within a day, 90% within about 4 days; buyers who buy do it fast (median about 1 day after approval) but the p90 is 91 days, so a long tail buys much later.

## 3. Register cohorts by month (full table: `cohorts.csv`, chart: `charts/cohort_monthly.png`)
| Reg month | Registered | Approved | Approved % | Investor within 7 d | Within 7 d % | Investor ever % |
|---|---|---|---|---|---|---|
""")
    for x in C[-14:]:
        r=int(x['reg']);f.write(f"| {x['m']} | {r} | {x['ver']} | {pct(int(x['ver']),r)} | {x['inv7']} | {pct(int(x['inv7']),r)} | {pct(int(x['inv']),r)} |\n")
    f.write(f"""
Recent months are not mature (a 2026-11 user has had at most 9 days). Compare 7-day conversion, which is mature for all months through 2026-11-02.

## 4. Biggest leaks and recoverable users (arithmetic shown)

### Leak 1. Registered but KYC not finished
- Observed: {F['kyc_unverified']:,} of {reg:,} ({pct(F['kyc_unverified'],reg)}) never reached a KYC result. Last 13 registration months (2025-11 to 2026-11): {unv13:,} of {S(ms('2025-11','2026-11'),'reg'):,} ({pct(unv13,S(ms('2025-11','2026-11'),'reg'))}).
- Observed: Jan-Sep 2026 cohorts left {jsu:,} of {jsr:,} ({pct(jsu,jsr)}) unfinished; the Oct 2026 cohort (booth month) left {ocu:,} of {ocr:,} ({pct(ocu,ocr)}). Difference significant (z = {z(ocu,ocr,jsu,jsr):.1f}).
- Estimate: if Jan-Sep cohorts had finished like Oct, {jsu:,} - {jsr:,} x {ocu}/{ocr} = {unv_gap:.0f} more users reach KYC result. At the Jan-Sep investor-per-approved rate ({S(js,'inv')} / {jsv} = {pct(S(js,'inv'),jsv)} ever) that is about {unv_gap*S(js,'inv')/jsv:.0f} investors; at the Oct verified-to-buy-within-7-days rate ({vo_7} / {vo_v} = {pct(vo_7,vo_v)}) about {unv_gap*vo_7/vo_v:.0f}. Assumption: the Oct pattern is reproducible outside booths (not tested).

### Leak 2. Approved but never buys (largest in user count)
- Observed: {F['verified_not_investor']:,} of {ver:,} approved users ({pct(F['verified_not_investor'],ver)}) never made a paid buy. Approved from 2025-11 on: {v13n:,} of {v13v:,} ({pct(v13n,v13v)}) never bought.
- Observed: users approved in Oct 2026 bought within 7 days at {vo_7} / {vo_v} = {pct(vo_7,vo_v)} ({ci(vo_7,vo_v)}) vs Jan-Sep 2026 {vjs_7} / {vjs_v} = {pct(vjs_7,vjs_v)} ({ci(vjs_7,vjs_v)}); z = {z(vo_7,vo_v,vjs_7,vjs_v):.1f}. More approvals did not bring more buyers.
- Estimate: Oct approvals at the Jan-Sep rate would be {vo_v} x {vjs_7}/{vjs_v} = {gap_exp:.0f} buyers within 7 days; observed {vo_7}; shortfall {gap:.0f} investors. Oct cohort buying may still arrive later, so treat the shortfall as an upper bound (Observed: the 30-day figure for early-Oct approvals is {voc['b30']} of {vo_v}).
- Pool: each +1 percentage point of the {v13n:,} recent never-buyers = {v13n/100:.0f} investors.
- Observed (`52_oct_split.sql` cut of the Oct 2026 cohort, 611 registered): with a sales code 363 registered, 271 approved, 26 bought ever = 7.2%; without 219 registered, 130 approved, 14 bought = 6.4%. Both are low, so the Oct drop is not only a booth effect. Cause not identified; Phase 3 should look at what the booth sign-up flow asks users to do after KYC.

### Leak 3. First-time investors who do not come back (churn)
- Observed: {ch90:,} of {inv:,} investors are silent for more than 90 days ({pct(ch90,inv)}); {ch180:,} for more than 180 d. {inv-rep:,} ({pct(inv-rep,inv)}) bought on only one day. See `churn_profile.md`.
- Estimate: each +10% of churned users reactivated = {ch90*0.1:.0f} users (Proposed; no observed reactivation campaign rate in data yet).

### Leak 4. KYC rejection
- Observed: {fail:,} rejected of {sub:,} submitted ({pct(fail,sub)}); last 13 months {S(ms('2025-11','2026-11'),'failed')} of {S(ms('2025-11','2026-11'),'failed')+S(ms('2025-11','2026-11'),'ver')} ({pct(S(ms('2025-11','2026-11'),'failed'),S(ms('2025-11','2026-11'),'failed')+S(ms('2025-11','2026-11'),'ver'))}). Rejection reasons are not in BigQuery (data request).
- Estimate (Proposed): halving the last-13-month rejection count recovers {S(ms('2025-11','2026-11'),'failed')//2} approved users, about {S(ms('2025-11','2026-11'),'failed')//2*inv//ver} investors at the all-time investor-per-approved rate ({pct(inv,ver)}).

## 5. Verified-to-buy by month of approval (`46_leak.sql`)
| Approval month | Approved | Bought within 7 d | % | Never bought (to date) |
|---|---|---|---|---|
""")
    for x in V:
        v=int(x['ver']);f.write(f"| {x['vm']} | {v} | {x['b7']} | {pct(int(x['b7']),v)} | {x['never']} |\n")
    f.write("\nWithin-7-day count includes the few users who bought before `verified_at` (data quality #10).\n")
# ---- churn
D=Q('43_dur.sql')
for x in D:
    for k in('dur','silent','age','buy_days','act_days'):x[k]=int(x[k])
ev=[(x['dur']+90 if x['silent']>90 else x['age'],x['silent']>90) for x in D]
ts=sorted(set(t for t,e in ev if e));Sv=1;km={}
for t in ts:
    d=sum(1 for a,e in ev if a==t and e);n=sum(1 for a,e in ev if a>=t);Sv*=1-d/n;km[t]=Sv
kmv=lambda T:([km[t] for t in km if t<=T] or [1])[-1]
old=[x for x in D if x['age']>90]
def grp(key,rows=old):
    g=defaultdict(lambda:[0,0])
    for x in rows:k=key(x);g[k][0]+=1;g[k][1]+=x['silent']>90
    return g
ad=grp(lambda x:'1' if x['act_days']==1 else '2-3' if x['act_days']<=3 else '4-9' if x['act_days']<=9 else '10+')
hy=grp(lambda x:x['fm'][:4]+('-H1' if x['fm'][5:]<'07' else '-H2'))
ch=sorted(x['dur'] for x in old if x['silent']>90);nc=len(ch)
I=Q('50_indicators.sql')
def ig(key):
    g=defaultdict(lambda:[0,0])
    for x in I:
        if str(x['mature']).lower()!='true':continue
        k=key(x);g[k][0]+=int(x['n']);g[k][1]+=int(x['churn'])
    return g
a30=ig(lambda x:x['act30_b']);amt=ig(lambda x:x['amt_b']);ft=ig(lambda x:x['first_type']);pm=ig(lambda x:x['first_pm'])
def trow(g,order=None):
    s=''
    for k in (order or sorted(g)):
        n,c=g[k];s+=f"| {k} | {c10(n)} | {c10(c)} | {pct(c,n)} | {ci(c,n)} |\n"
    return s
hdr="| Group | Users | Churned | Churn % | 95% CI |\n|---|---|---|---|---|\n"
with open(O+'/churn_profile.md','w') as f:
    f.write(f"""# Churn profile (Phase 2)
Run {os.popen("date '+%Y-%m-%d %H:%M WIB'").read().strip()}. Cohort C investors (n = {len(D):,}). Churned = no buy/sell/SWITCH_IN for more than 90 days at 2026-11-09 (`definitions.md`). Scripts: `43_dur.sql`, `50_indicators.sql`, `49_chk.sql`, `build_phase2.py`.

## Who and when (Observed)
- {ch90:,} of {inv:,} investors churned ({pct(ch90,inv)}). To avoid counting young accounts, tables below use the {len(old):,} investors whose first buy is more than 90 days ago ({sum(1 for x in old if x['silent']>90):,} churned = {pct(sum(1 for x in old if x['silent']>90),len(old))}).
- Among churned users, last activity falls: same day as first buy {pct(sum(1 for d in ch if d==0),nc)}; within 7 days {pct(sum(1 for d in ch if d<=7),nc)}; within 30 days {pct(sum(1 for d in ch if d<=30),nc)}; median {ch[nc//2]} days after first buy; p75 {ch[3*nc//4]} days.

## Survival curve (Kaplan-Meier, share of investors not yet churned, days since first buy)
Churn is dated 90 days after the last activity; users still active or inside the window are censored at their age.

| Days since first buy | 90 | 120 | 180 | 270 | 365 | 450 |
|---|---|---|---|---|---|---|
| Not churned | {' | '.join('%.1f%%'%(100*kmv(t)) for t in (90,120,180,270,365,450))} |

Reading: 10% churn before day 90 (they never came back after the first buy day); half are gone by about one year. This chart is dominated by the 2022-2025 buyers (older buyers outnumber recent ones, see "By first-buy half-year").

## After what behaviour (Observed, correlation)
Active days in first life (all activity days, users with first buy over 90 d ago):
{hdr}{trow(ad,['1','2-3','4-9','10+'])}
Read: all {c10(ad['1'][0])} one-day users churned by definition (one active day cannot be followed by a return), so this table mostly says "repeat buyers survive". Not independent of the definition.

Leading indicators measured at first buy / first 30 days (users with first buy at least 120 days ago, so every user has had the same observation time; churn = silent > 90 d now). Indicators are measured before churn, so they are usable for early warning, but these are Correlation, not Causal:

Activity in the 30 days after first buy (count of active days):
{hdr}{trow(a30,['0','1','2-3','4+'])}
z-test 0 vs 4+ days: {z(a30['0'][1],a30['0'][0],a30['4+'][1],a30['4+'][0]):.1f}. Evidence: High (large n, big gap).

Size of the first buy:
{hdr}{trow(amt,['<100k','100-500k','0.5-5jt','5jt+'])}
z-test <100k vs 0.5-5jt: {z(amt['<100k'][1],amt['<100k'][0],amt['0.5-5jt'][1],amt['0.5-5jt'][0]):.1f}. Evidence: Med (could reflect testers or bonus-triggered tiny buys).

Fund type of the first buy:
{hdr}{trow(ft)}
Payment method of the first buy:
{hdr}{trow(pm)}
Types or methods with fewer than 10 users are shown as `<10`; PROTECTED n = {c10(ft['PROTECTED'][0])} is low-confidence.

## By first-buy half-year (Simpson / survivorship check)
{hdr}{trow(hy)}
Newer cohorts show lower churn mainly because they have had less time to churn (right-censoring), so do not read 2026-H1 as an improvement without the survival curve.

## Leading indicator summary
- Observed: no follow-up activity in the 30 days after the first buy -> {pct(a30['0'][1],a30['0'][0])} churn vs {pct(a30['4+'][1],a30['4+'][0])} with 4+ active days.
- Observed: first buy under Rp100k -> {pct(amt['<100k'][1],amt['<100k'][0])} churn vs {pct(amt['0.5-5jt'][1],amt['0.5-5jt'][0])} for Rp0.5-5 million.
- Inferred: a 30-day reactivation push after first buy is the earliest lever; first buy size under Rp100k marks low commitment. Proposed for Phase 3.
- Not available: churn by marketing source/device (the DB has no acquisition field; GA user mapping covers only Oct-Nov 2026). Added to Data Requests.
""")
# ---- segments
Sg=Q('44_segments.sql')
PERS=re.compile(r'^[A-Z0-9]{7}$')
def anon(c,m):return m.setdefault(c,'personal-code-%02d'%(len(m)+1)) if (PERS.match(c) and c!='BPJSKES') or c=='ZAENALGFHP' else c
def segtab(dim,minreg=0,top=None,use_ver=True):
    rows=[x for x in Sg if x['dim']==dim and int(x['reg'])>=minreg]
    rows=rows[:top] if top else rows
    m={}
    s="| Segment | Registered | Approved | Approved % (95% CI) | Investors | Investor % of approved (95% CI) | Investor % of registered |\n|---|---|---|---|---|---|---|\n"
    for x in rows:
        r,v,i=int(x['reg']),int(x['ver']),int(x['inv']);seg=anon(x['seg'],m) if dim=='referrer' else x['seg']
        if r<10:continue
        flag=' (low n)' if r<30 else ''
        s+=f"| {seg}{flag} | {c10(r)} | {c10(v)} | {pct(v,r)} ({ci(v,r)}) | {c10(i)} | {pct(i,v) if v>=10 else 'n/a'} ({ci(i,v) if v>=10 else 'n/a'}) | {pct(i,r)} |\n"
    return s
sv={(x['dim'],x['seg']):x for x in Sg}
g=lambda d,s,k:int(sv[(d,s)][k])
refs=[x for x in Sg if x['dim']=='referrer' and x['seg']!='(none)']
rr,rv,ri=S(refs,'reg'),S(refs,'ver'),S(refs,'inv')
nn=sv[('referrer','(none)')];nr,nv,ni=int(nn['reg']),int(nn['ver']),int(nn['inv'])
GS=Q('48_ga_seg.sql')
def gtab(dim,top=8):
    s="| Segment | Registered (GA, cohort C) | KYC success | KYC % (95% CI) | Payment complete | Payment % (95% CI) |\n|---|---|---|---|---|---|\n"
    for x in [y for y in GS if y['dim']==dim][:top]:
        r,k,p=int(x['reg']),int(x['kyc']),int(x['pay'])
        if r<10:continue
        s+=f"| {x['seg']}{' (low n)' if r<30 else ''} | {r} | {c10(k)} | {pct(k,r)} ({ci(k,r)}) | {c10(p)} | {pct(p,r)} ({ci(p,r)}) |\n"
    return s
gos={x['seg']:x for x in GS if x['dim']=='os'}
with open(O+'/segments.md','w') as f:
    f.write(f"""# Segment cuts (Phase 2)
Run {os.popen("date '+%Y-%m-%d %H:%M WIB'").read().strip()}. Cohort C, all-time. Scripts: `44_segments.sql` (DB), `48_ga_seg.sql` (GA, 2026-10-01 to 2026-11-08), `51_ga_src.sql`. Cells under 10 are hidden (`<10`) and rows with n < 30 are marked low-confidence. 95% CI = Wilson. All Correlation.

Profile fields (gender, age, occupation, income, city) are filled only after KYC, so for those cuts the useful denominator is approved users. For approved users the 'Investor % of approved' column is the fair comparison; the `(null)` rows are users who never reached the profile step.
Monthly income and city are not analysed: income is empty for all {reg:,} users (Observed, `44_segments.sql`); city has about 500 values, most cells under 10.

## Acquisition: referrer code (DB)
- Observed: with a referrer code (not RAIZ/RAIZKAYA): {rr:,} registered, {rv:,} approved, {ri:,} investors = {pct(ri,rr)} of registered ({ci(ri,rr)}). No code (NULL or empty): {nr:,} registered, {nv:,} approved, {ni:,} investors = {pct(ni,nr)} of registered ({ci(ni,nr)}). z = {z(ri,rr,ni,nr):.1f}. Referral codes: {len(refs)} distinct.
- Top codes by registered users (personal-looking codes are pseudonymised):
{segtab('referrer',top=13)}
- Inferred: code `personal-code-01` converts at a very different rate from other personal codes with similar volume (1.7-3.0% investors per registered for codes 02-06 vs 62.4%); the high-volume personal codes register many users who do not finish KYC. A reward tied to registration instead of first buy could explain it; not tested. Phase 3 should use this for the incentive rule.

## Sales code (booth / sales rep)
{segtab('has_sales_code')}
- Observed: users with a sales code reach investor at {pct(g('has_sales_code','yes','inv'),g('has_sales_code','yes','reg'))} of registered vs {pct(g('has_sales_code','no','inv'),g('has_sales_code','no','reg'))}; approval {pct(g('has_sales_code','yes','ver'),g('has_sales_code','yes','reg'))} vs {pct(g('has_sales_code','no','ver'),g('has_sales_code','no','reg'))}. Investor per approved: {pct(g('has_sales_code','yes','inv'),g('has_sales_code','yes','ver'))} vs {pct(g('has_sales_code','no','inv'),g('has_sales_code','no','ver'))} (z = {z(g('has_sales_code','yes','inv'),g('has_sales_code','yes','ver'),g('has_sales_code','no','inv'),g('has_sales_code','no','ver')):.1f}). Selection: sales-code users were helped through KYC, so approval is not comparable.

## Registration period
{segtab('reg_period')}
- Observed: Oct 2026 onward (booth event) approval {pct(g('reg_period','2026-10+ (booth era)','ver'),g('reg_period','2026-10+ (booth era)','reg'))} vs {pct(g('reg_period','before 2026-10','ver'),g('reg_period','before 2026-10','reg'))} before. Investor rate is not comparable yet because the Oct-Nov cohort is young; use the 7-day columns in `funnel_overview.md` (Oct 2026: {pct(int(oc[0]['inv7']),int(oc[0]['reg']))} within 7 d vs Jan-Sep {pct(S(js,'inv7'),jsr)}; z = {z(int(oc[0]['inv7']),int(oc[0]['reg']),S(js,'inv7'),jsr):.1f}).

## Demographics (approved users only are comparable)
Gender:
{segtab('gender')}
- Observed: female approved users invest at {pct(g('gender','female','inv'),g('gender','female','ver'))} vs male {pct(g('gender','male','inv'),g('gender','male','ver'))}; z = {z(g('gender','female','inv'),g('gender','female','ver'),g('gender','male','inv'),g('gender','male','ver')):.1f}. Evidence: High (large n), Correlation.

Age (at registration):
{segtab('age')}
Occupation:
{segtab('occupation')}
- Observed: `tentara/polisi` {c10(g('occupation','tentara/polisi','inv'))} investors of {g('occupation','tentara/polisi','ver')} approved ({pct(g('occupation','tentara/polisi','inv'),g('occupation','tentara/polisi','ver'))}), far below `pegawai swasta` ({pct(g('occupation','pegawai swasta','inv'),g('occupation','pegawai swasta','ver'))}); `pensiunan`, `guru/dosen`, `pns` are highest. Occupation and age overlap (Simpson risk): not separated here.

Other: bank_account_skipped = true: {c10(g('bank_skipped','true','reg'))} registered, {c10(g('bank_skipped','true','ver'))} approved, {c10(g('bank_skipped','true','inv'))} investors; institutions: {c10(g('is_institution','true','reg'))} registered, {c10(g('is_institution','true','inv'))} investors (n=15 low-confidence).

## Acquisition source, device and region (GA, Oct 1 - Nov 8, 2026, users who registered and logged in)
Source / medium (GA first-touch of the device):
{gtab('source_medium')}
OS:
{gtab('os')}
- Observed: iOS KYC {pct(int(gos['iOS']['kyc']),int(gos['iOS']['reg']))} vs Android {pct(int(gos['Android']['kyc']),int(gos['Android']['reg']))} (z = {z(int(gos['iOS']['kyc']),int(gos['iOS']['reg']),int(gos['Android']['kyc']),int(gos['Android']['reg'])):.1f}, significant); payment complete {pct(int(gos['iOS']['pay']),int(gos['iOS']['reg']))} vs {pct(int(gos['Android']['pay']),int(gos['Android']['reg']))} (z = {z(int(gos['iOS']['pay']),int(gos['iOS']['reg']),int(gos['Android']['pay']),int(gos['Android']['reg'])):.1f}, not significant).
App version:
{gtab('app_version')}
Region (GA geo):
{gtab('region',6)}
Campaign: GA campaign is `(null)` or `(direct)` for {int([y for y in GS if y['dim']=='campaign'][0]['reg'])+int([y for y in GS if y['dim']=='campaign'][1]['reg'])} of {sum(int(y['reg']) for y in GS if y['dim']=='campaign')} registered users: not usable for campaign analysis (Data Request).
- Observed (GA, devices, not users, `51_ga_src.sql`): `google / cpc` shows 130 devices in the window with 0 first_open, 0 registrations and 3 devices with payment_complete. Inferred: ad-attributed devices are mostly installs from before Oct 1, or the attribution field is stale; cannot judge ad performance from this table. Data Request.
- Caveats: GA attributes only users who logged in (user_id); version 2.28.2 holds almost all users so version cannot explain differences.
""")
# ---- GA vs DB
R=Q('45_ga_db.sql');r={(x['stage'],x['src']):int(x['n']) for x in R}
def rr_(a,b):return pct(r[a],r[b])
with open(O+'/ga_vs_db.md','w') as f:
    f.write(f"""# GA vs DB reconciliation (Phase 2)
Run {os.popen("date '+%Y-%m-%d %H:%M WIB'").read().strip()}. Window 2026-10-01 to 2026-11-08 (Asia/Jakarta; GA `event_date` is already WIB, DB timestamps shifted +7 h). DB is source of truth. Same exclusion on both sides: GA mapped through `user_id` to cohort C; devices without `user_id` cannot be excluded or counted. Scripts: `45_ga_db.sql`, `22_churn_ga.sql`.

| Stage | GA metric | GA | DB metric | DB | GA / DB | Likely cause (Inferred unless stated) | Fix |
|---|---|---|---|---|---|---|---|
| Register | `register_success`, users in cohort C | {r[('register','ga_users_cohort')]} | users with `created_at` in window | {r[('register','db_users')]} | {rr_(('register','ga_users_cohort'),('register','db_users'))} | Missing events: {r[('register','db_users')]-r[('register','db_users_ga_matched')]} DB registrations ({pct(r[('register','db_users')]-r[('register','db_users_ga_matched')],r[('register','db_users')])}) have no GA `register_success` for the same user_id (Observed). Possible: event not sent offline/ad-block/consent, web or non-app registration path | Log register server-side; check whether web sign-up exists |
| Register (duplicates) | `register_success` events vs users, all users | {r[('register','ga_events_all')]} events | distinct users | {r[('register','ga_users_all')]} | {pct(r[('register','ga_events_all')]-r[('register','ga_users_all')],r[('register','ga_users_all')])} extra events | Event fires more than once per user (Observed) | Fire once per user_id; dedupe in reports |
| KYC | `kyc_success`, users in cohort C | {r[('kyc_success','ga_users_cohort')]} | KYC approved (`verified_at` in window) | {r[('kyc_success','db_verified_in_window')]} | {rr_(('kyc_success','ga_users_cohort'),('kyc_success','db_verified_in_window'))} | GA fires on submission, not approval: {r[('kyc_success','ga_users_not_verified_in_db')]} GA users are not approved in the DB (Observed). DB approved matched in GA {r[('kyc_success','db_verified_ga_matched')]} of {r[('kyc_success','db_verified_in_window')]} ({rr_(('kyc_success','db_verified_ga_matched'),('kyc_success','db_verified_in_window'))}) | Rename to `kyc_submitted`; add `kyc_approved` from the server |
| KYC (compare to submitted) | `kyc_success`, users in cohort C | {r[('kyc_success','ga_users_cohort')]} | registered in window, status verified or failed | {r[('kyc_success','db_submitted_in_window(verified|failed, reg in window)')]} | {rr_(('kyc_success','ga_users_cohort'),('kyc_success','db_submitted_in_window(verified|failed, reg in window)'))} | Closer match supports "GA = submission". Windows differ (registered in window vs event date), so approximate | |
| KYC start | `kyc_start`, users in cohort C | {r[('kyc_start','ga_users_cohort')]} | no DB equivalent | n/a | | Not available: DB records no 'started' state | |
| Order | `order_created`, users in cohort C | {r[('order_created','ga_users_cohort')]} | users with a buy transaction (any status, not bonus) | {r[('order_created','db_buy_orders_users(any status)')]} | {rr_(('order_created','ga_users_cohort'),('order_created','db_buy_orders_users(any status)'))} | Missing events (Observed gap {r[('order_created','db_buy_orders_users(any status)')]-r[('order_created','ga_users_cohort')]} users) | Same as register |
| Paid | `payment_complete`, users in cohort C | {r[('payment_complete','ga_users_cohort')]} | users with successful buy | {r[('payment_complete','db_buy_success_users')]} | {rr_(('payment_complete','ga_users_cohort'),('payment_complete','db_buy_success_users'))} | DB successful buyers matched in GA: {r[('payment_complete','db_buy_success_users_ga_matched')]} of {r[('payment_complete','db_buy_success_users')]} ({rr_(('payment_complete','db_buy_success_users_ga_matched'),('payment_complete','db_buy_success_users'))}). Statuses set by operations (`verified_by_operational` {r.get(('payment_complete','db_buy_users_by_status:verified_by_operational'),0)} users, `verified` {r.get(('payment_complete','db_buy_users_by_status:verified'),0)}) are not triggered in the app, so GA cannot see them | Server-side purchase event on status change |
| Paid (events) | `payment_complete` events, cohort C | {r[('payment_complete','ga_events_cohort')]} | successful buy transactions | {r[('payment_complete','db_buy_success_txns')]} | {rr_(('payment_complete','ga_events_cohort'),('payment_complete','db_buy_success_txns'))} | Fewer events than transactions; payment on a different day than creation also shifts counts (window by event date vs `created_at`) | |

## Other checks (Observed)
- `user_id` is set only after login: `first_open` has 0 users with `user_id`, and 2,869 of 3,375 devices (85%) have rows without it (Phase 1 DQ #25). Pre-login steps (install, open, sign-up start) can only be counted per device.
- GA to DB mapping: 2,254 of 2,257 GA user_ids exist in `main.users`. Of 2,257 GA users: 144 are RAIZ/RAIZKAYA, 77 HNWI, 2,033 kept (Phase 1 DQ #26).
- Timezone: GA `event_date` is WIB; DB `created_at` is UTC and shifted +7 h. Checked on one day only.
- Not tested: bot traffic (no bot flag in the export), consent mode / ad-block (no consent field read), consent rate.

## Fix list (Proposed, order by value)
1. Server-side events for register, KYC approved, order created, payment complete (closes {r[('register','db_users')]-r[('register','db_users_ga_matched')]} register and {r[('payment_complete','db_buy_success_users')]-r[('payment_complete','db_buy_success_users_ga_matched')]} paid user gaps in this window).
2. Rename or split `kyc_success` into submitted and approved.
3. Dedupe `register_success`.
4. Send `user_id` (or a hashed id) from the first screen so pre-login funnel steps can be tied to users.
5. Fill `campaign`/`source` consistently (campaign is empty for most registrations).
""")
# ---- charts
import matplotlib;matplotlib.use('Agg');import matplotlib.pyplot as plt
fig,ax=plt.subplots(figsize=(7,3.6));lab=['Registered','KYC submitted','KYC approved','Investor','Repeat','Active <=90d'];val=[reg,sub,ver,inv,rep,act]
ax.barh(lab[::-1],val[::-1],color='#3b6ea5')
for i,v in enumerate(val[::-1]):ax.text(v,i,f' {v:,} ({100*v/reg:.1f}%)',va='center',fontsize=8)
ax.set_xlim(0,reg*1.35);ax.set_title(f'Funnel, cohort C (n={reg:,})',fontsize=10);plt.tight_layout();plt.savefig(O+'/charts/funnel.png',dpi=130);plt.close()
M=[x for x in C if x['m']>='2025-11'];fig,ax=plt.subplots(figsize=(8,3.6));xs=[x['m'] for x in M]
ax.plot(xs,[100*int(x['ver'])/int(x['reg']) for x in M],marker='o',label='Approved % of registered');ax.plot(xs,[100*int(x['inv7'])/int(x['reg']) for x in M],marker='o',label='Investor within 7 d % of registered')
ax.set_ylabel('%');ax.tick_params(axis='x',rotation=60,labelsize=8);ax.legend(fontsize=8);ax.set_title('Register cohorts: KYC rose in Oct 2026, buying did not',fontsize=10);plt.tight_layout();plt.savefig(O+'/charts/cohort_monthly.png',dpi=130);plt.close()
ks=sorted(km);fig,ax=plt.subplots(figsize=(6,3.4));ax.step([0]+[t for t in ks if t<=900],[100]+[100*km[t] for t in ks if t<=900],where='post')
ax.set_xlabel('Days since first buy');ax.set_ylabel('% not churned');ax.set_title('Investor survival (churn = 90 d silent)',fontsize=10);ax.grid(alpha=.3);plt.tight_layout();plt.savefig(O+'/charts/survival.png',dpi=130);plt.close()
print('ok')
