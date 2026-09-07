// Real Chromium + real grading modules; every service is intercepted, no production writes.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const {chromium}=require('C:/Users/QwQ/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(e,b)=>{if(e){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':'application/javascript; charset=utf-8');res.end(b);});
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0;
function ok(v,n){assert.ok(v,n);console.log('PASS '+(++pass)+' '+n);}
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
    const errors=[],posts=[];page.on('pageerror',e=>errors.push(e.message));
    let semanticDelay=80,visionFail=false,fillFail=false,extractEmpty=false,semanticFail=false,transcribeCount=0,visionCount=0;
    let transcript='';
    await page.route('**/*',async route=>{
      const req=route.request(),url=req.url();
      if(url.includes('/api/') || url.includes('/semantic-judge')){
        const body=req.method()==='POST' && (req.headers()['content-type']||'').includes('json') ? req.postDataJSON() : null;
        posts.push({url,body});
        let data={ok:true,written:1,total:1,fieldsWritten:10};
        if(url.includes('health'))return route.fulfill({status:500,body:'broken'});
        if(url.includes('semantic-judge')){
          await sleep(semanticDelay);
          data={ok:true,evidences:(body.judges||[]).flatMap(j=>j.points.map(p=>({stdId:j.id,subId:p.id,state:'PASS',confidence:1,quote:'展示证据',quoteTs:'00:00:01',reason:'mock'})))};
          if(semanticFail)data={ok:false,error:'mock semantic unavailable'};
        }
        if(url.includes('/transcribe')){transcribeCount++;data={ok:true,srt:transcript};}
        if(url.includes('/extract'))data={ok:true,frames:extractEmpty?[]:[{file:'mock-frame',tsSec:1}]};
        if(url.includes('/vision')){visionCount++;data=visionFail?{ok:false,error:'mock vision unavailable'}:{ok:true,desc:'低饱和 简洁 利落 干净 通勤 自然妆容 整洁'};}
        if(url.includes('feishu-fill') && fillFail)data={ok:false,error:'mock sync failed'};
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
      }
      if(!url.startsWith(origin))return route.abort();
      return route.continue();
    });
    await page.goto(origin+'/v4/index.html');
    await page.waitForFunction(()=>window.V4Jobs);
    await page.evaluate(()=>loadSample());
    transcript=await page.evaluate(()=>document.getElementById('fileInput').files[0].text());
    await page.evaluate(()=>{location.hash='#/daily';document.getElementById('hostInput').value='手动主播';});
    await page.click('#runBtn');
    await page.waitForFunction(()=>V4Jobs.getJob('daily').state!=='running');
    const first=await page.evaluate(()=>({state:V4Jobs.getJob('daily').state,msg:V4Jobs.getJob('daily').message,host:LAST_RESULT && LAST_RESULT.host,history:getHistoryLib().length}));
    ok(first.state==='done' && first.host==='手动主播' && first.history===1,'text scoring commits once and manual host wins '+JSON.stringify(first));
    ok(await page.evaluate(()=>LAST_RESULT.__sem.used),'semantic awaited before final report');
    const downloadPromise=page.waitForEvent('download');await page.evaluate(()=>exportReport('json'));
    const download=await downloadPromise;const json=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
    ok(json.host==='手动主播' && !json.__semCtx,'JSON export is valid and excludes internal job data');
    ok(await page.evaluate(()=>mergeDaily([{'主播':'A','日期':'2026-09-07',score:90}],[{'主播':'A','日期':'2026-09-07',score:60}])[0].score===90),'new local result wins over undated snapshot');
    await page.waitForFunction(()=>document.getElementById('svc-asr-txt').textContent.includes('未启动'));
    ok(await page.locator('#svc-asr-txt').textContent()!=='已连接','HTTP 500 is not healthy');
    ok(await page.evaluate(()=>{var r={host:'A',product:'P',total:66,modules:[],__historyBaseline:[{host:'A',product:'P',total:60}]};return checkTop1Criteria(r,[r]).some(x=>x.k==='h2');}),'history improvement uses frozen baseline');
    // Responses can complete out of order; late result must not alter the selected table.
    ok(await page.evaluate(async()=>{
      const orig=v4FsEnsure,local=V4_FS_LOCAL_KEY;V4_FS_LOCAL_KEY={};let done={};
      v4FsEnsure=k=>new Promise(r=>done[k]=r);
      const a=v4FeishuLoad('daily'),b=v4FeishuLoad('month');
      done.month({ok:true,rows:[{source:'month'}],columns:['source']});await b;
      done.daily({ok:true,rows:[{source:'daily'}],columns:['source']});await a;
      const result=V4_FS_STATE.key==='month' && V4_FS_STATE.rows[0].source==='month';v4FsEnsure=orig;V4_FS_LOCAL_KEY=local;return result;
    }),'late table response discarded');
    // Cancel A and start B while A's mock service still works.
    semanticDelay=450;
    await page.evaluate(()=>{document.getElementById('hostInput').value='取消A';run();run();});
    await sleep(50);await page.evaluate(()=>{V4Jobs.cancel('daily');document.getElementById('hostInput').value='保留B';run();});
    await page.waitForFunction(()=>V4Jobs.getJob('daily').state!=='running');await sleep(500);
    ok(await page.evaluate(()=>LAST_RESULT.host==='保留B' && !getHistoryLib().some(x=>x.host==='取消A')),'cancelled/stale job cannot render or persist');
    // Batch: no provisional winner, each result committed once.
    const beforeTop=posts.filter(x=>x.body && x.body.top1).length;
    await page.setInputFiles('#batchInput',[
      {name:'甲.txt',mimeType:'text/plain',buffer:Buffer.from(transcript)},
      {name:'乙.txt',mimeType:'text/plain',buffer:Buffer.from(transcript)}]);
    await page.evaluate(()=>{location.hash='#/batch';batchRun();});
    await sleep(80);ok(posts.filter(x=>x.body && x.body.top1).length===beforeTop,'TOP1 withheld while semantic grading is pending');
    await page.waitForFunction(()=>V4Jobs.getJob('batch').state!=='running');
    ok(await page.evaluate(()=>V4Jobs.getJob('batch').state==='done' && V4Jobs.getJob('batch').rows.every(x=>x.result.__semDone)),'batch settles only after every semantic result');
    await page.waitForFunction(()=>document.getElementById('job-sync-list').textContent.includes('TOP1'));
    ok(await page.evaluate(()=>document.getElementById('batchCompare').style.display!=='none' && LAST_RESULT.host==='保留B'),'batch does not replace daily display/export selection');
    // Vision failure yields no scored report, retry uses cached transcription.
    visionFail=true;
    await page.setInputFiles('#visionVideoInput',{name:'日报.mp4',mimeType:'video/mp4',buffer:Buffer.from('mock')});
    await page.evaluate(()=>{document.getElementById('visionHostInput').value='完整日报主播';document.getElementById('visionProduct').value=document.getElementById('productSelect').value;autoFullReport();});
    await page.waitForFunction(()=>V4Jobs.getJob('vision').state!=='running');
    ok(await page.evaluate(()=>V4Jobs.getJob('vision').state==='failed' && !V4Jobs.getJob('vision').result),'failed vision is not a completed scored report');
    const trCount=transcribeCount;visionFail=false;
    await page.evaluate(()=>V4Jobs.retry('vision'));
    await page.waitForFunction(()=>V4Jobs.getJob('vision').state!=='running');
    const vr=await page.evaluate(()=>{const j=V4Jobs.getJob('vision');return {state:j.state,msg:j.message,r:j.result && {total:j.result.total,display:j.result.fullDaily.total,type:j.result.scoreType},h:getHistoryLib().find(x=>x.host==='完整日报主播')};});
    ok(vr.state==='done' && vr.r.total===vr.r.display && vr.h.total===vr.r.total,'full daily display and persisted total match '+JSON.stringify(vr));
    ok(transcribeCount===trCount,'vision retry reuses successful transcription');
    ok(await page.evaluate(()=>{const d=JSON.parse(localStorage.getItem('grading_detail_v1')).find(x=>x.host==='完整日报主播');return d.fullDaily.total===d.total && v4DetailHTML(d).includes('服化道与品牌适配');}),'historical full daily preserves its own scoring breakdown');
    ok(await page.evaluate(()=>runGrading(parseTranscript('测试'),'auto',{skipSemantic:true}).__semCtx===undefined && !window.V4SEM_EXEMPT),'semantic exemption is scoped to one call');
    // Sync order and visible retry: primary success is required before dependent tables.
    semanticDelay=20;fillFail=true;
    await page.evaluate(()=>{document.getElementById('hostInput').value='同步重试';run();});
    await page.waitForFunction(()=>V4Jobs.getJob('daily').state==='done');
    await page.waitForFunction(()=>document.getElementById('job-sync-list').textContent.includes('mock sync failed'));
    ok(!posts.some(x=>x.body && x.body.history && x.body.history.some(r=>r.host==='同步重试')),'dependent history not sent before primary write succeeds');
    fillFail=false;
    await page.locator('#job-sync-list .job-row').filter({hasText:'同步重试'}).getByRole('button').click();
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('#job-sync-list .job-row')).some(x=>x.textContent.includes('同步重试') && x.textContent.includes('已同步')));
    ok(posts.filter(x=>x.body && x.body.history && x.body.history.some(r=>r.host==='同步重试')).length===1,'sync retry does not resend completed steps');
    const primary=posts.findLastIndex(x=>x.body && x.body.host==='同步重试');
    const dependent=posts.findIndex(x=>x.body && x.body.history && x.body.history.some(r=>r.host==='同步重试'));
    ok(dependent>primary,'primary and dependent sync requests are ordered');
    semanticFail=true;
    await page.evaluate(()=>{document.getElementById('hostInput').value='降级验证';run();});
    await page.waitForFunction(()=>V4Jobs.getJob('daily').state==='done');
    ok(await page.evaluate(()=>LAST_RESULT.__sem.degraded && document.getElementById('job-daily').textContent.includes('已降级')),'semantic failure becomes explicit final fallback');
    semanticFail=false;
    // Simulate a server that returns headers immediately but stalls its JSON body.
    ok(await page.evaluate(async()=>{
      const orig=fetch;
      window.fetch=(url,opt)=>Promise.resolve({ok:true,json:()=>new Promise((resolve,reject)=>opt.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))))});
      try{await V4Jobs.request('/mock',{},null,25);return false;}catch(e){return e.message.includes('超时');}finally{window.fetch=orig;}
    }),'timeout covers response body, not only headers');
    // A failed batch item can be corrected/retried without recommitting successful peers.
    await page.setInputFiles('#batchInput',[
      {name:'重试甲.txt',mimeType:'text/plain',buffer:Buffer.from(transcript)},
      {name:'重试乙.txt',mimeType:'text/plain',buffer:Buffer.from('')}]);
    await page.evaluate(()=>batchRun());await page.waitForFunction(()=>V4Jobs.getJob('batch').state==='failed');
    ok(await page.locator('#batch-task-list input').last().isEnabled(),'failed batch metadata remains editable');
    const countBefore=await page.evaluate(()=>getHistoryLib().filter(x=>x.host==='重试甲').length);
    await page.evaluate(text=>{
      const row=V4Jobs.getJob('batch').rows.find(x=>x.state==='failed');row.file=new File([text],'重试乙.txt',{type:'text/plain'});V4Jobs.retry('batch');
    },transcript);
    await page.waitForFunction(()=>V4Jobs.getJob('batch').state==='done');
    ok(await page.evaluate(n=>getHistoryLib().filter(x=>x.host==='重试甲').length===n,countBefore),'batch retry keeps successful peers without duplicate history');
    extractEmpty=true;
    await page.evaluate(()=>autoFullReport());await page.waitForFunction(()=>V4Jobs.getJob('vision').state==='failed');
    ok(await page.evaluate(()=>!V4Jobs.getJob('vision').result && !V4Jobs.getJob('vision').cache.extraction),'zero frames cannot create report and invalid cache is cleared');
    extractEmpty=false;
    ok(await page.evaluate(()=>{
      localStorage.setItem('test_top1',[].toString() || '[]');
      localStorage.setItem('test_top1',JSON.stringify([{'日期':'2026-09-07','主播':'旧A'},{'日期':'2026-09-07','主播':'旧B'}]));
      v4FsUpsert('test_top1',{'日期':'2026-09-07','主播':'新冠军'},['日期']);
      const rows=JSON.parse(localStorage.getItem('test_top1'));localStorage.removeItem('test_top1');return rows.length===1 && rows[0]['主播']==='新冠军';
    }),'upsert collapses obsolete same-day TOP1 duplicates');
    await page.evaluate(()=>{
      window.originalSetItem=Storage.prototype.setItem;
      Storage.prototype.setItem=function(k,v){if(k==='grading_history_v1')throw new DOMException('quota exceeded','QuotaExceededError');return window.originalSetItem.call(this,k,v);};
      document.getElementById('hostInput').value='存储满验证';run();
    });
    await page.waitForFunction(()=>V4Jobs.getJob('daily').state==='done');
    ok(await page.evaluate(()=>document.getElementById('job-daily').textContent.includes('本地保存失败') && LAST_RESULT.host==='存储满验证'),'storage failure is visible and result remains exportable');
    await page.evaluate(()=>{Storage.prototype.setItem=window.originalSetItem;});
    await page.evaluate(()=>location.hash='#/batch');
    await page.evaluate(()=>{document.getElementById('errbar').style.display='none';window.scrollTo(0,0);});
    await page.screenshot({path:path.join(root,'review-batch.png'),fullPage:true});
    ok(errors.length===0,'no uncaught browser errors '+JSON.stringify(errors));
    fs.writeFileSync(path.join(root,'test-results.json'),JSON.stringify({passed:pass,errors,network:'mocked; no production requests'},null,2));
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
