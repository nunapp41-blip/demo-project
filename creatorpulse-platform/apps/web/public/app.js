(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const sampleKeywords = [
    ['youtube growth tips', 88, 33, 93, 'Strategy'],
    ['how to grow youtube channel', 92, 52, 85, 'Tutorial'],
    ['youtube seo for beginners', 76, 28, 89, 'Education'],
    ['youtube shorts ideas', 95, 79, 63, 'Shorts'],
    ['video editing for beginners', 81, 38, 87, 'Production'],
    ['youtube thumbnail design', 79, 40, 84, 'Design'],
    ['best free ai tools for creators', 84, 57, 76, 'AI tools'],
    ['youtube video titles', 68, 24, 86, 'Optimization'],
    ['youtube algorithm explained', 86, 67, 71, 'Education'],
    ['youtube channel kaise grow kare', 83, 35, 91, 'Hindi'],
    ['यूट्यूब चैनल कैसे बढ़ाएं', 78, 31, 90, 'Hindi'],
    ['video retention tips', 68, 20, 88, 'Audience'],
  ];
  const initialTracked = ['youtube seo for beginners', 'video retention tips', 'youtube growth tips'];
  const trackedKey = 'creatorpulse-tracked-v1';
  const escapeHtml = (str) => String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let tracked = initialTracked;
  try { const saved = JSON.parse(localStorage.getItem(trackedKey)); if (Array.isArray(saved)) tracked = saved.filter(x => typeof x === 'string').slice(0,100); } catch (_) {}
  let toastTimeout;
  function toast(message){const t=$('toast');t.textContent=message;t.classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>t.classList.remove('show'),3300);}
  function pageFromHash(){const key=location.hash.slice(1).split('?')[0];return ['dashboard','keywords','analyzer','rank','competitors','extension','live','design'].includes(key)?key:'dashboard';}
  const labels={dashboard:'Overview',keywords:'Keyword Explorer',analyzer:'Title Analyzer',rank:'Rank Tracker',competitors:'Competitors',extension:'Chrome Extension',live:'Live API Tools',design:'Design System'};
  function navigate(){const p=pageFromHash();document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id===`page-${p}`));document.querySelectorAll('.nav-link').forEach(el=>el.classList.toggle('active',el.dataset.page===p));$('breadcrumb').textContent=labels[p];document.title=`${labels[p]} — CreatorPulse`;window.scrollTo({top:0,behavior:'instant'});$('sidebar').classList.remove('open');}
  window.addEventListener('hashchange',navigate);navigate();
  $('mobileMenu').addEventListener('click',()=>$('sidebar').classList.toggle('open'));
  $('viewDemoInfo').addEventListener('click',()=>toast('This starter uses local sample data; no live YouTube API is connected.'));
  $('helpBtn').addEventListener('click',()=>toast('100% self-hostable starter. All analytics shown as samples unless you connect approved APIs.'));
  function spark(el){const vals=el.dataset.spark.split(',').map(Number),col={purple:'#9E83FF',blue:'#57CCFC',lime:'#B8FF65',pink:'#FC83BE'}[el.dataset.color];const xStep=90/(vals.length-1),min=Math.min(...vals),max=Math.max(...vals);const pts=vals.map((v,i)=>`${i*xStep},${24-((v-min)/(max-min||1))*20}`).join(' ');el.innerHTML=`<svg viewBox="0 0 91 29" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;}
  document.querySelectorAll('.stat-sparkline').forEach(spark);
  function persistTracked(){try{localStorage.setItem(trackedKey,JSON.stringify(tracked));}catch(_){toast('Could not save locally in this browser.');}}
  function syncCount(){ $('trackedCount').textContent=String(21+tracked.length); }
  function renderTracked(){const tbody=$('trackedRows');tbody.innerHTML=tracked.length?tracked.map((name,i)=>`<tr><td><strong>${escapeHtml(name)}</strong><span class="subline">Added on this device</span></td><td>Local browser</td><td><span class="score-pill medium">Not checked</span></td><td>—</td><td><button class="small-action" data-remove="${i}" aria-label="Remove ${escapeHtml(name)}">Remove</button></td></tr>`).join(''):'<tr><td class="empty-row" colspan="5">No tracked keywords yet. Add your first keyword above.</td></tr>';tbody.querySelectorAll('[data-remove]').forEach(b=>b.addEventListener('click',()=>{tracked.splice(Number(b.dataset.remove),1);persistTracked();renderTracked();renderKeywords();toast('Keyword removed.');}));syncCount();}
  function addTracked(term){const v=term.trim().replace(/\s+/g,' ');if(!v){toast('Enter a keyword first.');return;}if(v.length>120){toast('Please use a shorter keyword.');return;}if(tracked.some(t=>t.toLocaleLowerCase()===v.toLocaleLowerCase())){toast('Keyword already tracked.');return;}tracked.push(v);persistTracked();renderTracked();renderKeywords();toast('Keyword saved locally. No live rank checking yet.');}
  $('addTrackBtn').addEventListener('click',() => {addTracked($('trackInput').value);$('trackInput').value='';});
  $('trackInput').addEventListener('keydown',e=>{if(e.key==='Enter'){$('addTrackBtn').click();}});
  function renderKeywords(){const q=$('keywordInput').value.trim().toLocaleLowerCase(),sort=$('keywordSort').value;const filtered=sampleKeywords.filter(([name, , , , category])=>!q||name.toLocaleLowerCase().includes(q)||category.toLocaleLowerCase().includes(q)||q.split(' ').some(w=>w.length>3&&name.toLocaleLowerCase().includes(w))).sort((a,b)=>sort==='demand'?b[1]-a[1]:sort==='competition'?a[2]-b[2]:b[3]-a[3]);$('keywordResultsCount').textContent=`${filtered.length} matching sample keyword${filtered.length===1?'':'s'}`;$('keywordRows').innerHTML=filtered.length?filtered.map(([name,demand,competition,score,category])=>`<tr><td><strong>${escapeHtml(name)}</strong><span class="subline">${escapeHtml(category)} · Sample</span></td><td><div class="demand-bar"><i style="width:${demand}%"></i></div><span class="subline">${demand}/100 (proxy)</span></td><td>${competition<40?'Low':competition<65?'Medium':'High'} <span class="subline">${competition}/100 (proxy)</span></td><td><span class="score-pill ${score<80?'medium':''}">${score}/100</span></td><td><button class="small-action" data-track="${escapeHtml(name)}">${tracked.some(v=>v.toLowerCase()===name.toLowerCase())?'Saved':'Track +'}</button></td></tr>`).join(''):'<tr><td class="empty-row" colspan="5">No keyword in the local demo dataset. Try “youtube”, “video”, “AI”, or “Hindi”.</td></tr>';
    document.querySelectorAll('[data-track]').forEach(b=>b.addEventListener('click',()=>addTracked(b.dataset.track)));
  }
  $('searchKeywords').addEventListener('click',renderKeywords);$('keywordInput').addEventListener('keydown',e=>{if(e.key==='Enter')renderKeywords();});$('keywordSort').addEventListener('change',renderKeywords);
  $('titleInput').addEventListener('input',()=>{$('charCount').textContent=`${$('titleInput').value.length} characters`;});
  function analyzeTitle(title,focus){const words=title.trim().split(/\s+/).filter(Boolean),length=title.trim().length;let score=0;let checks=[];function check(ok,label,description,points){if(ok)score+=points;checks.push({ok,label,description});}check(length>=40&&length<=70,'Title length',length>=40&&length<=70?'Within the recommended 40–70 character range.':`Current length ${length}. Aim for around 40–70 characters.`,25);check(words.length>=6&&words.length<=12,'Clear and specific',words.length>=6&&words.length<=12?'A readable number of words.':'Try 6–12 words to communicate one clear idea.',15);check(/\b(how|why|best|guide|tips|learn|easy|top|क्या|कैसे|क्यों|बेहतर)\b/i.test(title)||/\d/.test(title),'Compelling angle','Questions, guides, or specific numbers often improve clarity.',20);check(!(/[!?.]{2,}/.test(title)||title===title.toUpperCase()&&/[a-zA-Z]/.test(title)),'Natural formatting','Avoid excessive punctuation and all-caps shouting.',15);check(!focus||title.toLocaleLowerCase().includes(focus.toLocaleLowerCase()),'Focus keyword',focus?`Include “${focus}” naturally when relevant.`:'No focus keyword provided; this check is neutral.',15);check(length>0&&!/^(test|video|title)$/i.test(title.trim()),'Meaningful message','The title should explain the benefit or topic.',10);return {score,checks};}
  $('analyzeBtn').addEventListener('click',()=>{const title=$('titleInput').value.trim(),focus=$('focusKeyword').value.trim();if(!title){toast('Please enter a video title to analyze.');$('titleInput').focus();return;}const {score,checks}=analyzeTitle(title,focus);$('titleScore').textContent=score;$('scoreStatus').textContent=score>=80?'Strong foundation':score>=55?'Good start':'Needs improvement';$('scoreExplanation').textContent=score>=80?'The title passes most of the local writing checks.':score>=55?'A few refinements could improve readability.':'Use the checklist below to make the idea more specific and readable.';$('analyzerChecks').innerHTML=checks.map(c=>`<div class="check"><span class="check-icon ${c.ok?'':'warn'}">${c.ok?'✓':'!'}</span><div><b>${escapeHtml(c.label)}</b><p>${escapeHtml(c.description)}</p></div></div>`).join('');const ring=document.querySelector('.score-gauge');ring.style.background=`conic-gradient(${score>=80?'#B8FF65':score>=55?'#8D6AFF':'#F9BB78'} 0 ${Math.round(score*3.6)}deg,#313A54 ${Math.round(score*3.6)}deg 360deg)`;});
  renderTracked();renderKeywords();
})();
