/* v4.11: task ownership, final result commits and observable synchronization. */
(function(global){
  'use strict';
  var lanes={}, syncItems=[], syncTail=Promise.resolve(), sequence=0, batchDraft=[];
  var buttonIds={daily:['runBtn','transBtn'],batch:['batchBtn'],vision:['visionAutoBtn']};
  function el(id){return document.getElementById(id);}
  function id(){return global.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now()+'-'+(++sequence);}
  function today(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
  function validDate(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var p=value.split('-').map(Number), d=new Date(p[0],p[1]-1,p[2]);
    return d.getFullYear()===p[0] && d.getMonth()===p[1]-1 && d.getDate()===p[2];
  }
  function metadata(hostId){
    var vision=hostId==='visionHostInput';
    var m={host:el(hostId || 'hostInput').value.trim(),date:el(vision?'visionDate':'dateInput').value.trim(),
      studio:el(vision?'visionStudio':'studioSelect').value,productKey:el(vision?'visionProduct':'productSelect').value};
    if(!m.host) throw new Error('主播不能为空，请确认识别结果');
    if(!validDate(m.date)) throw new Error('请选择有效的评分日期');
    return m;
  }
  function newJob(lane,file,meta){
    if(lanes[lane] && lanes[lane].state==='running'){toastErr('当前任务仍在处理，请等待完成或取消');return null;}
    var job={id:id(),lane:lane,file:file,meta:meta,state:'running',controller:new AbortController(),cache:{},
      history:getHistoryLib().slice(),startedAt:Date.now(),message:'正在准备…'};
    lanes[lane]=job;
    (buttonIds[lane]||[]).forEach(function(k){if(el(k))el(k).disabled=true;});
    progress(job,job.message);
    return job;
  }
  function assertActive(job){
    if(job && (job.controller.signal.aborted || lanes[job.lane]!==job || job.state==='cancelled')){
      var error=new Error('任务已取消');error.name='AbortError';throw error;
    }
  }
  function progress(job,message){
    if(!job || lanes[job.lane]!==job)return;
    job.message=message;renderJob(job);
  }
  function finish(job,state,message){
    if(lanes[job.lane]!==job || job.state==='cancelled')return;
    job.state=state;job.message=message;
    (buttonIds[job.lane]||[]).forEach(function(k){if(el(k))el(k).disabled=false;});
    renderJob(job);
    if(job.lane==='batch' && job.rows)renderBatchRows(job.rows);
  }
  function cancel(lane){
    var job=lanes[lane];if(!job || job.state!=='running')return;
    job.controller.abort();job.state='cancelled';job.message='已取消；已完成的记录保留，未完成结果不保存。';
    (buttonIds[lane]||[]).forEach(function(k){if(el(k))el(k).disabled=false;});
    renderJob(job);
    if(job.lane==='batch' && job.rows)renderBatchRows(job.rows);
  }
  async function request(url,options,job,timeout){
    assertActive(job);
    var ctrl=new AbortController(), expired=false;
    var abort=function(){ctrl.abort();};
    if(job)job.controller.signal.addEventListener('abort',abort,{once:true});
    var timer=setTimeout(function(){expired=true;ctrl.abort();},timeout || 60000);
    try{
      var response=await fetch(url,Object.assign({},options,{signal:ctrl.signal}));
      if(!response.ok)throw new Error('服务返回 HTTP '+response.status);
      // Timer remains active until the response body is fully consumed.
      var data=await response.json();assertActive(job);
      if(!data || data.ok!==true)throw new Error((data && (data.error || data.reason)) || '服务返回无效结果');
      if(data.failed)throw new Error('服务返回 '+data.failed+' 条写入失败');
      return data;
    }catch(e){
      assertActive(job);
      if(expired)throw new Error('请求超时，请重试');
      throw e;
    }finally{
      clearTimeout(timer);
      if(job)job.controller.signal.removeEventListener('abort',abort);
    }
  }
  async function cachedRequest(job,key,url,options){
    assertActive(job);
    if(job.cache[key])return job.cache[key];
    var data=await request(url,options,job,600000);
    job.cache[key]=data;return data;
  }
  function readFile(file,job){
    return new Promise(function(resolve,reject){
      var reader=new FileReader();
      var abort=function(){reader.abort();};
      function clear(){job.controller.signal.removeEventListener('abort',abort);}
      reader.onload=function(){clear();try{assertActive(job);resolve(reader.result);}catch(e){reject(e);}};
      reader.onerror=function(){clear();reject(new Error('文件读取失败'));};
      reader.onabort=function(){clear();var e=new Error('任务已取消');e.name='AbortError';reject(e);};
      job.controller.signal.addEventListener('abort',abort,{once:true});
      try{assertActive(job);reader.readAsText(file,'utf-8');}catch(e){clear();reject(e);}
    });
  }
  function publicResult(r){
    return JSON.parse(JSON.stringify(r,function(key,value){
      if(key.indexOf('__')===0 || key==='repB64')return undefined;
      return value;
    }));
  }
  async function evaluate(text,file,meta,job,row){
    assertActive(job);
    var segs=parseTranscript(text);
    if(!segs.length)throw new Error('未提取到有效话术段，请检查文件内容');
    var key=meta.productKey;
    if(key==='auto'){
      var inferred=detectProductFromName(file.name,text);
      if(inferred && GRADING_STANDARD.sellpoints[inferred])key=inferred;
    }
    var r=await v4Evaluate(segs,key,job);
    assertActive(job);
    if(r.noProduct)throw new Error((r.pkgHint || '未识别到产品')+'，请选择考核产品后重试');
    r.host=meta.host;r.studio=meta.studio;r.date=meta.date;
    var product=r.autoMatch && r.autoMatch.auto ? r.autoMatch.fromKey : key;
    r.product=(GRADING_STANDARD.sellpoints[product]||{}).name || (r.sellpoints && r.sellpoints.product) || '未知产品';
    r.segCount=segs.length;r.fileName=file.name;r.scoreType='text';
    r.resultId=row ? row.id : job.id;r.updatedAt=new Date().toISOString();
    r.__historyBaseline=job.history;r.__jobId=job.id;
    return r;
  }
  function commit(r,job){
    assertActive(job);
    if(r.__committed)return;
    try{
      addHistoryRecord(r);
      addGoldenToLib(r.host,r.studio,r.date,r.product,r.golden || {items:[]});
      collectProblems(r);
      r.__committed=true;
    }catch(e){r.__storageError='本地保存失败，请导出报告备份：'+e.message;}
    [renderHistoryLib,renderGoldenLib,renderProblemLib,renderProblemDetail].forEach(function(fn){
      try{fn();}catch(e){console.error('刷新记录失败',e);}
    });
    sync(r);
  }
  function showSingle(r,job){
    assertActive(job);
    renderResult(r);
    v4AttachSemanticEvidence(r);
    var label=r.__sem && r.__sem.used ? '语义评分完成' : r.__sem && r.__sem.degraded ? '语义服务不可用，已降级为关键词评分：'+r.__sem.reason : '关键词评分完成';
    var status=el('semStatus');
    if(!status){status=document.createElement('div');status.id='semStatus';el('result').insertBefore(status,el('result').firstChild);}
    status.className='job-panel';status.textContent=label;status.style.display='block';
    finish(job,'done',label+' · '+r.total+' 分\n'+(r.__storageError || '报告已保存，同步状态见下方。'));
  }
  async function processDaily(job,video){
    try{
      var text;
      if(video){
        progress(job,'上传并转写中…可取消，失败后支持重试');
        var d=await cachedRequest(job,'transcription',ASR_URL+'/api/transcribe',{
          method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(job.file.name)},body:job.file});
        text=d.srt || '';
      }else{progress(job,'正在读取逐字稿…');text=await readFile(job.file,job);}
      var r=await evaluate(text,job.file,job.meta,job);job.result=r;
      commit(r,job);showSingle(r,job);
      if(video)try{localStorage.setItem('last_srt',text);}catch(e){toastErr('转写缓存保存失败，请导出报告备份');}
    }catch(e){if(job.state!=='cancelled')finish(job,'failed',e.message);}
  }
  function startDaily(video){
    try{
      var file=el(video?'videoInput':'fileInput').files[0];
      if(!file)throw new Error(video?'请先选择视频文件':'请先选择逐字稿文件');
      var job=newJob('daily',file,metadata());if(!job)return;
      job.video=video;return processDaily(job,video);
    }catch(e){toastErr(e.message);}
  }
  async function processFull(job){
    try{
      progress(job,'正在上传、转写并提取画面…');
      var r=await buildFullReport(job);assertActive(job);
      r.resultId=job.id;r.updatedAt=new Date().toISOString();r.__historyBaseline=job.history;
      job.result=r;commit(r,job);renderGptDaily(r.fullDaily);
      finish(job,'done','完整日报完成 · '+r.total+' 分 '+r.grade+'级\n'+(r.__storageError || '显示、历史和同步使用同一份完整日报结果。'));
    }catch(e){if(job.state!=='cancelled')finish(job,'failed',e.message);}
  }
  function fullReport(){
    try{
      var file=el('visionVideoInput').files[0];if(!file)throw new Error('请先选择视频文件');
      var meta=metadata('visionHostInput');
      var job=newJob('vision',file,meta);if(!job)return;
      return processFull(job);
    }catch(e){toastErr(e.message);}
  }
  function prepareBatch(){
    if(lanes.batch && lanes.batch.state==='running')return;
    var files=Array.from(el('batchInput').files);
    batchDraft=files.map(function(file){
      var m=autoDetectMeta(file.name);
      return {id:id(),file:file,state:'ready',message:'待评分',meta:{
        host:m.host || fallbackHostFromFile(file.name) || '',studio:m.studio || el('studioSelect').value,
        date:m.date || el('dateInput').value || today(),productKey:el('productSelect').value}};
    });
    renderBatchRows(batchDraft);
  }
  async function processBatch(job){
    var todo=job.rows.filter(function(row){return row.state!=='done';}), cursor=0;
    job.rows.forEach(function(row){row.job=job;});
    async function worker(){
      while(cursor<todo.length){
        var row=todo[cursor++];
        try{
          assertActive(job);row.state='running';row.message='读取 / 评分中…';renderBatchRows(job.rows);
          var text=await readFile(row.file,job);
          var r=await evaluate(text,row.file,row.meta,job,row);
          row.result=r;commit(r,job);row.state='done';row.message=(r.__sem && r.__sem.degraded?'已降级 · ':'已完成 · ')+r.total+' 分'+(r.__storageError?' · 保存异常':'');
        }catch(e){row.state=job.state==='cancelled'?'cancelled':'failed';row.message=e.message;}
        if(lanes.batch!==job || job.state==='cancelled')return;
        renderBatchRows(job.rows);
        progress(job,'已完成 '+job.rows.filter(function(x){return x.state==='done';}).length+'/'+job.rows.length+'，最终完成后发布 TOP1');
      }
    }
    await Promise.all([worker(),worker(),worker()]);
    if(job.state==='cancelled' || lanes.batch!==job)return;
    var results=job.rows.map(function(row){return row.result || {error:row.message,fileName:row.file.name,host:row.meta.host};});
    var failed=job.rows.filter(function(row){return row.state!=='done';}).length;
    job.results=results;
    if(failed){
      el('batchCompare').style.display='none';
      finish(job,'failed',failed+' 个文件未完成，TOP1 尚未发布。请修正对应信息后重试失败项。');
      return;
    }
    renderBatchCompare(results);v4AttachSemanticEvidence(results);
    var winner=pickTop1(results);
    if(winner && !job.published){job.published=true;syncTop1ToFeishu(results,winner);}
    finish(job,'done',winner?'全批评分完成 · TOP1：'+winner.host+' '+winner.total+' 分':'全批评分完成，本批无人满足 TOP1 推荐条件');
  }
  function validateBatch(rows){
    if(rows.length<2)throw new Error('请至少选择 2 个主播的逐字稿');
    var hosts=new Set(),dates=new Set();
    rows.forEach(function(row){
      if(!row.meta.host.trim())throw new Error(row.file.name+'：主播不能为空');
      if(!validDate(row.meta.date))throw new Error(row.file.name+'：请选择有效日期');
      if(hosts.has(row.meta.host.trim()))throw new Error('同一批次每位主播只保留一个文件，请检查重复主播');
      hosts.add(row.meta.host.trim());dates.add(row.meta.date);
    });
    if(dates.size!==1)throw new Error('每日 TOP1 需要同一天的评分，请统一日期后开始');
  }
  function batch(){
    try{
      if(lanes.batch && lanes.batch.state==='running'){toastErr('批量任务正在处理，请等待完成或取消');return;}
      if(!batchDraft.length)prepareBatch();validateBatch(batchDraft);
      var job=newJob('batch',null,null);if(!job)return;
      job.rows=batchDraft.map(function(row){return {id:id(),file:row.file,meta:Object.assign({},row.meta),state:'ready',message:'待评分'};});
      el('batchCompare').style.display='none';
      return processBatch(job);
    }catch(e){toastErr(e.message);}
  }
  function retry(lane){
    var old=lanes[lane];if(!old || old.state==='running')return;
    try{
      if(lane==='batch')validateBatch(old.rows);
      var job=newJob(lane,old.file,old.meta);if(!job)return;
      job.cache=old.cache;job.history=old.history;job.video=old.video;
      if(lane==='batch'){job.rows=old.rows;return processBatch(job);}
      if(lane==='vision')return processFull(job);
      return processDaily(job,job.video);
    }catch(e){toastErr(e.message);}
  }
  function button(text,action){var b=document.createElement('button');b.type='button';b.className='btn btn-ghost';b.textContent=text;b.onclick=action;return b;}
  function renderJob(job){
    var panel=el('job-'+job.lane);if(!panel)return;
    var msg=panel.querySelector('[role="status"]');msg.textContent=job.message;
    var actions=panel.querySelector('.job-actions');actions.replaceChildren();
    if(job.state==='running')actions.appendChild(button('取消任务',function(){cancel(job.lane);}));
    if(job.state==='failed' || job.state==='cancelled')actions.appendChild(button(job.lane==='batch'?'重试未完成文件':'重试未完成步骤',function(){retry(job.lane);}));
    if(job.lane==='vision' && job.result){
      actions.appendChild(button('导出完整日报 JSON',function(){download(publicResult(job.result),'完整日报_'+job.result.host+'.json');}));
    }
    if(job.state==='done')actions.appendChild(button('查看同步状态',function(){el('job-sync-list').parentNode.open=true;el('job-sync-list').scrollIntoView({behavior:'smooth',block:'center'});}));
  }
  function renderBatchRows(rows){
    var box=el('batch-task-list');if(!box)return;
    box.replaceChildren();
    rows.forEach(function(row){
      var div=document.createElement('div');div.className='job-row';
      var label=document.createElement('span');label.className='file-name';label.textContent=row.file.name;div.appendChild(label);
      [['host','主播','text'],['date','日期','date'],['studio','直播间','text']].forEach(function(field){
        var input=document.createElement('input');input.type=field[2];input.value=row.meta[field[0]];
        input.setAttribute('aria-label',row.file.name+' '+field[1]);input.title=field[1];
        input.disabled=row.state==='done' || (lanes.batch && lanes.batch.state==='running');
        input.onchange=function(){row.meta[field[0]]=input.value.trim();};div.appendChild(input);
      });
      var select=el('productSelect').cloneNode(true);select.removeAttribute('id');select.removeAttribute('onchange');
      select.value=row.meta.productKey;select.setAttribute('aria-label',row.file.name+' 考核产品');
      select.disabled=row.state==='done' || (lanes.batch && lanes.batch.state==='running');
      select.onchange=function(){row.meta.productKey=select.value;};div.appendChild(select);
      var state=document.createElement('span');state.textContent=row.message;state.setAttribute('role','status');div.appendChild(state);
      if(row.result)div.appendChild(button('导出报告',function(){download(publicResult(row.result),'评分报告_'+row.meta.host+'.json');}));
      box.appendChild(div);
    });
  }
  function download(data,name){
    var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}));
    a.download=name;a.click();setTimeout(function(){URL.revokeObjectURL(a.href);},1000);
  }
  function post(url,body){return request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},null,60000);}
  function weekMonth(date){
    var p=date.split('-').map(Number),d=new Date(p[0],p[1]-1,p[2]),monday=new Date(d);
    monday.setDate(d.getDate()-(d.getDay()+6)%7);var sunday=new Date(monday);sunday.setDate(monday.getDate()+6);
    function format(x){return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');}
    var url=FEISHU_FILL_URL.replace('feishu-fill','feishu-week-month');
    return [function(){return post(url,{range:'week',start:format(monday),end:format(sunday)});},
      function(){return post(url,{range:'month',start:format(new Date(p[0],p[1]-1,1)),end:format(new Date(p[0],p[1],0))});}];
  }
  function renderSync(){
    var box=el('job-sync-list');if(!box)return;box.replaceChildren();
    syncItems.slice(-15).reverse().forEach(function(item){
      var row=document.createElement('div');row.className='job-row';
      var label=document.createElement('span');label.className='sync-'+item.state;
      label.textContent=item.title+' · '+item.message;row.appendChild(label);
      if(item.state==='failed')row.appendChild(button('重试同步',function(){queueSync(item);}));
      box.appendChild(row);
    });
  }
  function queueSync(item){
    if(item.state==='running' || item.state==='queued')return item.promise;
    item.state='queued';item.message='等待同步';renderSync();
    item.promise=syncTail.then(async function(){
      item.state='running';
      try{
        while(item.step<item.steps.length){
          item.message='正在同步：'+item.steps[item.step].name;renderSync();
          await item.steps[item.step].run();item.step++;
        }
        item.state='done';item.message='已同步';
      }catch(e){item.state='failed';item.message=item.steps[item.step].name+'失败：'+e.message;}
      renderSync();
    });
    syncTail=item.promise.catch(function(e){console.error(e);});return item.promise;
  }
  function syncLibs(r){return post(FEISHU_SYNC_URL,buildFeishuLibPayload(r));}
  function sync(r){
    if(!r || !r.host || !validDate(r.date) || (r.__semCtx && !r.__semDone))return Promise.resolve();
    if(r.__syncItem)return r.__syncItem.promise;
    var wm=weekMonth(r.date);
    var item={title:r.host+' '+r.date+(r.scoreType==='full-daily'?' 完整日报':''),step:0,steps:[
      {name:'主播日报',run:function(){return post(FEISHU_FILL_URL,{host:r.host,date:r.date,studio:effectiveStudio(r),result:publicResult(r)});}},
      {name:'话术、问题和历史',run:function(){return syncLibs(r);}},
      {name:'周总结',run:wm[0]},{name:'月总结',run:wm[1]}
    ]};
    r.__syncItem=item;syncItems.push(item);return queueSync(item);
  }
  function syncTop1(results,top1){
    if(!top1 || results.some(function(r){return r.__semCtx && !r.__semDone;}))return Promise.resolve();
    var item={title:'TOP1 '+top1.host+' '+top1.date,step:0,steps:[{name:'TOP1',run:function(){return post(FEISHU_SYNC_URL,buildTop1Payload(results,top1));}}]};
    syncItems.push(item);return queueSync(item);
  }
  function init(){
    if(!el('dateInput').value)el('dateInput').value=today();
    ['daily','batch','vision'].forEach(function(lane){
      var page=el('page-'+lane),panel=document.createElement('div');panel.id='job-'+lane;panel.className='job-panel';
      var text=document.createElement('div');text.setAttribute('role','status');text.setAttribute('aria-live','polite');
      text.textContent=lane==='batch'?'选择文件后可逐条确认主播、日期、直播间和考核产品。':'确认主播、日期和考核产品后开始；评分完成后自动保存。';
      var actions=document.createElement('div');actions.className='job-actions';panel.appendChild(text);panel.appendChild(actions);page.insertBefore(panel,page.firstChild);
    });
    var list=document.createElement('div');list.id='batch-task-list';list.className='job-panel';el('page-batch').insertBefore(list,el('batchCompare'));
    var syncPanel=document.createElement('details');syncPanel.open=true;syncPanel.className='job-panel';
    var summary=document.createElement('summary');summary.textContent='本次会话同步状态';syncPanel.appendChild(summary);
    var syncList=document.createElement('div');syncList.id='job-sync-list';syncList.textContent='评分完成后显示每一步同步状态。';syncPanel.appendChild(syncList);
    document.querySelector('.v4-main').appendChild(syncPanel);
    el('batchInput').addEventListener('change',prepareBatch);
    var visionMeta=document.createElement('div');visionMeta.className='row';
    [['dateInput','visionDate','评分日期'],['studioSelect','visionStudio','直播间'],['productSelect','visionProduct','考核产品']].forEach(function(field){
      var label=document.createElement('label');label.textContent=field[2];label.htmlFor=field[1];
      var input=el(field[0]).cloneNode(true);input.id=field[1];input.removeAttribute('onchange');
      input.value=el(field[0]).value;visionMeta.appendChild(label);visionMeta.appendChild(input);
    });
    el('job-vision').appendChild(visionMeta);
    el('videoInput').addEventListener('change',function(){autoFillMeta(this);});
    el('visionVideoInput').addEventListener('change',function(){
      if(!this.files[0])return;var m=autoDetectMeta(this.files[0].name);
      if(m.host)el('visionHostInput').value=m.host;
      if(m.date)el('visionDate').value=m.date;
    });
  }
  global.V4Jobs={runText:function(){return startDaily(false);},transcribe:function(){return startDaily(true);},
    batch:batch,fullReport:fullReport,request:request,cachedRequest:cachedRequest,assertActive:assertActive,
    progress:progress,publicResult:publicResult,sync:sync,syncLibs:syncLibs,syncTop1:syncTop1,cancel:cancel,retry:retry,
    getJob:function(lane){return lanes[lane];}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(window);
