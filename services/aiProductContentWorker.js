const AliExpressCatalogProduct = require('../models/AliExpressCatalogProduct');
const { generateAliExpressProductContent } = require('./aiProductContentService');
let timer=null, running=false;
const processOnePendingProduct=async()=>{
  if(!process.env.OLLAMA_BASE_URL||running)return false;
  running=true;
  try{
    const now=new Date(), stale=new Date(now.getTime()-10*60*1000);
    const filter={$or:[
      {status:{$in:['pending','approved']},'aiContentDraft.status':{$in:['pending','not_generated']},'aiContentDraft.attempts':{$lt:5},$or:[{'aiContentDraft.nextAttemptAt':null},{'aiContentDraft.nextAttemptAt':{$lte:now}}]},
      {status:{$in:['pending','approved']},'aiContentDraft.status':'failed','aiContentDraft.attempts':{$lt:5},$or:[{'aiContentDraft.nextAttemptAt':null},{'aiContentDraft.nextAttemptAt':{$lte:now}}]},
      {status:{$in:['pending','approved']},'aiContentDraft.status':'processing','aiContentDraft.processingAt':{$lte:stale}},
    ]};
    const result=await AliExpressCatalogProduct.collection.findOneAndUpdate(filter,{$set:{'aiContentDraft.status':'processing','aiContentDraft.lastError':'','aiContentDraft.processingAt':now},$inc:{'aiContentDraft.attempts':1}},{returnDocument:'after',sort:{syncedAt:1}});
    const raw=result?.value||result, claimed=raw?AliExpressCatalogProduct.hydrate(raw):null;
    if(!claimed)return false;
    try{
      const generated=await generateAliExpressProductContent({title:claimed.title,supplierBrand:claimed.supplierBrand,categoryName:claimed.categoryName,productAttributes:claimed.productAttributes,rawDescription:claimed.sourcePayload?.rawDescription||'',productUrl:claimed.productUrl||''});
      claimed.aiContentDraft={...generated,attempts:claimed.aiContentDraft.attempts,lastError:'',nextAttemptAt:null,processingAt:null};
      await claimed.save();
      console.info('[Sylva AI] AliExpress product draft generated:',JSON.stringify({productId:String(claimed._id),model:generated.model,specifications:generated.specifications?.length||0}));
    }catch(error){
      const attempts=Number(claimed.aiContentDraft?.attempts||1), retry=attempts<5&&error.code!=='SYLVA_AI_NOT_CONFIGURED';
      claimed.aiContentDraft.status=retry?'pending':'failed';
      claimed.aiContentDraft.lastError=String(error.code||'SYLVA_AI_FAILED').slice(0,240);
      claimed.aiContentDraft.nextAttemptAt=retry?new Date(Date.now()+Math.min(30,2**attempts)*60000):null;
      claimed.aiContentDraft.processingAt=null;
      await claimed.save();
      console.warn('[Sylva AI] product enrichment failed:',JSON.stringify({code:error.code||'SYLVA_AI_FAILED',status:error.status||null}));
    }
    return true;
  }finally{running=false;}
};
const startAIProductContentWorker=()=>{
  if(timer)return;
  const interval=Math.max(10000,Math.min(60000,Number.parseInt(process.env.SYLVA_AI_WORKER_INTERVAL_MS,10)||15000));
  timer=setInterval(()=>processOnePendingProduct().catch(error=>console.error('[Sylva AI] worker cycle failed:',error.code||error.name||'WORKER_ERROR')),interval);
  timer.unref?.();
};
module.exports={startAIProductContentWorker,processOnePendingProduct};
