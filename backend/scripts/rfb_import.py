#!/usr/bin/env python3
"""
rfb_import.py — Download e importação dos dados abertos da Receita Federal
Executado automaticamente pelo backend Node.js. Progresso via JSON no stdout.

Env vars usadas:
  DATABASE_URL   = postgres://user:pass@host:5432/db
  RFB_DATA_PATH  = /data/rfb   (onde salvar os ZIPs; default: ../data/rfb)
  RFB_DEV_LIMIT  = 1            (0 = todos os arquivos, N = N por categoria)
"""

import os
import sys
import re
import csv
import json
import zipfile
import argparse
import requests
import psycopg2
import psycopg2.extras
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

# ── Config ────────────────────────────────────────────────────────────────────

load_dotenv(Path(__file__).parent.parent / '.env')

BASE_URL   = 'https://arquivos.receitafederal.gov.br/index.php/s/gn672Ad4CF8N6TK?dir=/Dados/Cadastros/CNPJ'
NEXTCLOUD  = 'https://arquivos.receitafederal.gov.br'
DATA_PATH  = Path(os.environ.get('RFB_DATA_PATH', str(Path(__file__).parent.parent / 'data' / 'rfb')))
CHUNK_SIZE = 50_000
WORKERS    = max(2, os.cpu_count() or 2)

# ── Progress output (parsado pelo Node.js) ────────────────────────────────────

def progress(status, message, file='', percent=0, records=0, error=''):
    print(json.dumps({
        'status': status,
        'message': message,
        'file': file,
        'percent': percent,
        'records': records,
        'error': error,
    }), flush=True)

# ── WebDAV helpers ────────────────────────────────────────────────────────────

def parse_token(url):
    m = re.search(r'/s/([^/?]+)', url)
    if not m:
        raise ValueError(f'Token não encontrado na URL: {url}')
    return m.group(1)


def webdav_list(token, path=''):
    url = f'{NEXTCLOUD}/public.php/webdav{path}'
    resp = requests.request('PROPFIND', url, auth=(token, ''),
                            headers={'Depth': '1'}, timeout=30)
    resp.raise_for_status()
    items = []
    for block in resp.text.split('<d:response>')[1:]:
        href  = re.search(r'<d:href>(.*?)</d:href>', block)
        ctype = re.search(r'<d:getcontenttype>(.*?)</d:getcontenttype>', block)
        size  = re.search(r'<d:getcontentlength>(.*?)</d:getcontentlength>', block)
        if href:
            items.append({
                'href':   href.group(1),
                'is_dir': not ctype,
                'size':   int(size.group(1)) if size else 0,
            })
    return items


def discover_files(token):
    progress('running', 'Descobrindo arquivos disponíveis na RF...')
    # The date folders are nested under /Dados/Cadastros/CNPJ/
    cnpj_path = '/Dados/Cadastros/CNPJ'
    try:
        cnpj_items = webdav_list(token, cnpj_path)
    except Exception:
        # Fallback: try root (old URL format)
        cnpj_items = webdav_list(token)
    dated = sorted(
        [i for i in cnpj_items if i['is_dir'] and re.search(r'\d{4}-\d{2}', i['href'])],
        key=lambda x: x['href'], reverse=True
    )
    if not dated:
        raise ValueError(f'Nenhuma pasta com data encontrada em {cnpj_path}')
    folder = '/' + dated[0]['href'].split('/public.php/webdav')[-1].strip('/')
    progress('running', f'Pasta mais recente: {folder.split("/")[-1]}')
    files = webdav_list(token, folder)
    zips = [f for f in files if not f['is_dir'] and f['href'].lower().endswith('.zip')]
    return zips


def remote_size(token, href):
    url = f'{NEXTCLOUD}/public.php/webdav{href.split("/public.php/webdav")[-1]}'
    try:
        r = requests.head(url, auth=(token, ''), timeout=15, allow_redirects=True)
        return int(r.headers.get('Content-Length', 0))
    except Exception:
        return 0


def download_file(token, href, dest):
    dav_path = href.split('/public.php/webdav')[-1]
    url      = f'{NEXTCLOUD}/public.php/webdav{dav_path}'
    filename = Path(dav_path).name
    local    = dest / filename

    remote_sz = remote_size(token, href)
    if local.exists() and local.stat().st_size == remote_sz and remote_sz > 0:
        progress('running', f'Já existe: {filename}', file=filename, percent=100)
        return local

    progress('running', f'Baixando {filename}...', file=filename, percent=0)
    downloaded = 0
    with requests.get(url, auth=(token, ''), stream=True, timeout=300) as r:
        r.raise_for_status()
        with open(local, 'wb') as f:
            for chunk in r.iter_content(chunk_size=1 << 20):
                f.write(chunk)
                downloaded += len(chunk)
                if remote_sz > 0:
                    pct = int(downloaded * 100 / remote_sz)
                    progress('running', f'Baixando {filename}', file=filename, percent=pct)
    progress('running', f'Download concluído: {filename}', file=filename, percent=100)
    return local

# ── File classification ───────────────────────────────────────────────────────

MULTI_CATS  = ['Empresas', 'Estabelecimentos', 'Socios']
SINGLE_CATS = ['Simples', 'Municipios', 'Cnaes', 'Naturezas', 'Qualificacoes', 'Paises', 'Motivos']

def classify(filename):
    name = Path(filename).stem
    for cat in MULTI_CATS + SINGLE_CATS:
        if name.lower().startswith(cat.lower()):
            return cat
    return 'outros'


def select_files(all_zips, dev_limit):
    from collections import defaultdict
    by_cat = defaultdict(list)
    for z in all_zips:
        by_cat[classify(Path(z['href']).name)].append(z)
    selected = []
    for cat, files in by_cat.items():
        files_sorted = sorted(files, key=lambda x: x['href'])
        if dev_limit > 0 and cat in MULTI_CATS:
            files_sorted = files_sorted[:dev_limit]
        selected.extend(files_sorted)
    return selected

# ── Table schema ──────────────────────────────────────────────────────────────

TABLE_COLUMNS = {
    'rfb_empresas': [
        'cnpj_basico', 'razao_social', 'natureza_juridica',
        'qualificacao_do_responsavel', 'capital_social',
        'porte_da_empresa', 'ente_federativo_responsavel',
    ],
    'rfb_estabelecimentos': [
        'cnpj_basico', 'cnpj_ordem', 'cnpj_dv',
        'identificador_matriz_filial', 'nome_fantasia',
        'situacao_cadastral', 'data_situacao_cadastral',
        'motivo_situacao_cadastral', 'nome_da_cidade_no_exterior',
        'pais', 'data_de_inicio_da_atividade',
        'cnae_fiscal_principal', 'cnae_fiscal_secundaria',
        'tipo_de_logradouro', 'logradouro', 'numero', 'complemento',
        'bairro', 'cep', 'uf', 'municipio',
        'ddd1', 'telefone1', 'ddd2', 'telefone2',
        'ddd_do_fax', 'fax', 'correio_eletronico',
        'situacao_especial', 'data_da_situacao_especial',
    ],
    'rfb_socios': [
        'cnpj_basico', 'identificador_de_socio', 'nome_do_socio',
        'cnpj_ou_cpf_do_socio', 'qualificacao_do_socio',
        'data_de_entrada_sociedade', 'pais', 'representante_legal',
        'nome_do_representante', 'qualificacao_do_representante_legal',
        'faixa_etaria',
    ],
    'rfb_simples': [
        'cnpj_basico', 'opcao_pelo_simples', 'data_opcao_simples',
        'data_exclusao_simples', 'opcao_pelo_mei',
        'data_opcao_mei', 'data_exclusao_mei',
    ],
    'rfb_municipios': ['codigo', 'descricao'],
    'rfb_cnaes':      ['codigo', 'descricao'],
    'rfb_natureza':   ['codigo', 'descricao'],
    'rfb_qualificacoes': ['codigo', 'descricao'],
    'rfb_paises':     ['codigo', 'descricao'],
    'rfb_motivos':    ['codigo', 'descricao'],
}

FILE_TABLE_MAP = {
    'empresas':         'rfb_empresas',
    'estabelecimentos': 'rfb_estabelecimentos',
    'socios':           'rfb_socios',
    'simples':          'rfb_simples',
    'municipios':       'rfb_municipios',
    'cnaes':            'rfb_cnaes',
    'naturezas':        'rfb_natureza',
    'qualificacoes':    'rfb_qualificacoes',
    'paises':           'rfb_paises',
    'motivos':          'rfb_motivos',
}

# ── Import ────────────────────────────────────────────────────────────────────

def import_csv(conn, csv_path, table):
    cols = TABLE_COLUMNS[table]
    n    = len(cols)
    sql  = f'INSERT INTO {table} ({",".join(cols)}) VALUES %s ON CONFLICT DO NOTHING'
    total = 0
    batch = []

    with open(csv_path, encoding='latin1', errors='replace', newline='') as f:
        reader = csv.reader(f, delimiter=';', quotechar='"')
        for row in reader:
            # Normaliza número de colunas
            while len(row) < n:
                row.append('')
            row = [v.strip() if v and v.strip() else None for v in row[:n]]
            batch.append(row)
            if len(batch) >= CHUNK_SIZE:
                with conn.cursor() as cur:
                    psycopg2.extras.execute_values(cur, sql, batch)
                conn.commit()
                total += len(batch)
                batch = []
                progress('running', f'Importando {table}...', file=csv_path.name,
                         percent=0, records=total)

    if batch:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(cur, sql, batch)
        conn.commit()
        total += len(batch)

    return total


def create_indexes(conn):
    progress('running', 'Criando índices...')
    idxs = [
        'CREATE INDEX IF NOT EXISTS idx_rfb_est_basico   ON rfb_estabelecimentos(cnpj_basico)',
        'CREATE INDEX IF NOT EXISTS idx_rfb_est_uf       ON rfb_estabelecimentos(uf)',
        'CREATE INDEX IF NOT EXISTS idx_rfb_est_municipio ON rfb_estabelecimentos(municipio)',
        'CREATE INDEX IF NOT EXISTS idx_rfb_est_cnae     ON rfb_estabelecimentos(cnae_fiscal_principal)',
        'CREATE INDEX IF NOT EXISTS idx_rfb_est_situacao ON rfb_estabelecimentos(situacao_cadastral)',
        'CREATE INDEX IF NOT EXISTS idx_rfb_socios_basico ON rfb_socios(cnpj_basico)',
        'CREATE INDEX IF NOT EXISTS idx_rfb_emp_razao    ON rfb_empresas(razao_social text_pattern_ops)',
        'CREATE INDEX IF NOT EXISTS idx_rfb_socios_nome  ON rfb_socios(nome_do_socio text_pattern_ops)',
    ]
    with conn.cursor() as cur:
        # Tenta pg_trgm para buscas ILIKE %x% mais rápidas
        try:
            cur.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm')
            cur.execute('CREATE INDEX IF NOT EXISTS idx_rfb_emp_razao_trgm ON rfb_empresas USING gin(razao_social gin_trgm_ops)')
            cur.execute('CREATE INDEX IF NOT EXISTS idx_rfb_socios_trgm ON rfb_socios USING gin(nome_do_socio gin_trgm_ops)')
        except Exception:
            conn.rollback()
        for idx in idxs:
            try:
                cur.execute(idx)
            except Exception:
                conn.rollback()
    conn.commit()

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--skip-download', action='store_true')
    parser.add_argument('--limit', type=int, default=None)
    args = parser.parse_args()

    dev_limit = args.limit if args.limit is not None else int(os.environ.get('RFB_DEV_LIMIT', '1'))
    DATA_PATH.mkdir(parents=True, exist_ok=True)

    progress('running', f'Iniciando import (DEV_LIMIT={dev_limit})...')

    # ── Download ──────────────────────────────────────────────────────────────
    local_zips = []
    if not args.skip_download:
        try:
            token     = parse_token(BASE_URL)
            all_zips  = discover_files(token)
            selected  = select_files(all_zips, dev_limit)
            progress('running', f'{len(selected)} arquivo(s) para baixar')

            if not selected:
                progress('error', 'Nenhum arquivo encontrado no servidor da RF', error='no_files_found')
                sys.exit(1)

            def _dl(z):
                return download_file(token, z['href'], DATA_PATH)

            with ThreadPoolExecutor(max_workers=max(1, min(WORKERS, len(selected)))) as ex:
                futures = {ex.submit(_dl, z): z for z in selected}
                for fut in as_completed(futures):
                    try:
                        local_zips.append(fut.result())
                    except Exception as e:
                        progress('running', f'Erro no download: {e}', error=str(e))
        except Exception as e:
            progress('error', f'Erro ao descobrir arquivos: {e}', error=str(e))
            sys.exit(1)
    else:
        local_zips = list(DATA_PATH.glob('*.zip'))
        progress('running', f'{len(local_zips)} arquivo(s) já baixados')

    if not local_zips:
        progress('error', 'Nenhum arquivo disponível para importar', error='no_files')
        sys.exit(1)

    # ── Import ────────────────────────────────────────────────────────────────
    progress('running', 'Conectando ao banco de dados...')
    db_url = os.environ.get('DATABASE_URL', '')
    if not db_url:
        progress('error', 'DATABASE_URL não encontrada', error='no_db_url')
        sys.exit(1)

    try:
        conn = psycopg2.connect(db_url)
    except Exception as e:
        progress('error', f'Falha ao conectar ao banco: {e}', error=str(e))
        sys.exit(1)

    # Limpar tabelas que serão recarregadas
    cats_present = set(classify(z.name) for z in local_zips)
    tbls_to_clear = [FILE_TABLE_MAP[c.lower()] for c in cats_present if c.lower() in FILE_TABLE_MAP]
    if tbls_to_clear:
        progress('running', f'Limpando tabelas: {", ".join(tbls_to_clear)}')
        with conn.cursor() as cur:
            for t in tbls_to_clear:
                cur.execute(f'TRUNCATE TABLE {t} CASCADE')
        conn.commit()

    totals = {}
    total_zips = len(local_zips)
    for zip_idx, zip_path in enumerate(local_zips):
        cat   = classify(zip_path.name).lower()
        table = FILE_TABLE_MAP.get(cat)
        if not table:
            continue

        progress('running', f'Processando {zip_path.name}... ({zip_idx+1}/{total_zips})',
                 file=zip_path.name, percent=int((zip_idx / total_zips) * 100))
        try:
            with zipfile.ZipFile(zip_path, 'r') as zf:
                for member in zf.namelist():
                    if not member.lower().endswith(('.csv', '.txt', '.ESTABELE', '.EMPRE', '.SOCIO', '.SIMPLES')):
                        # RFB files sometimes have no extension
                        if '.' in Path(member).name:
                            continue
                    csv_path = DATA_PATH / member
                    zf.extract(member, DATA_PATH)
                    n = import_csv(conn, csv_path, table)
                    totals[table] = totals.get(table, 0) + n
                    progress('running', f'{table}: {n:,} linhas importadas de {member}',
                             file=member, records=totals[table])
                    try:
                        csv_path.unlink()
                    except Exception:
                        pass
        except Exception as e:
            progress('running', f'Erro ao processar {zip_path.name}: {e}', error=str(e))

    create_indexes(conn)
    conn.close()

    total_records = sum(totals.values())
    progress('done', 'Import concluído com sucesso!',
             records=total_records, percent=100)


if __name__ == '__main__':
    main()
