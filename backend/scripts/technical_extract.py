"""Local, bounded document extraction. Never executes macros or embedded content."""
import json
import csv
import io
import pathlib
import subprocess
import sys
import tempfile


def command(args, timeout=90):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=timeout).stdout


def main(filename):
    source = pathlib.Path(filename)
    pages, notes = [], []
    complete = True
    if source.suffix.lower() in ('.doc', '.docx'):
        # Isolated profile prevents reuse of another LibreOffice process.
        with tempfile.TemporaryDirectory(prefix='technical-office-') as temp:
            command(['libreoffice', '-env:UserInstallation=' + pathlib.Path(temp, 'profile').as_uri(),
                     '--headless', '--convert-to', 'pdf', '--outdir', temp, str(source)], 120)
            return main(str(pathlib.Path(temp, source.stem + '.pdf')))
    info = command(['pdfinfo', str(source)])
    count = next(int(line.split(':', 1)[1].strip()) for line in info.splitlines() if line.startswith('Pages:'))
    # A limit is always surfaced; it can never produce a full-compliance badge.
    if count > 400:
        complete = False
        notes.append('Documento acima de 400 páginas; leitura parcial.')
    raw = command(['pdftotext', '-layout', '-enc', 'UTF-8', '-f', '1', '-l', str(min(count, 400)), str(source), '-'], 120)
    texts = raw.split('\f')
    with tempfile.TemporaryDirectory(prefix='technical-ocr-') as temp:
        for index in range(min(count, 400)):
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
                if index >= 100:
                    complete = False
                    notes.append('OCR acima do limite de 100 páginas; leitura parcial.')
                else:
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
