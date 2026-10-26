#!/usr/bin/env python3
"""Rolewave independent, no-cost SQLite backend. Python standard library only.
Local MVP, not a production security certification. Never deploy with DEV_DEMO=1.
"""
from __future__ import annotations
import base64, datetime as dt, hashlib, hmac, html, json, os, re, secrets, sqlite3, threading, time, urllib.parse, urllib.request, webbrowser
try:
 import psycopg
 PgIntegrityError = psycopg.IntegrityError
except ImportError:
 PgIntegrityError = type('PgIntegrityError', (Exception,), {})
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from uuid import uuid4

ROOT=Path(__file__).resolve().parent
DATA=Path(os.environ.get('ROLEWAVE_DATA',str(ROOT/'data')))
DATA.mkdir(parents=True,exist_ok=True)
DB=DATA/'rolewave.sqlite3'
DATABASE_URL=os.environ.get('DATABASE_URL','')
HOST=os.environ.get('HOST','127.0.0.1')
PORT=int(os.environ.get('PORT', '8765'))
DEMO=os.environ.get('DEV_DEMO','1' if HOST in ('127.0.0.1','localhost') else '0')=='1'
if HOST not in ('127.0.0.1','localhost') and DEMO: raise RuntimeError('DEV_DEMO must be disabled for public binding')
API_TIMEOUT=10
MIN_REFRESH={'Jobicy':3600,'Remotive':6*3600}
SYNC_LOCK=threading.Lock()
CATEGORIES=['Software Engineering','AI & Machine Learning','Data & Analytics','Cybersecurity','Cloud & DevOps','Product Management','UI/UX & Design','Marketing & Growth','IT Operations','QA & Testing','Video & Creative','Sales & Customer Success','Other Digital Roles']
now=lambda:dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')

class PgRow(dict):
 def __getitem__(self, key):
  if isinstance(key, int):return list(self.values())[key]
  return super().__getitem__(key)

class PgResult:
 def __init__(self, cursor):self.cursor=cursor;self.rowcount=cursor.rowcount
 def fetchone(self):
  r=self.cursor.fetchone();return PgRow(r) if r is not None else None
 def fetchall(self):return [PgRow(r) for r in self.cursor.fetchall()]
 def __iter__(self):
  for r in self.cursor:yield PgRow(r)

class PgConnection:
 def __init__(self):
  import psycopg
  from psycopg.rows import dict_row
  self.db=psycopg.connect(DATABASE_URL,row_factory=dict_row,connect_timeout=12)
 def __enter__(self):return self
 def __exit__(self,typ,value,tb):
  try:
   if typ:self.db.rollback()
   else:self.db.commit()
  finally:self.db.close()
 def execute(self,sql,values=()):
  sql=sql.strip()
  if sql.upper().startswith('INSERT OR IGNORE INTO'):
   sql=sql.replace('INSERT OR IGNORE INTO','INSERT INTO',1).rstrip(';')+' ON CONFLICT DO NOTHING'
  sql=sql.replace('?', '%s')
  return PgResult(self.db.execute(sql,tuple(values)))
 def executescript(self,script):
  for statement in script.split(';'):
   if statement.strip():self.db.execute(statement)

def conn():
 if DATABASE_URL:return PgConnection()
 c=sqlite3.connect(DB,timeout=15);c.row_factory=sqlite3.Row
 c.execute('PRAGMA foreign_keys=ON');c.execute('PRAGMA busy_timeout=15000');return c

def pw_hash(s):
 salt=secrets.token_bytes(16);return 'pbkdf2$'+base64.b64encode(salt).decode()+'$'+hashlib.pbkdf2_hmac('sha256',s.encode(),salt,310000).hex()

def verify_pw(raw,encoded):
 try:
  _,salt,digest=encoded.split('$');h=hashlib.pbkdf2_hmac('sha256',raw.encode(),base64.b64decode(salt),310000).hex();return hmac.compare_digest(h,digest)
 except (ValueError,TypeError):return False

def jrow(r):return dict(r) if r else None

def initialize():
 with conn() as c:
  if not DATABASE_URL:c.execute('PRAGMA journal_mode=WAL')
  c.executescript('''
  CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,role TEXT NOT NULL CHECK(role IN ('candidate','employer','admin')),password_hash TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,csrf TEXT NOT NULL,expires_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS companies(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,website TEXT,description TEXT,location TEXT,verified INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,source TEXT NOT NULL,source_id TEXT NOT NULL,company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,title TEXT NOT NULL,company TEXT NOT NULL,location TEXT NOT NULL,category TEXT NOT NULL,work_model TEXT NOT NULL,job_type TEXT NOT NULL,salary TEXT,description TEXT,apply_url TEXT,posted_at TEXT NOT NULL,seen_at TEXT NOT NULL,is_demo INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1, UNIQUE(source,source_id));
  CREATE TABLE IF NOT EXISTS applications(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,candidate_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,cover_letter TEXT,resume_url TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Submitted',created_at TEXT NOT NULL,UNIQUE(job_id,candidate_id));
  CREATE TABLE IF NOT EXISTS saved_jobs(candidate_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,created_at TEXT NOT NULL,PRIMARY KEY(candidate_id,job_id));
  CREATE TABLE IF NOT EXISTS source_status(source TEXT PRIMARY KEY,last_attempt TEXT,last_success TEXT,count INTEGER NOT NULL DEFAULT 0,error TEXT);
  CREATE INDEX IF NOT EXISTS idx_jobs_pub ON jobs(active,posted_at DESC);
  CREATE INDEX IF NOT EXISTS idx_company ON jobs(company_id);
  CREATE INDEX IF NOT EXISTS idx_apps_candidate ON applications(candidate_id);
  CREATE INDEX IF NOT EXISTS idx_apps_job ON applications(job_id);
  ''')
  for source in ['Jobicy','Remotive']:c.execute('INSERT OR IGNORE INTO source_status(source) VALUES(?)',(source,))
  if DEMO and c.execute('SELECT COUNT(*) FROM users').fetchone()[0]==0:
   emp='demo-employer'; cand='demo-candidate'; company='demo-company'
   c.execute('INSERT INTO users VALUES(?,?,?,?,?,?)',(emp,'Alex Morgan','employer@demo.test','employer',pw_hash('Demo12345!'),now()))
   c.execute('INSERT INTO users VALUES(?,?,?,?,?,?)',(cand,'Taylor Rivera','candidate@demo.test','candidate',pw_hash('Demo12345!'),now()))
   c.execute('INSERT INTO companies VALUES(?,?,?,?,?,?,0)',(company,emp,'Northstar Studio (DEMO)','https://example.com','Demonstration employer only; not a real vacancy.','Toronto, Canada'))
   examples=[('Product Designer','Toronto, Canada','UI/UX & Design','Hybrid','Full-time','CAD 90k–120k','Design accessible experiences and prototypes.'),('Full Stack Engineer','Remote — Worldwide','Software Engineering','Remote','Full-time','USD 90k–135k','Build performant API services with TypeScript and Python.'),('Performance Marketing Lead','Berlin, Germany','Marketing & Growth','Hybrid','Contract','EUR 60k–85k','Develop campaigns, analytics and conversion strategies.')]
   for i,(title,location,category,work,typ,salary,desc) in enumerate(examples,1):
    c.execute('''INSERT INTO jobs(id,source,source_id,company_id,title,company,location,category,work_model,job_type,salary,description,apply_url,posted_at,seen_at,is_demo,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)''',(f'demo-{i}','Rolewave',f'demo-{i}',company,title,'Northstar Studio (DEMO)',location,category,work,typ,salary,desc+' This is a sample job and is not a real opening.',None,now(),now(),1))

def external_url(raw):
 u=str(raw or '').strip()
 try:
  o=urllib.parse.urlparse(u)
  if o.scheme!='https' or not o.netloc or o.username or o.password:return ''
  return u[:2000]
 except ValueError:return ''

def strip_tags(x,limit=4500):
 s=str(x or '');s=re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>',' ',s);s=re.sub(r'<[^>]*>',' ',s);s=html.unescape(s)
 return re.sub(r'\s+',' ',s).strip()[:limit]

def json_fetch(url):
 req=urllib.request.Request(url,headers={'User-Agent':'RolewaveJobDiscovery/0.2 (+source attribution in every listing)','Accept':'application/json'})
 with urllib.request.urlopen(req,timeout=API_TIMEOUT) as f:return json.loads(f.read(5_000_000))

def collect(source):
 if source=='Jobicy':
  payload=json_fetch('https://jobicy.com/api/v2/remote-jobs?count=50')
  if not isinstance(payload,dict) or not isinstance(payload.get('jobs'),list):raise ValueError('Unexpected Jobicy response')
  rows=[]
  for j in payload['jobs']:
   url=external_url(j.get('url') or j.get('jobUrl'))
   if not url or not j.get('id') or not j.get('jobTitle'):continue
   sal=(', '.join(str(j.get(k)) for k in ['annualSalaryMin','annualSalaryMax'] if j.get(k)))
   rows.append(dict(source='Jobicy',source_id=str(j['id']),title=strip_tags(j.get('jobTitle'),200),company=strip_tags(j.get('companyName'),140) or 'Employer',location=strip_tags(j.get('jobGeo'),160) or 'Remote',category=strip_tags(j.get('jobIndustry'),90) or 'Other Digital Roles',work_model='Remote',job_type=strip_tags(j.get('jobType'),70),salary=(str(j.get('salaryCurrency') or 'USD')+' '+sal) if sal else None,description=strip_tags(j.get('jobDescription') or j.get('jobExcerpt')),apply_url=url,posted_at=str(j.get('pubDate') or now())))
  return rows
 if source=='Remotive':
  payload=json_fetch('https://remotive.com/api/remote-jobs?limit=100')
  if not isinstance(payload,dict) or not isinstance(payload.get('jobs'),list):raise ValueError('Unexpected Remotive response')
  rows=[]
  for j in payload['jobs']:
   url=external_url(j.get('url'))
   if not url or not j.get('id') or not j.get('title'):continue
   rows.append(dict(source='Remotive',source_id=str(j['id']),title=strip_tags(j.get('title'),200),company=strip_tags(j.get('company_name'),140) or 'Employer',location=strip_tags(j.get('candidate_required_location'),160) or 'Remote',category=strip_tags(j.get('category'),90) or 'Other Digital Roles',work_model='Remote',job_type=strip_tags(j.get('job_type'),70),salary=strip_tags(j.get('salary'),130) or None,description=strip_tags(j.get('description')),apply_url=url,posted_at=str(j.get('publication_date') or now())))
  return rows
 raise ValueError('Unknown source')

def synchronize():
 if not SYNC_LOCK.acquire(False):return [{'source':'system','status':'busy'}]
 try:
  outcome=[]
  for source in ('Jobicy','Remotive'):
   with conn() as c:
    s=c.execute('SELECT * FROM source_status WHERE source=?',(source,)).fetchone()
    if s['last_attempt']:
     try:seconds=(dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(s['last_attempt'])).total_seconds()
     except ValueError:seconds=1e8
     if seconds<MIN_REFRESH[source]:
      outcome.append({'source':source,'status':'cooldown','seconds_remaining':int(MIN_REFRESH[source]-seconds)});continue
    c.execute('UPDATE source_status SET last_attempt=?,error=NULL WHERE source=?',(now(),source))
   try:
    rows=collect(source)
    with conn() as c:
     for j in rows:
      c.execute('''INSERT INTO jobs(id,source,source_id,title,company,location,category,work_model,job_type,salary,description,apply_url,posted_at,seen_at,is_demo,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,1) ON CONFLICT(source,source_id) DO UPDATE SET title=excluded.title,company=excluded.company,location=excluded.location,category=excluded.category,work_model=excluded.work_model,job_type=excluded.job_type,salary=excluded.salary,description=excluded.description,apply_url=excluded.apply_url,posted_at=excluded.posted_at,seen_at=excluded.seen_at,active=1''',('ext-'+hashlib.sha256((source+':'+j['source_id']).encode()).hexdigest()[:30],source,j['source_id'],j['title'],j['company'],j['location'],j['category'],j['work_model'],j['job_type'],j['salary'],j['description'],j['apply_url'],j['posted_at'],now()))
     c.execute('UPDATE source_status SET last_success=?,count=?,error=NULL WHERE source=?',(now(),len(rows),source))
    outcome.append({'source':source,'status':'success','imported':len(rows)})
   except Exception as exc:
    error=strip_tags(f'{type(exc).__name__}: {exc}',240)
    with conn() as c:c.execute('UPDATE source_status SET error=? WHERE source=?',(error,source))
    outcome.append({'source':source,'status':'error','message':error})
  return outcome
 finally:SYNC_LOCK.release()

class APIError(Exception):
 def __init__(self,message,status=400):self.message=message;self.status=status

class Handler(BaseHTTPRequestHandler):
 server_version='Rolewave/0.2'
 def log_message(self,fmt,*args):pass
 def respond(self,body,status=200,headers=None):
  blob=json.dumps(body,ensure_ascii=False).encode()
  self.send_response(status)
  self.send_header('Content-Type','application/json; charset=utf-8')
  self.send_header('Cache-Control','no-store')
  self.send_header('X-Content-Type-Options','nosniff')
  self.send_header('Content-Length',str(len(blob)))
  for k,v in (headers or {}).items():self.send_header(k,v)
  self.end_headers();self.wfile.write(blob)
 def page(self):
  raw=(ROOT/'static'/'index.html').read_bytes()
  self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
 def request_body(self):
  n=int(self.headers.get('Content-Length','0'))
  if n<0 or n>900_000:raise APIError('Request too large',413)
  try:return json.loads(self.rfile.read(n).decode() or '{}')
  except (json.JSONDecodeError,UnicodeError):raise APIError('Invalid JSON')
 def user(self):
  cookie=SimpleCookie()
  try:cookie.load(self.headers.get('Cookie',''))
  except Exception:return None
  if 'rw_session' not in cookie:return None
  token=cookie['rw_session'].value
  digest=hashlib.sha256(token.encode()).hexdigest()
  with conn() as c:
   a=c.execute('SELECT u.id,u.name,u.email,u.role,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=? AND s.expires_at>?',(digest,now())).fetchone()
  return jrow(a)
 def require(self,role=None):
  u=self.user()
  if not u:raise APIError('Sign in to continue',401)
  if role and u['role']!=role:raise APIError('This action requires a '+role+' account',403)
  if self.command not in ('GET','HEAD') and self.headers.get('X-CSRF-Token','')!=u['csrf']:raise APIError('Security token missing or expired',403)
  return u
 def _error(self,e):self.respond({'error':e.message},e.status)
 def do_GET(self):
  try:self.get()
  except APIError as e:self._error(e)
  except Exception as e:print('API GET error:',repr(e));self.respond({'error':'Server error'},500)
 def get(self):
  p=urllib.parse.urlparse(self.path); path=p.path; q=urllib.parse.parse_qs(p.query)
  if path=='/':return self.page()
  if path=='/api/health':return self.respond({'ok':True,'database':'PostgreSQL' if DATABASE_URL else 'SQLite','storage':'Render Postgres' if DATABASE_URL else DB.name,'mode':'local-demo' if DEMO else 'configured','timestamp':now()})
  if path=='/api/me':return self.respond({'user':self.user()})
  if path=='/api/categories':return self.respond({'categories':CATEGORIES})
  if path=='/api/sources':
   with conn() as c: rows=[dict(i) for i in c.execute('SELECT * FROM source_status')]
   return self.respond({'sources':rows,'disclaimer':'External jobs appear only when an API request succeeds. Demo jobs are fictional.'})
  if path=='/api/jobs':
   term=(q.get('q',[''])[0] or '').strip()[:140];location=(q.get('location',[''])[0] or '').strip()[:80];cat=q.get('category',['all'])[0];work=q.get('work',['all'])[0];src=q.get('source',['live+direct'])[0]
   conditions=['active=1'];args=[]
   if src=='live+direct':conditions.append('is_demo=0')
   elif src=='demo':conditions.append('is_demo=1')
   elif src=='external':conditions.append("source IN ('Jobicy','Remotive')")
   elif src=='direct':conditions.append("source='Rolewave' AND is_demo=0")
   elif src!='all':raise APIError('Invalid source filter')
   if term:
    t='%'+term.lower().replace('%','').replace('_','')+'%';conditions.append('(lower(title) LIKE ? OR lower(company) LIKE ? OR lower(category) LIKE ? OR lower(description) LIKE ?)');args.extend([t]*4)
   if location:conditions.append('lower(location) LIKE ?');args.append('%'+location.lower().replace('%','').replace('_','')+'%')
   if cat!='all':conditions.append('category=?');args.append(cat)
   if work!='all':conditions.append('lower(work_model)=?');args.append(work.lower())
   where=' AND '.join(conditions)
   page=max(1,min(100,int((q.get('page',['1'])[0] or '1'))));size=20;offset=(page-1)*size
   with conn() as c:
    count=c.execute('SELECT COUNT(*) FROM jobs WHERE '+where,args).fetchone()[0]
    items=[dict(x) for x in c.execute('SELECT * FROM jobs WHERE '+where+' ORDER BY posted_at DESC LIMIT ? OFFSET ?',args+[size,offset])]
   return self.respond({'jobs':items,'total':count,'page':page,'page_size':size})
  if path=='/api/saved':
   u=self.require('candidate')
   with conn() as c: items=[dict(x) for x in c.execute('SELECT j.* FROM saved_jobs s JOIN jobs j ON j.id=s.job_id WHERE s.candidate_id=? ORDER BY s.created_at DESC',(u['id'],))]
   return self.respond({'jobs':items})
  if path=='/api/applications':
   u=self.require('candidate')
   with conn() as c: items=[dict(x) for x in c.execute('SELECT a.id,a.status,a.created_at,j.title,j.company,j.location,j.id as job_id FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.candidate_id=? ORDER BY a.created_at DESC',(u['id'],))]
   return self.respond({'applications':items})
  if path=='/api/employer':
   u=self.require('employer')
   with conn() as c:
    company=jrow(c.execute('SELECT * FROM companies WHERE owner_id=?',(u['id'],)).fetchone())
    jobs=[dict(x) for x in c.execute('SELECT j.*, (SELECT COUNT(*) FROM applications a WHERE a.job_id=j.id) applicant_count FROM jobs j JOIN companies c ON c.id=j.company_id WHERE c.owner_id=? ORDER BY posted_at DESC',(u['id'],))]
    apps=[dict(x) for x in c.execute('''SELECT a.id,a.status,a.cover_letter,a.resume_url,a.created_at,us.name candidate,us.email,j.title,j.company,j.id job_id FROM applications a JOIN jobs j ON a.job_id=j.id JOIN companies c ON j.company_id=c.id JOIN users us ON a.candidate_id=us.id WHERE c.owner_id=? ORDER BY a.created_at DESC''',(u['id'],))]
   return self.respond({'company':company,'jobs':jobs,'applications':apps})
  if path=='/api/db-overview':
   if not DEMO:self.require('admin')
   with conn() as c:
    tables=['users','companies','jobs','applications','saved_jobs','source_status']
    counts={table:c.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] for table in tables}
    jobs=[dict(x) for x in c.execute('SELECT title,company,source,is_demo,posted_at FROM jobs ORDER BY posted_at DESC LIMIT 7')]
   return self.respond({'engine':'PostgreSQL' if DATABASE_URL else 'SQLite 3','counts':counts,'recent_jobs':jobs,'file':'PostgreSQL (persistent)' if DATABASE_URL else 'SQLite (ephemeral on Render)', 'note':'Sensitive user/application data intentionally not returned.'})
  raise APIError('Not found',404)
 def do_POST(self):
  try:self.post()
  except APIError as e:self._error(e)
  except Exception as e:print('API POST error:',repr(e));self.respond({'error':'Server error'},500)
 def post(self):
  path=urllib.parse.urlparse(self.path).path;data=self.request_body()
  if path=='/api/auth/register':
   name=str(data.get('name') or '').strip()[:100];email=str(data.get('email') or '').lower().strip()[:180];password=str(data.get('password') or '');role=data.get('role')
   if len(name)<2 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email) or not 10<=len(password)<=128 or role not in ('candidate','employer'):raise APIError('Enter name, valid email, password (10+ characters), and role')
   with conn() as c:
    try:c.execute('INSERT INTO users VALUES(?,?,?,?,?,?)',(str(uuid4()),name,email,role,pw_hash(password),now()))
    except (sqlite3.IntegrityError, PgIntegrityError):raise APIError('Email already registered',409)
   return self.respond({'ok':True,'message':'Account created. You can sign in.'},201)
  if path=='/api/auth/login':
   email=str(data.get('email') or '').strip().lower();pw=str(data.get('password') or '')
   with conn() as c:u=c.execute('SELECT * FROM users WHERE email=?',(email,)).fetchone()
   if not u or not verify_pw(pw,u['password_hash']):raise APIError('Invalid email or password',401)
   token=secrets.token_urlsafe(35);digest=hashlib.sha256(token.encode()).hexdigest();csrf=secrets.token_urlsafe(25)
   expiry=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(days=3)).isoformat(timespec='seconds')
   with conn() as c:c.execute('INSERT INTO sessions VALUES(?,?,?,?)',(digest,u['id'],csrf,expiry))
   secure='; Secure' if self.headers.get('X-Forwarded-Proto','')=='https' else ''
   self.respond({'ok':True,'user':{'id':u['id'],'name':u['name'],'email':u['email'],'role':u['role'],'csrf':csrf}},headers={'Set-Cookie':f'rw_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=259200{secure}'})
   return
  if path=='/api/auth/logout':
   u=self.require();cookie=SimpleCookie();cookie.load(self.headers.get('Cookie',''))
   if 'rw_session' in cookie:
    digest=hashlib.sha256(cookie['rw_session'].value.encode()).hexdigest()
    with conn() as c:c.execute('DELETE FROM sessions WHERE token_hash=?',(digest,))
   return self.respond({'ok':True},headers={'Set-Cookie':'rw_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'})
  if path=='/api/company':
   u=self.require('employer');name=str(data.get('name') or '').strip()[:120]
   if len(name)<2:raise APIError('Company name is required')
   with conn() as c:
    old=c.execute('SELECT id FROM companies WHERE owner_id=?',(u['id'],)).fetchone()
    if old:c.execute('UPDATE companies SET name=?,website=?,location=?,description=? WHERE id=?',(name,external_url(data.get('website')),str(data.get('location') or '')[:150],str(data.get('description') or '')[:1500],old['id']))
    else:c.execute('INSERT INTO companies VALUES(?,?,?,?,?,?,0)',(str(uuid4()),u['id'],name,external_url(data.get('website')),str(data.get('description') or '')[:1500],str(data.get('location') or '')[:150]))
   return self.respond({'ok':True})
  if path=='/api/jobs':
   u=self.require('employer')
   title=str(data.get('title') or '').strip()[:190];loc=str(data.get('location') or '').strip()[:130];description=str(data.get('description') or '').strip()[:4200]
   if len(title)<3 or not loc or len(description)<30:raise APIError('Title, location, and a description of 30+ characters are required')
   with conn() as c:
    co=c.execute('SELECT * FROM companies WHERE owner_id=?',(u['id'],)).fetchone()
    if not co:raise APIError('Create a company profile before posting',400)
    job_id=str(uuid4());c.execute('''INSERT INTO jobs(id,source,source_id,company_id,title,company,location,category,work_model,job_type,salary,description,posted_at,seen_at,is_demo) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)''',(job_id,'Rolewave',job_id,co['id'],title,co['name'],loc,str(data.get('category') or 'Other Digital Roles')[:100],str(data.get('work_model') or 'Remote')[:15],str(data.get('job_type') or 'Full-time')[:25],str(data.get('salary') or '')[:100],description,now(),now()))
   return self.respond({'ok':True,'job_id':job_id},201)
  if path=='/api/applications':
   u=self.require('candidate')
   jid=str(data.get('job_id') or '');url=external_url(data.get('resume_url'));cover=str(data.get('cover_letter') or '')[:3000]
   if not url:raise APIError('Add an HTTPS resume link. Do not provide passwords.')
   with conn() as c:
    j=c.execute('SELECT * FROM jobs WHERE id=? AND active=1',(jid,)).fetchone()
    if not j or j['source']!='Rolewave':raise APIError('Only direct jobs support in-platform applications',400)
    try:c.execute('INSERT INTO applications VALUES(?,?,?,?,?,?,?)',(str(uuid4()),jid,u['id'],cover,url,'Submitted',now()))
    except (sqlite3.IntegrityError, PgIntegrityError):raise APIError('You have already applied to this job',409)
   return self.respond({'ok':True,'status':'Submitted'},201)
  if path=='/api/saved':
   u=self.require('candidate');jid=str(data.get('job_id') or '')
   with conn() as c:
    if not c.execute('SELECT 1 FROM jobs WHERE id=? AND active=1',(jid,)).fetchone():raise APIError('Job not found',404)
    if data.get('save',True):c.execute('INSERT OR IGNORE INTO saved_jobs VALUES(?,?,?)',(u['id'],jid,now()))
    else:c.execute('DELETE FROM saved_jobs WHERE candidate_id=? AND job_id=?',(u['id'],jid))
   return self.respond({'ok':True})
  match=re.fullmatch(r'/api/applications/([0-9a-f-]{36}|[a-zA-Z0-9-]+)/status',path)
  if match:
   u=self.require('employer');stage=str(data.get('status') or '')
   if stage not in ('Submitted','In Review','Shortlisted','Interview','Rejected','Hired'):raise APIError('Invalid status')
   with conn() as c:
    r=c.execute('''UPDATE applications SET status=? WHERE id=? AND job_id IN (SELECT j.id FROM jobs j JOIN companies co ON j.company_id=co.id WHERE co.owner_id=?)''',(stage,match.group(1),u['id']))
    if r.rowcount==0:raise APIError('Application not found in your company',404)
   return self.respond({'ok':True,'status':stage})
  if path=='/api/sync':
   # Public refresh is upstream-rate-limited and concurrency-protected.
   return self.respond({'results':synchronize()})
  raise APIError('Not found',404)

def background_sync():
    # 6-hour target while a server process is alive; each provider has its own guard.
    # A free host that sleeps when idle cannot guarantee this schedule.
    time.sleep(5)
    while True:
        try:
            with conn() as c:
                last=c.execute("SELECT last_attempt FROM source_status WHERE source='Remotive'").fetchone()
            last_at=last['last_attempt'] if last else None
            due=not last_at
            if last_at:
                try: due=(dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(last_at)).total_seconds()>=6*3600
                except ValueError:due=True
            if due:synchronize()
        except Exception as exc:print('Background sync issue:',repr(exc))
        time.sleep(300)

def run_server():
 if os.environ.get('RENDER')=='true' and not DATABASE_URL:
  print('WARNING: Temporary SQLite on Render: records can reset at restart/redeploy. Attach DATABASE_URL for persistence.')
 initialize()
 print('Rolewave — independent FREE Postgres/SQLite MVP')
 print(f'Go to http://{HOST}:{PORT}/');print('Database:', 'PostgreSQL via DATABASE_URL' if DATABASE_URL else DB);print('DEMO:',DEMO)
 if os.environ.get('AUTO_SYNC','1')=='1':
  threading.Thread(target=background_sync,daemon=True).start()
 ThreadingHTTPServer((HOST,PORT),Handler).serve_forever()
if __name__=='__main__':run_server()