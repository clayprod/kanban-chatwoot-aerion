# Consumo de IA — revisão de 27/10/2026

## Licitações

- Abrir uma oportunidade consulta o resultado salvo. A abertura não executa o modelo.
- A verificação periódica dos anexos consulta o PNCP. Anexos iguais reaproveitam os documentos e a extração; arquivo/conteúdo/contexto alterado pode exigir nova leitura.
- A extração é compartilhada por fonte, contexto e trecho, com progresso persistido. Uma extração parcial finalizada não autoriza releitura automática. A tentativa manual de reparo tem identidade própria.
- As respostas do provedor também são persistidas por hash da solicitação, incluindo formato e limite de saída. Isso permite recuperar um checkpoint perdido sem nova chamada. Uma trava no banco evita chamadas idênticas simultâneas.
- Uma chamada com consumo incerto bloqueia a repetição automática. Rejeições HTTP sem geração permitem a alternativa configurada; a medição não trata timeout como custo zero.
- A comparação numérica, o ranking, os preços e as revisões manuais são locais. Apenas os três melhores produtos são apresentados depois da avaliação do catálogo pertinente.
- No modo por nota, todos os editais verdes são elegíveis; não há teto de quantidade. O teto diário de tokens é independente e sempre se aplica ao trabalhador técnico, incluindo fichas. Ao atingir o teto, o progresso é preservado até o próximo dia.
- OpenRouter é a primeira opção da análise técnica. A sequência de alternativas é Groq e OpenAI, respeitando os bloqueios e os orçamentos.

## Outras funções

| Função | Gatilho e proteção existente |
| --- | --- |
| Impugnação | Botão explícito; pontos selecionados; cache por conteúdo; etapas persistidas; uma tentativa por grupo; sem repetição automática de cobrança incerta. A exportação Word não usa IA. |
| Radar / tendências | Resultado diário salvo em banco e memória. Aberturas reaproveitam o resultado do dia. |
| Embeddings | Cache por modelo e texto em memória e banco; solicita somente textos ausentes do cache. |
| Assistentes e busca guiada | Solicitação explícita do usuário. Não são varredores automáticos de editais. |
| Resposta comercial / classificação | Automações com estado no banco, limites diários e regras de elegibilidade. A reativação da análise técnica não altera esses estados. |
| Follow-up / prospecção | Tetos diários e deduplicação; as regras de carga, intervalo, opt-out e atendimento do número continuam aplicáveis. |

O teto técnico não é um teto financeiro global do OpenRouter: outras funções podem consumir a mesma chave. Tokens medidos, reservas e valores cobrados pelo provedor são medidas diferentes. A auditoria antiga, anterior aos campos de provedor/modelo/hash, não permite atribuir cada cobrança a uma operação.

## Qualidade

O modelo extrai; evidências e números são verificados pelo servidor. Informação ausente, documento inacessível ou contradição permanece pendente. A política declarada pela Aerion confirma somente a condição de fornecimento de drones novos/sem uso; outras características continuam exigindo comprovação própria.
