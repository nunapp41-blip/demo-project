/** Official Google OAuth, owner-only retention and optional Stripe/Razorpay hosted billing. */
import {createHmac,timingSafeEqual} from 'node:crypto';
import {ApiError,isVideoId} from './youtube.mjs';
const scopes=['https://www.googleapis.com/auth/youtube.readonly','https://www.googleapis.com/auth/yt-analytics.readonly'];
const googleReady=()=>Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET&&process.env.GOOGLE_REDIRECT_URI&&process.env.ENCRYPTION_SECRET);
export function googleStatus(accounts,userId){return {configured:googleReady(),connected:!!accounts.googleToken(userId),ownerOnly:true};}
export function googleAuthorizationUrl(accounts,userId){
  if(!googleReady())throw new ApiError(503,'GOOGLE_NOT_CONFIGURED','Google OAuth client and encryption secret must be configured by the project owner.');
  const q=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:process.env.GOOGLE_REDIRECT_URI,response_type:'code',scope:scopes.join(' '),access_type:'offline',include_granted_scopes:'true',prompt:'consent',state:accounts.state(userId)});
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}
async function googleTokenExchange(params){
  const body=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,...params});
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(15000)});
  const d=await r.json().catch(()=>({}));if(!r.ok)throw new ApiError(502,'GOOGLE_TOKEN_ERROR',d.error_description||'Google token exchange failed.');return d;
}
export async function googleCallback(accounts,state,code){if(!googleReady())throw new ApiError(503,'GOOGLE_NOT_CONFIGURED','Google OAuth not configured.');const userId=accounts.redeemState(state);if(!code)throw new ApiError(400,'GOOGLE_CODE_MISSING','Google authorization was not granted.');const data=await googleTokenExchange({code,redirect_uri:process.env.GOOGLE_REDIRECT_URI,grant_type:'authorization_code'});if(!data.refresh_token)throw new ApiError(502,'GOOGLE_REFRESH_TOKEN_MISSING','Google did not return offline authorization; please reconnect.');accounts.connectGoogle(userId,data.refresh_token);return userId;}
export async function retentionReport(accounts,userId,videoId,startDate,endDate){
  if(!isVideoId(videoId))throw new ApiError(400,'BAD_VIDEO_ID','Enter a valid 11-character video ID.');
  const refreshToken=accounts.googleToken(userId);if(!refreshToken)throw new ApiError(401,'GOOGLE_NOT_CONNECTED','Connect your own YouTube channel first.');
  const token=await googleTokenExchange({refresh_token:refreshToken,grant_type:'refresh_token'});
  const end=endDate||new Date(Date.now()-2*86400e3).toISOString().slice(0,10);
  const start=startDate||'2020-01-01';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end)throw new ApiError(400,'INVALID_RANGE','Use a valid startDate and endDate (YYYY-MM-DD).');
  const params=new URLSearchParams({ids:'channel==MINE',startDate:start,endDate:end,metrics:'audienceWatchRatio',dimensions:'elapsedVideoTimeRatio',filters:`video==${videoId}`,sort:'elapsedVideoTimeRatio'});
  const r=await fetch('https://youtubeanalytics.googleapis.com/v2/reports?'+params,{headers:{authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(20000)});
  const data=await r.json().catch(()=>({}));if(!r.ok)throw new ApiError(r.status===403?403:502,'ANALYTICS_ERROR',data.error?.message||'YouTube Analytics report unavailable. Check that this video belongs to your connected channel.');
  const points=(data.rows||[]).map(row=>({elapsedRatio:Number(row[0]),audienceWatchRatio:Number(row[1])})).filter(x=>Number.isFinite(x.elapsedRatio)&&Number.isFinite(x.audienceWatchRatio));
  const drops=points.slice(1).map((x,i)=>({elapsedRatio:x.elapsedRatio,drop:points[i].audienceWatchRatio-x.audienceWatchRatio})).filter(x=>x.drop>0).sort((a,b)=>b.drop-a.drop).slice(0,3);
  accounts.event(userId,'retention_report');
  return {videoId,startDate:start,endDate:end,points,largestDrops:drops,source:'youtube_analytics_api',isOwnChannelOnly:true,transcript:null,notes:'Retention from your authorized channel only. Transcript is not available through this endpoint; no transcript lines are fabricated.'};
}
function signatureEquals(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);}
export function verifyStripeSignature(raw,header,secret,now=Date.now()){
  if(!secret||!header)throw new ApiError(400,'BAD_SIGNATURE','Missing signed Stripe webhook.');
  const fields=Object.fromEntries(header.split(',').map(x=>x.split('=',2)));
  const timestamp=Number(fields.t);if(!Number.isFinite(timestamp)||Math.abs(now/1000-timestamp)>300)throw new ApiError(400,'STALE_SIGNATURE','Stripe timestamp outside acceptable window.');
  const actual=createHmac('sha256',secret).update(`${fields.t}.${raw}`).digest('hex');
  if(!signatureEquals(fields.v1,actual))throw new ApiError(400,'BAD_SIGNATURE','Invalid Stripe webhook signature.');
  return JSON.parse(raw);
}
export async function stripeCheckout(accounts,userId,plan,origin){
  const key=process.env.STRIPE_SECRET_KEY,price=plan==='creator'?process.env.STRIPE_PRICE_CREATOR:plan==='agency'?process.env.STRIPE_PRICE_AGENCY:null;
  if(!key||!price)throw new ApiError(503,'BILLING_NOT_CONFIGURED','Stripe keys and plan prices are not configured.');
  const user=accounts.publicUser(userId);const body=new URLSearchParams({'mode':'subscription','line_items[0][price]':price,'line_items[0][quantity]':'1','client_reference_id':userId,'customer_email':user.email,'metadata[userId]':userId,'metadata[plan]':plan,'success_url':origin+'/#settings?payment=success','cancel_url':origin+'/#settings?payment=cancelled'});
  const r=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(12000)});
  const result=await r.json().catch(()=>({}));if(!r.ok)throw new ApiError(502,'STRIPE_ERROR',result.error?.message||'Could not open checkout.');return {url:result.url};
}
export function handleStripeEvent(accounts,event){
  if(!event?.id||accounts.hasWebhookEvent(event.id))return {processed:false};
  const item=event.data?.object;const userId=item?.client_reference_id||item?.metadata?.userId;
  // Only an authenticated subscription checkout completion can activate a plan. Pending/failed checkout does not upgrade.
  if(event.type==='checkout.session.completed'&&item?.payment_status!=='unpaid'&&item?.mode==='subscription'&&accounts.publicUser(userId)){
    const plan=item?.metadata?.plan; // metadata was set by the server when the signed Stripe checkout session was created
    if(plan)accounts.updatePlan(userId,plan);
  }
  accounts.recordWebhookEvent(event.id,'stripe');return {processed:true};
}
export function verifyRazorpayWebhook(raw,signature,secret){if(!secret)throw new ApiError(503,'BILLING_NOT_CONFIGURED','Razorpay webhook secret is not configured.');const digest=createHmac('sha256',secret).update(raw).digest('hex');if(!signatureEquals(signature,digest))throw new ApiError(400,'BAD_SIGNATURE','Invalid Razorpay webhook signature.');return JSON.parse(raw);}
