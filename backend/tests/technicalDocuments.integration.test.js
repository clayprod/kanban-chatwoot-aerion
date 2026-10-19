'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { extract, run } = require('../technicalDocuments');
function pdf(objects) {
  const chunks = [Buffer.from('%PDF-1.4\n')], offsets = [0]; let length = chunks[0].length;
  objects.forEach((object, i) => { offsets.push(length); const value = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.isBuffer(object) ? object : Buffer.from(object), Buffer.from('\nendobj\n')]); chunks.push(value); length += value.length; });
  const start = length;
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`));
  return Buffer.concat(chunks);
}
const stream = bytes => Buffer.concat([Buffer.from(`<< /Length ${bytes.length} >>\nstream\n`), bytes, Buffer.from('\nendstream')]);
test('real tools: text PDF, scanned PDF OCR, DOCX tables and legacy DOC preserve technical numbers', { skip: process.env.TECHNICAL_DOCUMENT_TEST !== '1', timeout: 240000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'technical-test-'));
  try {
    const content = Buffer.from('BT /F1 18 Tf 40 750 Td (Autonomia minima de 41 min. Peso maximo de 900 g.) Tj ET');
    const original = pdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', stream(content)]);
    let result = await extract(original, 'edital.pdf', 'application/pdf');
    assert.equal(result.complete, true, JSON.stringify(result)); assert.match(result.pages[0].text, /41 min/); assert.equal(result.pages[0].location, 'Página 1');
    const source = path.join(dir, 'original.pdf'); await fs.writeFile(source, original);
    const prefix = path.join(dir, 'scan');
    await run('pdftoppm', ['-gray', '-r', '150', '-singlefile', source, prefix]);
    const pgm = await fs.readFile(`${prefix}.pgm`);
    const header = /^P5\s+(\d+)\s+(\d+)\s+255\s/.exec(pgm.toString('ascii', 0, 100)); assert.ok(header);
    const compressed = zlib.deflateSync(pgm.subarray(Buffer.byteLength(header[0])));
    const image = Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${header[1]} /Height ${header[2]} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`), compressed, Buffer.from('\nendstream')]);
    const scan = pdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>', image, stream(Buffer.from('q 595 0 0 842 0 0 cm /Im1 Do Q'))]);
    result = await extract(scan, 'digitalizado.pdf', 'application/pdf');
    assert.match(result.pages.map(p => p.text).join('\n'), /41\s*min/i, JSON.stringify(result));
    assert.ok(result.notes.some(note => /OCR utilizado/.test(note)));
    if (!result.complete) assert.ok(result.notes.some(note => /OCR com dúvida em números/.test(note)), JSON.stringify(result));
    const docx = path.join(dir, 'ficha.docx');
    const python = `import zipfile,sys
files={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>', '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>', 'word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Ficha tecnica do produto. Autonomia de 40 min.</w:t></w:r></w:p><w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Peso</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>900 g</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>'}
with zipfile.ZipFile(sys.argv[1],'w') as z:
 for name,value in files.items(): z.writestr(name,value)
`;
    await run('python3', ['-c', python, docx]);
    result = await extract(await fs.readFile(docx), 'ficha.docx');
    assert.equal(result.complete, true); assert.match(result.pages.map(p => p.text).join('\n'), /40\s*min/); assert.match(result.pages.map(p => p.text).join('\n'), /900\s*g/);
    await run('libreoffice', [`-env:UserInstallation=file://${dir}/profile`, '--headless', '--convert-to', 'doc', '--outdir', dir, docx]);
    result = await extract(await fs.readFile(path.join(dir, 'ficha.doc')), 'ficha.doc');
    assert.equal(result.complete, true); assert.match(result.pages.map(p => p.text).join('\n'), /40\s*min/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
