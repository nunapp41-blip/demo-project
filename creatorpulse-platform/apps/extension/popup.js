const $=id=>document.getElementById(id);
function tell(text){$('status').textContent=text}
function ask(message){return new Promise(resolve=>chrome.runtime.sendMessage(message,response=>resolve(response||{ok:false,error:chrome.runtime.lastError?.message||'No response'})))}
async function status(){const r=await ask({type:'CP_STATUS'});tell(r.ok?(r.connected?'Connected to your private CreatorPulse account.':'Not connected. Open Settings to get your code.'):r.error)}
$('connect').onclick=async()=>{const code=$('code').value.trim();const r=await ask({type:'CP_CONNECT',code});tell(r.ok?'Successfully connected. Open a YouTube watch page to see stats.':r.error);$('code').value=''};
$('disconnect').onclick=async()=>{const r=await ask({type:'CP_DISCONNECT'});tell(r.ok?'Signed out from extension.':r.error)};
status();
