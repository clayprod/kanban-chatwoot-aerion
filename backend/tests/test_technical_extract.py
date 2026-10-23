import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('technical_extract', Path(__file__).parents[1] / 'scripts' / 'technical_extract.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FullDocumentCoverage(unittest.TestCase):
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
