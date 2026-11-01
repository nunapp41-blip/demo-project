/** Transparent estimates, NOT ranking predictions or true search volumes. */
export function titleScore(title,focus='') {
  title=String(title??'').trim();focus=String(focus??'').trim();
  const words=title.split(/\s+/).filter(Boolean),length=title.length;
  let score=0;
  const checks=[];
  function award(condition,points,key){checks.push({key,passed:condition,points});if(condition)score+=points;}
  award(length>=40 && length<=70,25,'length');
  award(words.length>=6 && words.length<=12,15,'clarity');
  award(/\b(how|why|best|guide|tips|learn|easy|top)\b/i.test(title)||/\d/.test(title)||/(कैसे|क्यों|क्या)/.test(title),20,'angle');
  award(!(/[!?.]{2,}/.test(title) || (/[A-Z]/.test(title)&& title===title.toUpperCase())),15,'format');
  award(!focus||title.toLocaleLowerCase().includes(focus.toLocaleLowerCase()),15,'keyword');
  award(length>0&&!/^(test|video|title)$/i.test(title),10,'meaning');
  return {score,checks,method:'transparent_rule_based',isPrediction:false};
}
export function viewsPerHour(views,publishedAt,now=Date.now()){
  const hours=(now-new Date(publishedAt).getTime())/3600000;
  return Number.isFinite(hours)&&hours>0?Math.round(Number(views)/Math.max(1,hours)):null;
}
export function outlierScore(views,baseline){return baseline>0?Number((views/baseline).toFixed(2)):null;}
export function engagementRate(likes,comments,views){return views>0?Number((100*(Number(likes)+Number(comments))/Number(views)).toFixed(2)):null;}
export function median(values){const v=values.filter(x=>Number.isFinite(x)).sort((a,b)=>a-b);return !v.length?null:v.length%2?v[(v.length-1)/2]:(v[v.length/2-1]+v[v.length/2])/2;}
