import importlib.util
import unittest
import tempfile
import zipfile
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('technical_extract', Path(__file__).parents[1] / 'scripts' / 'technical_extract.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FullDocumentCoverage(unittest.TestCase):
    def test_zip_preserves_each_document_and_its_requirements(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp, 'edital.zip')
            with zipfile.ZipFile(source, 'w') as package:
                package.writestr('Edital.txt', '4.1 Autonomia mínima de 41 minutos.')
                package.writestr('anexos/TR.txt', '4.2 Câmera térmica radiométrica 640x512.')
            result = module.main(str(source))
        self.assertTrue(result['complete'])
        self.assertEqual(len(result['pages']), 2)
        self.assertEqual(result['pages'][1]['location'], 'anexos/TR.txt · Texto')
        self.assertIn('640x512', result['pages'][1]['text'])

    def test_zip_unsafe_or_unsupported_entries_never_claim_full_coverage(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp, 'edital.zip')
            with zipfile.ZipFile(source, 'w') as package:
                package.writestr('TR.txt', 'Requisito técnico: 41 minutos de voo.')
                package.writestr('../escape.txt', 'Do not write outside temporary directory')
                package.writestr('planilha.xlsx', 'unsupported content')
            result = module.main(str(source))
            self.assertFalse(Path(temp, 'escape.txt').exists())
        self.assertFalse(result['complete'])
        self.assertEqual(len(result['pages']), 1)
        self.assertTrue(any('não lida' in note for note in result['notes']))
        self.assertTrue(any('planilha.xlsx' in note for note in result['notes']))

    def test_zip_entry_budget_is_not_silently_truncated(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp, 'large.zip')
            with zipfile.ZipFile(source, 'w') as package:
                for i in range(201):
                    package.writestr(str(i) + '.txt', 'Texto verificável do termo de referência.')
            with self.assertRaisesRegex(ValueError, 'limites seguros'):
                module.main(str(source))

    def test_pages_after_400_are_extracted(self):
        calls = []

        def command(args, timeout=90):
            calls.append(args)
            if args[0] == 'pdfinfo':
                return 'Pages: 405'
            if args[0] == 'pdftotext':
                return '\f'.join('Página com texto técnico verificável número ' + str(i) for i in range(405))
            if args[0] == 'pdfimages':
                return 'header\nheader\n'
            self.fail('Unexpected command')

        with patch.object(module, 'command', command):
            result = module.main('document.pdf')
        self.assertEqual(len(result['pages']), 405)
        self.assertEqual(result['pages'][-1]['location'], 'Página 405')
        self.assertTrue(result['complete'])
        self.assertEqual(calls[1][calls[1].index('-l') + 1], '405')

    def test_ocr_is_not_skipped_after_page_100(self):
        def command(args, timeout=90):
            if args[0] == 'pdfinfo':
                return 'Pages: 101'
            if args[0] == 'pdftotext':
                return '\f'.join(['Página digital com texto técnico verificável.'] * 100 + [''])
            if args[0] == 'pdfimages':
                return 'header\nheader\n'
            if args[0] == 'pdftoppm':
                return ''
            if args[0] == 'tesseract':
                return 'text\tconf\n41\t99\n' if args[-1] == 'tsv' else 'Autonomia mínima de 41 minutos.'
            self.fail('Unexpected command')

        with patch.object(module, 'command', command):
            result = module.main('document.pdf')
        self.assertTrue(result['complete'])
        self.assertIn('41 minutos', result['pages'][-1]['text'])
        self.assertIn('OCR utilizado na página 101', result['notes'])


if __name__ == '__main__':
    unittest.main()
