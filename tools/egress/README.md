# Saída pessoal para pesquisas

O controle reside no Kanban e atende Kanban/browser-search e Hub. Não altera a rota padrão da VPS nem o gate do PNCP. Sem dispositivos configurados ou disponíveis, mantém os provedores/proxies existentes. Um bloqueio da fonte pausa o domínio, em vez de alternar endereços para superar desafios.

## Instalação Windows

Executar `Install-PersonalEgress.ps1` como administrador no dispositivo escolhido. Somente o Jasque ou somente o CLAYTON-PC já atende; o segundo é opcional. O instalador verifica o pacote oficial 3proxy 1.0.2 por SHA256, restringe a escuta ao IP Tailscale, permite somente a VPS `100.97.22.81`, exige autenticação, bloqueia destinos privados e limita a banda a 5 Mbps. Não altera suspensão, cookies ou perfis pessoais.

Notebook: `-TailnetAddress 100.117.55.18 -DeviceName Jasque`. Desktop: `-TailnetAddress 100.80.200.77 -DeviceName CLAYTON-PC`. Informar `-RegistrationPath` em diretório existente fora do Git. O registro é cifrado pelo Windows/DPAPI para o usuário que executou o instalador. Não enviar senhas no chat.

Para reutilizar o ZIP já baixado, informar `-ArchivePath` com o caminho do arquivo. O mesmo SHA256 é conferido antes de extrair. O instalador não altera o Defender nem suas exclusões; um executável removido por ele impede a instalação.

O serviço usa início automático atrasado, dependência do serviço Tailscale e recuperação automática. O wrapper `Install-Notebook.ps1` também habilita o modo unattended do Tailscale, para manter a conexão mesmo sem sessão aberta do usuário. Não é necessário ligar o desktop nem habilitar exit node. A execução continua dependendo de o notebook estar ligado, acordado e com internet.

Não sobrescrever instalações existentes. Para desativar, parar o serviço `3proxy`; os consumidores voltam ao fluxo anterior. Para remover, usar `3proxy.exe --remove` elevado e remover a regra de firewall nomeada `Aerion research via Tailscale`.

## Registro e consumidores

No cofre cifrado do Kanban, `RESEARCH_EGRESS_NODES` recebe a lista de objetos `{id,proxy}` dos dispositivos, na ordem notebook/desktop; `RESEARCH_EGRESS_TOKEN` recebe um token aleatório de integração. Não registrar a saída desses valores. Em browser-search e Hub/API/worker configurar `EGRESS_CONTROL_URL=http://tenryu_kanban-chatwoot-aerion:3001/api/internal/research-egress` e `EGRESS_CONTROL_TOKEN` com o mesmo token protegido. A porta é interna à rede Docker; não publicar o endpoint em uma porta adicional da VPS.

O broker mantém reservas/cotas e pausas no PostgreSQL. Downloads: um por vez, 625000 bytes/s, timeout de 30 minutos e reserva de 35 minutos. Pesquisa: uma operação por origem, intervalo de dez segundos, 60/h e 300/24h, compartilhados entre dispositivos e projetos. Os dois dispositivos são tratados conservadoramente como uma saída compartilhada, inclusive se estiverem no mesmo NAT.

Publicar o código pela main/CI. A CI do Kanban gera `ghcr.io/clayprod/kanban-chatwoot-aerion-browser-search:<sha>`; atualizar o serviço browser-search para esse artefato após CI verde. O Hub mantém seu pipeline main/CI/Easypanel existente. Nenhum código local deve ser copiado aos containers de produção.

## Instagram

Não há login por senha nem seguimento automático nesta entrega. Pesquisa pública indisponível/exigindo login vira pendência; evidências de outras fontes continuam válidas. O dashboard oferece “Abrir para seguir”. Uma integração autenticada futura depende de mecanismo permitido e credenciais novas em canal protegido.
