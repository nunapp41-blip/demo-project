// Manifest V3 service worker: stores no API secrets. Calls only local API.
chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
  if(message?.type!=='CP_GET_SCORECARD')return false;
  if(typeof message.videoId!=='string'||! /^[A-Za-z0-9_-]{11}$/.test(message.videoId)){
    respond({ok:false,error:'Invalid video ID.'});return false;
  }
  fetch('http://127.0.0.1:8787/v1/videos/'+encodeURIComponent(message.videoId)+'/scorecard')
    .then(async res=>{const result=await res.json();if(!res.ok)throw Error(result.error?.message||'Unable to fetch scorecard');return result.data;})
    .then(data=>respond({ok:true,data}))
    .catch(e=>respond({ok:false,error:e.message}));
  return true;
});
