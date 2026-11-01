/* MV3 service-worker: creator token is only stored in extension local storage, never in content scripts. */
const API='http://127.0.0.1:8787';
chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
  (async()=>{
    if(message?.type==='CP_CONNECT'){
      if(!/^[A-Za-z0-9_-]{18,40}$/.test(String(message.code||'')))throw Error('Invalid or expired connection code.');
      const response=await fetch(API+'/v1/extension/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:message.code})});
      const result=await response.json();if(!response.ok)throw Error(result.error?.message||'Connection failed.');
      await chrome.storage.local.set({creatorpulseAccessToken:result.data.token});return {connected:true};
    }
    if(message?.type==='CP_DISCONNECT'){await chrome.storage.local.remove('creatorpulseAccessToken');return {connected:false};}
    if(message?.type==='CP_STATUS'){const {creatorpulseAccessToken}=await chrome.storage.local.get('creatorpulseAccessToken');return {connected:!!creatorpulseAccessToken};}
    if(message?.type==='CP_GET_SCORECARD'){
      if(!/^[A-Za-z0-9_-]{11}$/.test(String(message.videoId||'')))throw Error('Invalid YouTube video ID.');
      const {creatorpulseAccessToken}=await chrome.storage.local.get('creatorpulseAccessToken');
      const headers=creatorpulseAccessToken?{authorization:'Bearer '+creatorpulseAccessToken}:{};
      const response=await fetch(API+'/v1/videos/'+encodeURIComponent(message.videoId)+'/scorecard',{headers});const result=await response.json();if(!response.ok)throw Error(result.error?.message||'Could not fetch video scorecard.');return {data:result.data};
    }
    throw Error('Unknown request.');
  })().then(data=>respond({ok:true,...data})).catch(e=>respond({ok:false,error:e.message}));
  return true;
});
