/* MV3 service worker: public CreatorPulse data only, with no user tokens or sign-in. */
const API='https://creatorpulse-open-source-app.onrender.com';
chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
  (async()=>{
    if(message?.type==='CP_STATUS')return {mode:'public',connected:false};
    if(message?.type==='CP_GET_SCORECARD'){
      if(!/^[A-Za-z0-9_-]{11}$/.test(String(message.videoId||'')))throw Error('Invalid YouTube video ID.');
      const response=await fetch(API+'/v1/public/video/'+encodeURIComponent(message.videoId)+'/stats');const result=await response.json();if(!response.ok)throw Error(result.error?.message||'Could not fetch public video statistics.');return {data:result.data};
    }
    throw Error('Unknown request.');
  })().then(data=>respond({ok:true,...data})).catch(e=>respond({ok:false,error:e.message}));
  return true;
});
