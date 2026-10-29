'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { run } = require(process.env.TECHNICAL_DOCS_TEST_MODULE || '../technicalDocuments');
const extractor = process.env.TECHNICAL_PYTHON_TEST_MODULE || path.resolve(__dirname, '..', 'scripts', 'technical_extract.py');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => {
  try { return fs.readFileSync('/proc/' + pid + '/stat', 'utf8').split(' ')[2] !== 'Z'; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
async function waitFor(fn, timeout = 4000) {
  const end = Date.now() + timeout;
  while (!fn()) { if (Date.now() > end) throw Error('Condition timed out'); await delay(25); }
}

test('successful commands preserve output and limit OpenMP threads', async () => {
  const result = JSON.parse(await run(process.execPath, ['-e', 'console.log(JSON.stringify({ok:true,threads:process.env.OMP_THREAD_LIMIT}))'], 5000));
  assert.equal(result.ok, true); assert.equal(result.threads, '1');
});
test('spawn and nonzero errors remain visible', async () => {
  await assert.rejects(run('/does-not-exist-technical-test', [], 1000), /ENOENT/);
  await assert.rejects(run(process.execPath, ['-e', 'console.error("expected test failure");process.exit(7)'], 5000), /expected test failure/);
});
test('timeout kills parent and grandchild even when both ignore SIGTERM', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-tree-test-')), file = path.join(dir, 'pid');
  let pid;
  try {
    const code = `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'inherit'});require('fs').writeFileSync(${JSON.stringify(file)},String(c.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`;
    await assert.rejects(run(process.execPath, ['-e', code], 1500), /Tempo de leitura/);
    pid = Number(fs.readFileSync(file)); await waitFor(() => !alive(pid));
  } finally { if (pid && alive(pid)) process.kill(pid, 'SIGKILL'); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('output overflow kills the whole process group', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-output-test-')), file = path.join(dir, 'pid');
  let pid;
  try {
    const code = `const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});require('fs').writeFileSync(${JSON.stringify(file)},String(c.pid));process.stdout.write(Buffer.alloc(21*1024*1024,65));setInterval(()=>{},1000);`;
    await assert.rejects(run(process.execPath, ['-e', code], 10000), /acima de 20 MB/);
    pid = Number(fs.readFileSync(file)); await waitFor(() => !alive(pid));
  } finally { if (pid && alive(pid)) process.kill(pid, 'SIGKILL'); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('Python parent death kills its direct OCR-style child independently of the Node group timeout', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-parent-test-')), file = path.join(dir, 'pid');
  const inner = `import os,time;open(${JSON.stringify(file)},'w').write(str(os.getpid()));time.sleep(60)`;
  const code = `import runpy,sys;m=runpy.run_path(${JSON.stringify(extractor)});m['command']([sys.executable,'-c',${JSON.stringify(inner)}],90)`;
  const parent = spawn('python3', ['-c', code], { stdio: 'ignore' }); let pid;
  try {
    await waitFor(() => fs.existsSync(file)); pid = Number(fs.readFileSync(file));
    const exited = once(parent, 'exit'); parent.kill('SIGKILL'); await exited;
    await waitFor(() => !alive(pid));
  } finally { if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL'); if (pid && alive(pid)) process.kill(pid, 'SIGKILL'); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('real Tesseract still extracts a small rendered document', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-real-test-')), pdf = path.join(dir, 'test.pdf'), prefix = path.join(dir, 'page');
  try {
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 720 140] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
    const content = 'BT /F1 32 Tf 20 70 Td (DOCUMENTO TESTE NUMERO 12345) Tj ET'; objects.push('<< /Length '+Buffer.byteLength(content)+' >>\nstream\n'+content+'\nendstream');
    let data = '%PDF-1.4\n', offsets=[0]; for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(data));data+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';}
    const xref=Buffer.byteLength(data);data+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';fs.writeFileSync(pdf,data);
    const extracted = JSON.parse(await run('python3', [extractor, pdf], 15000));
    assert.equal(extracted.page_count, 1); assert.equal(extracted.complete, true); assert.match(extracted.pages[0].text, /12345/);
    const code = `import runpy;m=runpy.run_path(${JSON.stringify(extractor)});m['command'](['pdftoppm','-singlefile','-scale-to','1200','-png',${JSON.stringify(pdf)},${JSON.stringify(prefix)}],20);print(m['command'](['tesseract',${JSON.stringify(prefix+'.png')},'stdout','-l','por+eng','--psm','6'],20))`;
    const text = await run('python3', ['-c', code], 30000); assert.match(text, /TESTE/); assert.match(text, /12345/);
  } finally { fs.rmSync(dir, {recursive:true,force:true}); }
});
