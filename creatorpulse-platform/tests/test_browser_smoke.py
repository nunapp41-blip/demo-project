"""Browser smoke tests for JS event wiring; mock external Google API responses.
Runs with python tests/test_browser_smoke.py, requires installed Playwright and Chromium.
Live external Google responses are intentionally NOT mocked into a public deployment.
"""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
WEB=ROOT/'apps/web/public'
html=(WEB/'index.html').read_text()
html=re.sub(r'<script\s+src="[^"]+"\s*></script>','',html)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page()
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html)
    page.evaluate("""() => { window.fetch=async (url) => {
      const path=String(url);
      let status=200, data={};
      if(path.includes('/v1/system/status'))data={checkedAt:new Date().toISOString(),backend:{ready:true,mode:'public_readonly_demo',version:'1.2'},features:{officialYouTubeStatistics:false,privateAccounts:false},storage:{durableHosting:false}};
      else if(path.includes('/v1/config'))data={youtubeConfigured:false,publicDemo:true};
      else if(path.includes('/metadata'))data={title:'Verified public test video',channel:'Actual channel',source:'youtube_oembed',fetchedAt:new Date().toISOString()};
      else if(path.includes('/v1/public/search') && window.__searchReady)data={query:'video growth',region:'US',checkedAt:new Date().toISOString(),results:[{videoId:'dQw4w9WgXcQ',title:'Actual search hit',channelTitle:'Channel',position:1}]};
      else if(path.includes('/uploads'))data={channelTitle:'Feed channel',results:[{videoId:'dQw4w9WgXcQ',title:'Public upload',publishedAt:'2026-11-01'}],checkedAt:new Date().toISOString()};
      else if(path.includes('/stats')||path.includes('/v1/public/search')){status=503;return new Response(JSON.stringify({error:{message:'YOUTUBE_API_NOT_CONFIGURED'}}),{status,headers:{'content-type':'application/json'}});}
      return new Response(JSON.stringify({data}),{status,headers:{'content-type':'application/json'}});
    } }""")
    for name in ['app.js','quick-search.js','live.js','accounts.js','reality.js']:
        page.add_script_tag(content=(WEB/name).read_text())
    page.wait_for_timeout(250)
    page.fill('#quickSearchInput','dQw4w9WgXcQ');page.click('#quickSearchButton')
    page.wait_for_timeout(350)
    a=page.locator('#quickSearchResults').inner_text()
    assert 'Verified public test video' in a, a
    assert 'UNAVAILABLE' in a, a
    page.fill('#quickSearchInput','UCBR8-60-B28hp2BmDPdntcQ');page.click('#quickSearchButton')
    page.wait_for_timeout(350)
    assert 'Public upload' in page.locator('#quickSearchResults').inner_text()
    page.evaluate('location.hash="#keywords"')
    page.fill('#keywordInput','video growth')
    page.click('#searchKeywords');page.wait_for_timeout(350)
    rows=page.locator('#keywordRows').inner_text()
    assert 'Official search unavailable' in rows and 'View current results directly on YouTube' in rows,rows
    assert 'sample keyword' not in rows.lower(), rows
    # With an actual official response, one network handler must render the returned item.
    page.evaluate('window.__searchReady=true')
    page.click('#searchKeywords');page.wait_for_timeout(350)
    assert 'Actual search hit' in page.locator('#keywordRows').inner_text()
    page.evaluate('location.hash="#analyzer"')
    page.fill('#titleInput','How to Grow Your YouTube Channel in 30 Days')
    page.click('#analyzeBtn')
    assert int(page.locator('#titleScore').inner_text())>0
    assert not errors,errors
    print('Browser smoke PASS: video, channel, official-search success/failure, title analyzer; JS errors: none')
    browser.close()
