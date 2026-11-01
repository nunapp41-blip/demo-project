/* CreatorPulse self-hosted MV3 extension: private/local API, isolated Shadow DOM UI. */
(()=>{
  let host=null,currentId=null;
  const css=`*{box-sizing:border-box}#box{width:292px;padding:16px;border:1px solid #805BFF77;border-radius:16px;background:linear-gradient(148deg,#19213d,#0c1020);box-shadow:0 15px 55px #0009;color:#f7f9ff;font:13px/1.5 system-ui,sans-serif}header{display:flex;justify-content:space-between;gap:6px;align-items:center;border-bottom:1px solid #394560;padding-bottom:10px}header strong{font-size:16px}header span{color:#B8FF65}#close{background:transparent;border:0;color:#a9b5cc;font-size:21px;cursor:pointer}#data{padding-top:12px}h3{font-size:13px;margin:8px 0;color:#c5d0e9}b{font-size:19px;color:#B8FF65}.row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #29344c}.meta{font-size:11px;color:#a1aeca;margin-top:12px}a{color:#38BDF8}`;
  function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\"':'&quot;'}[c]));}
  function getId(){if(location.pathname!=='/watch')return null;const v=new URLSearchParams(location.search).get('v');return v&&/^[A-Za-z0-9_-]{11}$/.test(v)?v:null;}
  function inject(id){host?.remove();host=document.createElement('div');host.id='creatorpulse-overlay';host.style.cssText='position:fixed;right:18px;bottom:18px;z-index:2147483640';const root=host.attachShadow({mode:'open'});
    root.innerHTML=`<style>${css}</style><div id="box"><header><strong>◉ Creator<span>Pulse</span></strong><button id="close" aria-label="Close">×</button></header><div id="data"><div class="meta">Loading public YouTube statistics from CreatorPulse...</div></div></div>`;root.getElementById('close').onclick=()=>host.remove();document.body.appendChild(host);
    chrome.runtime.sendMessage({type:'CP_GET_SCORECARD',videoId:id},r=>{
      if(!host?.isConnected||id!==currentId)return;
      const content=root.getElementById('data');
      if(chrome.runtime.lastError||!r?.ok){content.innerHTML=`<h3>Connect to CreatorPulse</h3><div class="meta">${esc(r?.error||'Sign in to CreatorPulse and connect the extension to load real public video data.')} No fabricated live metrics are displayed.</div>`;return;}
      const d=r.data;
      content.innerHTML=`<h3>${esc(d.title)}</h3><div class="row"><span>Views</span><b>${d.views==null?'—':Number(d.views).toLocaleString()}</b></div><div class="row"><span>Snapshot VPH</span><b>${d.vph===null?'—':Number(d.vph).toLocaleString()}</b></div><div class="row"><span>Outlier (estimated)</span><b>${d.outlierScore===null?'—':d.outlierScore+'×'}</b></div><div class="row"><span>Engagement</span><b>${d.engagementRate===null?'—':d.engagementRate+'%'}</b></div><div class="meta">YouTube Data API · Estimates marked · No private data or scraping</div>`;
    });
  }
  function mount(){const id=getId();if(!id){host?.remove();host=null;currentId=null;return;}if(id===currentId&&host?.isConnected)return;currentId=id;inject(id);}
  document.addEventListener('yt-navigate-finish',()=>setTimeout(mount,150));window.addEventListener('popstate',()=>setTimeout(mount,150));
  const observer=new MutationObserver(()=>{if(getId()!==currentId)mount();});observer.observe(document.documentElement,{childList:true,subtree:true});mount();
})();
