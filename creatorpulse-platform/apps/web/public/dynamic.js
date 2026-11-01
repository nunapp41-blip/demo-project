(()=>{'use strict';
  const el=id=>document.getElementById(id);
  const para=(target,text,cls)=>{const p=document.createElement('p');p.textContent=String(text);if(cls)p.className=cls;target.append(p);return p;};
  const anchor=(target,href,text)=>{const a=document.createElement('a');a.href=href;a.textContent=text;a.rel='noopener noreferrer';a.target='_blank';target.append(a);return a;};
  const reset=id=>{const node=el(id);node.replaceChildren();return node;};
  const videoId=text=>{const raw=text.trim();if(/^[\w-]{11}$/.test(raw))return raw;try{const u=new URL(raw);if(!['youtube.com','www.youtube.com','m.youtube.com','youtu.be','www.youtu.be','youtube-nocookie.com','www.youtube-nocookie.com'].includes(u.hostname))return null;const m=u.hostname.includes('youtu.be')?u.pathname.split('/')[1]:u.searchParams.get('v')||u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/)?.[1];return /^[\w-]{11}$/.test(m||'')?m:null;}catch{return null;}};
  const channelId=text=>(text.match(/UC[A-Za-z0-9_-]{22}/)||[])[0]||null;
  const fetchData=async path=>{const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),16500);try{const r=await fetch(path,{cache:'no-store',signal:controller.signal});const result=await r.json();if(!r.ok)throw Error(result.error?.message||'Backend HTTP '+r.status);return result.data;}finally{clearTimeout(timeout);}};
  const busy=(form,on)=>{form.querySelector('button[type=submit]').disabled=on;};
  const stamp=(out,date)=>para(out,'Checked '+(date?new Date(date).toLocaleString():'not available'),'cp-result-date');
  el('cp-quick-video')?.addEventListener('submit',async event=>{
    event.preventDefault();const f=event.currentTarget,out=reset('cp-video-result'),id=videoId(el('cpVideo').value);
    if(!id){para(out,'Enter a valid public YouTube URL or 11-character video ID.','cp-error');return;}
    busy(f,true);para(out,'Fetching public title and channel…');
    try{const d=await fetchData('/v1/public/video/'+id+'/metadata');out.replaceChildren();para(out,'REAL PUBLIC METADATA','cp-good');para(out,d.title||'Untitled','cp-result-title');para(out,'Channel: '+(d.channel||'Unknown'));anchor(out,'https://www.youtube.com/watch?v='+id,'Watch video ↗');stamp(out,d.fetchedAt);para(out,'Views, likes and comments require an official YouTube Data API key.');anchor(out,'./realtime.html','Open official statistics lookup ↗');}
    catch(e){out.replaceChildren();para(out,'Could not load metadata: '+e.message,'cp-error');anchor(out,'https://www.youtube.com/watch?v='+id,'Open public video on YouTube ↗');}finally{busy(f,false);}
  });
  el('cp-quick-channel')?.addEventListener('submit',async event=>{
    event.preventDefault();const f=event.currentTarget,out=reset('cp-channel-result'),id=channelId(el('cpChannel').value),filter=el('cpChannelFilter').value.trim();
    if(!id){
      const query=el('cpChannel').value.trim();if(query.length<2){para(out,'Enter a channel name, @handle, or UC… channel ID.','cp-error');return;}
      busy(f,true);para(out,'Searching official YouTube channel data…');
      try{const d=await fetchData('/v1/public/channels/search?q='+encodeURIComponent(query));out.replaceChildren();para(out,'OFFICIAL CHANNEL SEARCH','cp-good');
        for(const c of d.results){const item=document.createElement('div');anchor(item,'https://www.youtube.com/channel/'+c.channelId,c.title);para(item,'Channel ID: '+c.channelId);const format=v=>v==null?'UNAVAILABLE':Number(v).toLocaleString();para(item,'Subscribers: '+format(c.subscribers)+' · Views: '+format(c.views)+' · Videos: '+format(c.videoCount));out.append(item);}
        if(!d.results.length)para(out,'No matching public channels returned.');para(out,d.note);stamp(out,d.checkedAt);
      }catch(e){out.replaceChildren();para(out,'Channel search unavailable: '+e.message,'cp-error');}finally{busy(f,false);}return;
    }busy(f,true);para(out,'Fetching latest public uploads…');
    try{const d=await fetchData('/v1/public/channel/'+id+'/uploads'+(filter?'?q='+encodeURIComponent(filter):''));out.replaceChildren();para(out,d.channelTitle||id,'cp-good');para(out,d.results.length+' matching recent uploads · '+(d.stale?'STALE CACHE':'PUBLIC FEED'));const ul=document.createElement('ul');for(const v of d.results.slice(0,15)){const li=document.createElement('li');anchor(li,'https://www.youtube.com/watch?v='+v.videoId,v.title||v.videoId);para(li,'Published: '+(v.publishedAt||'UNAVAILABLE')+' · Views: '+(v.views==null?'UNAVAILABLE':Number(v.views).toLocaleString()),'cp-result-date');ul.append(li);}out.append(ul);if(!d.results.length)para(out,'No matching titles in the recent public feed. This is not a full channel archive.');stamp(out,d.checkedAt);}
    catch(e){out.replaceChildren();para(out,'Public feed unavailable: '+e.message,'cp-error');anchor(out,'https://www.youtube.com/channel/'+id+'/videos','Open channel on YouTube ↗');}finally{busy(f,false);}
  });
  el('cp-quick-keyword')?.addEventListener('submit',async event=>{
    event.preventDefault();const f=event.currentTarget,out=reset('cp-keyword-result'),q=el('cpKeyword').value.trim(),region=el('cpRegion').value;
    if(q.length<2){para(out,'Please enter a keyword (at least 2 characters).','cp-error');return;}
    busy(f,true);para(out,'Checking official public search…');
    const fallback='https://www.youtube.com/results?search_query='+encodeURIComponent(q);
    try{const d=await fetchData('/v1/public/search?q='+encodeURIComponent(q)+'&region='+encodeURIComponent(region));out.replaceChildren();para(out,'OFFICIAL API SEARCH SNAPSHOT · '+d.region,'cp-good');const ul=document.createElement('ul');for(const v of (d.results||[]).slice(0,20)){const li=document.createElement('li');anchor(li,'https://www.youtube.com/watch?v='+v.videoId,(v.title||v.videoId)+' · '+(v.channelTitle||''));ul.append(li);}out.append(ul);stamp(out,d.checkedAt);if(!d.results.length)para(out,'No results returned by the official API.');}
    catch(e){out.replaceChildren();para(out,'In-app Google search unavailable: '+e.message,'cp-error');para(out,'Open current public search results on YouTube instead:');anchor(out,fallback,'Search “'+q+'” on YouTube ↗');para(out,'This fallback opens YouTube. It does not provide in-app analytics.');}
    finally{busy(f,false);}
  });
})();
