"""Local, bounded document extraction. Never executes macros or embedded content."""
import json
import csv
import io
import pathlib
import subprocess
import sys
import tempfile
import zipfile
import shutil
import re


def command(args, timeout=90):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=timeout).stdout


def archive(source, depth, budget):
    pages, notes, complete = [], [], True
    if depth >= 3:
        raise ValueError('ZIP com níveis de compactação demais; leitura incompleta.')
    with zipfile.ZipFile(source) as package, tempfile.TemporaryDirectory(prefix='technical-zip-') as temp:
        for entry in package.infolist():
            name = entry.filename.replace('\\', '/')
            if entry.is_dir() or name.startswith('__MACOSX/') or name.endswith('/.DS_Store'):
                continue
            budget['files'] += 1
            budget['bytes'] += entry.file_size
            if budget['files'] > 200 or budget['bytes'] > 100 * 1024 * 1024 or entry.file_size > 20 * 1024 * 1024:
                raise ValueError('ZIP excede limites seguros de expansão; leitura incompleta.')
            if name.startswith('/') or '..' in pathlib.PurePosixPath(name).parts or ':' in name or ((entry.external_attr >> 16) & 0o170000) == 0o120000 or entry.flag_bits & 1:
                notes.append('Entrada ZIP não lida: ' + name)
                complete = False
                continue
            suffix = pathlib.PurePosixPath(name).suffix.lower()
            if suffix not in ('.pdf', '.doc', '.docx', '.zip', '.txt', '.html', '.htm', ''):
                notes.append('Formato não lido no ZIP: ' + name)
                complete = False
                continue
            target = pathlib.Path(temp, str(budget['files']) + suffix)
            try:
                # Never extract user-controlled paths. Read at most the declared
                # safe size and flatten names into this private temporary folder.
                with package.open(entry) as member:
                    data = member.read(20 * 1024 * 1024 + 1)
                if len(data) > 20 * 1024 * 1024:
                    raise ValueError('Arquivo expandido acima do limite')
                target.write_bytes(data)
                result = main(str(target), depth + 1, budget)
                complete = complete and result['complete']
                pages.extend({'location': name + ' · ' + p['location'], 'text': p['text']} for p in result['pages'])
                notes.extend(name + ': ' + note for note in result['notes'])
            except (ValueError, OSError, subprocess.SubprocessError, zipfile.BadZipFile, RuntimeError) as error:
                complete = False
                notes.append('Falha de leitura de ' + name + ': ' + str(error))
    if not pages:
        complete = False
        notes.append('Nenhum documento verificável dentro do ZIP.')
    return {'pages': pages, 'complete': complete, 'notes': list(dict.fromkeys(notes)), 'page_count': len(pages)}


def main(filename, depth=0, budget=None):
    source = pathlib.Path(filename)
    if budget is None:
        budget = {'files': 0, 'bytes': 0}
    # Legacy DOC files may contain an embedded ZIP with Office themes. Python's
    # ZIP detector accepts that trailing archive, but the enclosing file is DOC.
    zip_header = False
    if source.is_file():
        with source.open('rb') as content:
            zip_header = content.read(4).startswith(b'PK')
    if zip_header and zipfile.is_zipfile(source):
        with zipfile.ZipFile(source) as package:
            is_word = 'word/document.xml' in package.namelist() and '[Content_Types].xml' in package.namelist()
        if not is_word:
            return archive(source, depth, budget)
        if source.suffix.lower() != '.docx':
            with tempfile.TemporaryDirectory(prefix='technical-docx-') as temp:
                renamed = pathlib.Path(temp, 'document.docx')
                shutil.copyfile(source, renamed)
                return main(str(renamed), depth, budget)
    pages, notes = [], []
    complete = True
    if source.suffix.lower() in ('.txt', '.html', '.htm'):
        text = source.read_text(encoding='utf-8', errors='replace')
        if source.suffix.lower() != '.txt':
            text = re.sub(r'<[^>]+>', ' ', text)
        return {'pages': [{'location': 'Texto', 'text': text}], 'complete': len(text.strip()) > 10, 'notes': [], 'page_count': 1}
    if source.suffix.lower() in ('.doc', '.docx'):
        # Isolated profile prevents reuse of another LibreOffice process.
        with tempfile.TemporaryDirectory(prefix='technical-office-') as temp:
            command(['libreoffice', '-env:UserInstallation=' + pathlib.Path(temp, 'profile').as_uri(),
                     '--headless', '--convert-to', 'pdf', '--outdir', temp, str(source)], 120)
            return main(str(pathlib.Path(temp, source.stem + '.pdf')))
    info = command(['pdfinfo', str(source)])
    count = next(int(line.split(':', 1)[1].strip()) for line in info.splitlines() if line.startswith('Pages:'))
    raw = command(['pdftotext', '-layout', '-enc', 'UTF-8', '-f', '1', '-l', str(count), str(source), '-'], 120)
    texts = raw.split('\f')
    with tempfile.TemporaryDirectory(prefix='technical-ocr-') as temp:
        for index in range(count):
            content = texts[index].strip() if index < len(texts) else ''
            has_large_image = False
            if 0 < len(content) < 60:
                try:
                    image_rows = command(['pdfimages', '-f', str(index + 1), '-l', str(index + 1), '-list', str(source)]).splitlines()[2:]
                    has_large_image = any(len(row.split()) > 4 and row.split()[3].isdigit() and row.split()[4].isdigit()
                                          and int(row.split()[3]) >= 400 and int(row.split()[4]) >= 400 for row in image_rows)
                except (subprocess.SubprocessError, OSError):
                    complete = False
                    notes.append('Não foi possível verificar imagens na página ' + str(index + 1))
            if len(content) < 15 or has_large_image:
                prefix = str(pathlib.Path(temp, 'page'))
                try:
                    command(['pdftoppm', '-f', str(index + 1), '-l', str(index + 1), '-r', '160', '-png', '-singlefile', str(source), prefix])
                    ocr_text = command(['tesseract', prefix + '.png', 'stdout', '-l', 'por+eng', '--psm', '3'], 90).strip()
                    content = (content + '\n' + ocr_text).strip()
                    tsv = command(['tesseract', prefix + '.png', 'stdout', '-l', 'por+eng', '--psm', '3', 'tsv'], 90)
                    words = list(csv.DictReader(io.StringIO(tsv), delimiter='\t'))
                    if any(any(char.isdigit() for char in row.get('text', '')) and float(row.get('conf', '-1')) < 95 for row in words):
                        complete = False
                        notes.append('OCR com dúvida em números na página ' + str(index + 1))
                    notes.append('OCR utilizado na página ' + str(index + 1))
                except (subprocess.SubprocessError, OSError):
                    complete = False
                    notes.append('Falha de OCR na página ' + str(index + 1))
            if len(content) < 15:
                complete = False
                notes.append('Página sem texto verificável: ' + str(index + 1))
            pages.append({'location': 'Página ' + str(index + 1), 'text': content})
    return {'pages': pages, 'complete': complete, 'notes': list(dict.fromkeys(notes)), 'page_count': count}


if __name__ == '__main__':
    try:
        print(json.dumps(main(sys.argv[1]), ensure_ascii=False))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
