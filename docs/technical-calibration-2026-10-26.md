# Revisão técnica dos editais — 26/10/2026

Os requisitos foram conferidos pelo Codex nos textos salvos dos documentos, sem usar o OpenRouter para fazer a revisão. A fila paga permanece pausada. O teste externo anterior recebeu HTTP 402 na primeira chamada, registrou custo zero e foi interrompido.

| Caso | Páginas disponíveis | Registros conferidos | Pendência documental |
|---|---:|---:|---|
| ARCE — termo 20260013 | 5 | 21 | O documento cita um TR que não consta no conjunto disponível. |
| Edital 45/2026 | 21 | 7 | TR separado ausente. A pesquisa de preços contém outras contratações e não define as exigências atuais. |
| Edital 351/2026 | 93, contando edital e retificação | 100 | A tabela informa velocidade em MIN; a ficha detalhada informa m/s. A divergência permanece explícita. |

Os registros incluem características técnicas, kit e obrigações de fornecimento/documentação. As ocorrências equivalentes são consolidadas por item, preservando citações. Regras de habilitação e fornecimento não entram no percentual técnico.

## Comportamento publicado

- As tabelas conferidas são comparadas localmente com os produtos e acessórios cadastrados, inclusive com a fila paga pausada. Inicialização e consulta não precisam de IA externa.
- A revisão se vincula à assinatura do texto integral dos arquivos e aos números dos itens. Mudanças invalidam sua utilização e os percentuais anteriores.
- Ausência de TR, documento adicional sem revisão, divergência ou anexos sem atualização confirmada impedem atendimento integral.
- Cada produto mantém seus valores, condições, composição e fontes. O sistema soma apenas os acessórios compatíveis necessários e ordena por atendimento e preço comparável.
- Quantidades por extenso, unidades de embalagem com uma unidade e autonomias acompanhadas de observações são tratadas sem alterar o texto original. Baterias reservas exigem conhecer quantas ficam em operação.
- Grandezas distintas, como tempo de voo e tempo estacionário, permanecem separadas. Sensor CMOS de formato menor não comprova o formato maior solicitado; câmera térmica explicitamente ausente reprova requisitos desse componente.

## Verificação e limites

Os gabaritos e os textos originais estão em `backend/tests/fixtures/technical-calibration`. Há testes das citações, regras numéricas, composição dos kits, comparação e invalidação. Um teste PostgreSQL confirma que a revisão vira checklist persistido sem chamar IA e que editar a fonte invalida os resultados.

O catálogo estruturado conserva todos os campos disponíveis para cada variante. Campo processado não significa que toda capacidade possível do produto foi comprovada: o checklist continua mostrando **sem comprovação** quando falta evidência ou equivalência segura. Esta entrega não declara a extração automática de todos os editais verdes validada.

A conferência do EVO Max V2 também consultou o [manual oficial da série V2](https://www.autelrobotics.com/wp-content/uploads/2025/06/EN_EVO-Max-Series-V2-Multi-rotor-Drone-User-Manual_V1.0.2.pdf), apêndice de especificações. A documentação confirma a importância de distinguir a carga Fusion 4T V2 de outras versões da linha.

As futuras leituras automáticas passaram a usar uma extração com cobertura na mesma chamada, cache compartilhado entre buscas e exclusão de pesquisas de preços como fonte de requisitos. A calibração da extração externa continua separada da revisão documental já entregue; a fila não é reativada por este código.
