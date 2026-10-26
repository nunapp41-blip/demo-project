# Rolewave — Global IT & Digital Jobs

Independent full-stack job search portal built with Python, PostgreSQL/SQLite and vanilla JavaScript. Search live Jobicy and Remotive jobs when available; each external listing shows its original source and application URL. Candidates can register, apply to jobs posted on Rolewave and track status. Employers can register, post jobs and manage applicants.

**Free hosting:** Render Free Web Service. Connect a Postgres `DATABASE_URL` for durable storage; without it SQLite is temporary on Render and may reset after redeploy or restart. No jobs are fabricated as live data.

Start: `pip install -r requirements.txt && python server.py`. Public service must use `HOST=0.0.0.0` and `DEV_DEMO=0`. Automatic source refresh is best-effort while the free server runs. This project is an MVP, not a production security-audited job board.
