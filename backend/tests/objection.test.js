'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {renderDocx}=require('../objectionDocument');const {identity,resolvePoints,generationInput,validateAiDraft,assembleDraft}=require('../objectionDraft');const law=require('../objectionLaw');
const requirement={id:'r',key:'camera_sensor',value:'1 polegada',quote:'Câmera de 1 polegada',source_id:'s',location:'Página 2',label:'Sensor da câmera'},point={item_number:'1',requirement_id:'r',fingerprint:identity(requirement),point_id:'p',topic:'direcionamento',requirement,product_evidence:[]};
const answer={points:[{point_id:'p',argument:'Requer-se a análise da pertinência e da motivação técnica da restrição, sem presumir sua inexistência nos autos.',requested_change:'Admitir solução equivalente, se ausente justificativa suficiente.',legal_articles:['9','41']}],pending_checks:['Conferir prazo e calendário local.']};
test('only selected current requirements enter the challenge; edited sources invalidate old selections',()=>{
 const result={items:[{number:'1',in_scope:true,requirements:[requirement],products:[]}]};assert.equal(resolvePoints(result,[point]).length,1);const changed=structuredClone(result);changed.items[0].requirements[0].value='2 polegadas';assert.throws(()=>resolvePoints(changed,[point]),/mudou/);
});
test('legal base includes all four brand exceptions and conditional deadline/publication rules, not automatic illegality',()=>{
 assert.match(law.articles['41'],/padronização/);assert.match(law.articles['41'],/compatibilidade/);assert.match(law.articles['41'],/mais de um fornecedor/);assert.match(law.articles['41'],/referência/);assert.match(law.articles['55'],/exceto/);assert.match(law.guidance['164'],/calendário/);
 assert.equal(validateAiDraft(answer,[point]),answer);assert.throws(()=>validateAiDraft({...answer,points:[]},[point]),/todos os pontos/);assert.throws(()=>validateAiDraft({...answer,points:[{...answer.points[0],legal_articles:['999']}]},[point]),/fora da base/);assert.throws(()=>validateAiDraft({...answer,points:[{...answer.points[0],argument:'Segundo Acórdão 12345.'}]},[point]),/referência jurídica/);
});
test('direct procurement never receives an unconditional three-business-day appeal deadline',()=>{
 const input=generationInput({notice:{title:'Dispensa 1',procedure:'Dispensa eletrônica'},points:[point],sources:[],party:{name:'Empresa'},extra:''});const draft=assembleDraft(input,answer);assert.match(draft.sections[1].paragraphs[0],/Não se presume/);assert.doesNotMatch(draft.sections[1].paragraphs[0],/até três dias úteis/);
});
test('the generated Word is a valid OOXML archive with A4 layout, styles, references and escaped text',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'objection-docx-'));try{
  const input=generationInput({notice:{title:'Pregão 1',agency:'Município'},points:[point],sources:[],party:{name:'Empresa <A> & B'},extra:''}),draft=assembleDraft(input,answer),file=path.join(dir,'impugnacao.docx');await fs.writeFile(file,renderDocx(draft));
  const code='import zipfile,sys,xml.etree.ElementTree as E\nz=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None\nfor name in z.namelist(): E.fromstring(z.read(name))\ns=z.read("word/document.xml").decode(); assert "&lt;A&gt; &amp; B" in s; assert "IMPUGNAÇÃO AO EDITAL" in s; assert "11906" in s and "16838" in s; assert "art. 41" in s\nassert "Times New Roman" in z.read("word/styles.xml").decode()\n';
  const result=spawnSync(process.platform==='win32'?'python':'python3',['-c',code,file],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
