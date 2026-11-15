# Implantação no Google Cloud

Roteiro para publicar o HostOps AI em uma VM do Compute Engine com Docker Compose e HTTPS automático.

> Este roteiro e os arquivos `docker-compose.prod.yml` e `Caddyfile` foram validados apenas com `docker compose config`. Nenhuma subida real no Google Cloud foi executada durante a construção do projeto. Siga os passos acompanhando os logs.

## Por que uma VM

| Opção | Situação |
|---|---|
| **Compute Engine + Docker Compose** | Roda o projeto como está: MariaDB, Redis, worker sempre ligado e fotos em disco. Recomendado para o MVP. |
| Cloud Run + Cloud SQL + Memorystore | Exige mudanças antes: o Cloud SQL é MySQL (o projeto foi testado em MariaDB 10.11), as fotos precisam ir para o Cloud Storage (novo adaptador de `FileStorage`) e o worker precisa de CPU sempre alocada. Fica como evolução. |

## O que você precisa ter

- Projeto no Google Cloud com faturamento ativo.
- `gcloud` instalado e autenticado (`gcloud auth login`).
- Um domínio (ou subdomínio) cujo DNS você controla. HTTPS é obrigatório: o cookie de sessão, o webhook da Meta e o OAuth do Google dependem dele.
- O código em um repositório Git privado (recomendado) ou o `hostops-ai.zip`.

## 1. Testar localmente antes

```bash
pnpm install
cp .env.example .env
docker compose up -d mariadb redis
pnpm bootstrap
pnpm typecheck
pnpm test
docker compose up -d --build     # sobe tudo em contêineres, como na VM
```

Só avance quando o painel abrir em http://localhost:3000 pelos contêineres. É aqui que o build das imagens Docker é exercitado pela primeira vez.

## 2. Criar a infraestrutura

Troque `SEU_PROJETO`. A região `southamerica-east1` fica em São Paulo.

```bash
gcloud config set project SEU_PROJETO
gcloud services enable compute.googleapis.com

gcloud compute addresses create hostops-ip --region=southamerica-east1
gcloud compute addresses describe hostops-ip --region=southamerica-east1 --format='value(address)'

gcloud compute instances create hostops-vm \
  --zone=southamerica-east1-b \
  --machine-type=e2-medium \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=30GB \
  --address=hostops-ip \
  --tags=hostops-web

gcloud compute firewall-rules create hostops-allow-web \
  --allow=tcp:80,tcp:443,udp:443 \
  --target-tags=hostops-web
```

`e2-medium` (4 GB) é o mínimo confortável: o build do Next.js dentro da VM consome memória. Não abra as portas 3000, 3001, 3306 ou 6379.

## 3. Apontar o DNS

Crie um registro `A` do seu domínio (por exemplo `app.seudominio.com.br`) para o IP reservado. Espere propagar antes de subir os contêineres: o Caddy só consegue emitir o certificado se o domínio já responder na VM.

## 4. Preparar a VM

```bash
gcloud compute ssh hostops-vm --zone=southamerica-east1-b
```

Dentro da VM:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit
```

Entre de novo por SSH e traga o código:

```bash
git clone https://github.com/SUA_ORG/hostops-ai.git
cd hostops-ai
```

Sem repositório Git, envie o ZIP da sua máquina:

```bash
gcloud compute scp hostops-ai.zip hostops-vm:~ --zone=southamerica-east1-b
# na VM: sudo apt-get install -y unzip && unzip hostops-ai.zip && cd hostops-ai
```

## 5. Configurar o `.env` de produção

```bash
cp .env.example .env
nano .env
chmod 600 .env
```

| Variável | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `DOMAIN` | `app.seudominio.com.br` (sem `https://`) |
| `WEB_URL` | `https://app.seudominio.com.br` |
| `MARIADB_ROOT_PASSWORD`, `MARIADB_PASSWORD` | Senhas fortes e diferentes. Use só letras e números: a senha entra na URL de conexão. |
| `JWT_SECRET` | `openssl rand -base64 48` |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `GOOGLE_REDIRECT_URI` | `https://app.seudominio.com.br/api/v1/integrations/google/callback` |
| `GEMINI_API_KEY` | Chave do Google AI Studio (pode ficar vazia no início). |
| `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | Do app na Meta (podem ficar vazios no início). |

Guarde uma cópia de `ENCRYPTION_KEY` fora da VM. Sem ela, senhas de Wi-Fi, códigos de acesso e tokens gravados não podem ser lidos.

Com `NODE_ENV=production`, a aplicação recusa iniciar se `JWT_SECRET` ou `ENCRYPTION_KEY` ainda tiverem o valor de exemplo.

## 6. Subir

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f migrate api worker caddy
```

O arquivo de produção acrescenta o Caddy (portas 80 e 443, certificado automático), deixa de publicar as portas dos outros serviços e faz o `migrate` aplicar apenas as migrations, sem dados de demonstração.

Para não repetir os dois `-f`, defina na VM:

```bash
echo 'export COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml' >> ~/.bashrc && source ~/.bashrc
```

## 7. Criar a organização e o proprietário

Ainda não há cadastro pela interface. Use o script, que lê a senha de uma variável de ambiente:

```bash
read -s -p "Senha do proprietário: " OWNER_PASSWORD && export OWNER_PASSWORD && echo

docker compose run --rm \
  -e ORG_NAME="Nome da sua empresa" \
  -e OWNER_NAME="Seu nome" \
  -e OWNER_EMAIL="voce@seudominio.com.br" \
  -e OWNER_PASSWORD \
  migrate ./node_modules/.bin/tsx src/create-owner.ts

unset OWNER_PASSWORD
```

A senha precisa de pelo menos 10 caracteres, com letras e números. O script não altera nada se a organização ou o e-mail já existirem. Opcionais: `ORG_SLUG`, `ORG_TIMEZONE` (padrão `America/Sao_Paulo`) e `OWNER_PHONE`.

## 8. Conferir

```bash
curl -I https://app.seudominio.com.br/login
docker compose exec api node -e "fetch('http://127.0.0.1:3001/health').then(r=>r.text()).then(console.log)"
```

Depois, pelo navegador:

1. Entre com o proprietário criado.
2. Cadastre um imóvel e uma reserva de teste.
3. Confirme que a limpeza correspondente apareceu.
4. Cadastre uma diarista e entre com ela em uma janela anônima.

## 9. Ativar as integrações

Faça uma de cada vez, conferindo o log da API (`docker compose logs api | grep "HostOps API pronta"`), que informa o que está configurado. Os detalhes de cada uma estão em [INTEGRATIONS.md](INTEGRATIONS.md).

| Integração | Passos |
|---|---|
| iCal | Em cada imóvel, cadastre a URL do calendário do Airbnb e da Booking.com. |
| Gemini | Preencha `GEMINI_API_KEY` no `.env` e rode `docker compose up -d`. |
| WhatsApp | Preencha `WHATSAPP_APP_SECRET` e `WHATSAPP_VERIFY_TOKEN`, rode `docker compose up -d`, informe `phone_number_id` e token em Configurações e cadastre o webhook `https://app.seudominio.com.br/api/v1/webhooks/whatsapp` na Meta. |
| Google Calendar | Crie a credencial OAuth com o redirect URI do `.env`, preencha `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`, rode `docker compose up -d` e conecte em Configurações. |

Essas três últimas nunca foram exercitadas com credenciais reais. Teste cada uma com calma antes de divulgar o número aos hóspedes.

## 10. Backup

Disco inteiro, diariamente, com retenção de 14 dias:

```bash
gcloud compute resource-policies create snapshot-schedule hostops-diario \
  --region=southamerica-east1 --daily-schedule --start-time=06:00 --max-retention-days=14
gcloud compute disks add-resource-policies hostops-vm \
  --zone=southamerica-east1-b --resource-policies=hostops-diario
```

Dump lógico do banco (na VM, pode ir para um cron):

```bash
docker compose exec -T mariadb sh -c 'mariadb-dump --single-transaction -uroot -p"$MARIADB_ROOT_PASSWORD" "$MARIADB_DATABASE"' | gzip > ~/backup-$(date +%F).sql.gz
```

Faça pelo menos um teste de restauração.

## Atualizar

```bash
cd ~/hostops-ai && git pull
docker compose up -d --build
docker image prune -f
```

O `migrate` aplica as migrations pendentes antes de a API e o worker voltarem.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Caddy não emite o certificado | DNS ainda não aponta para a VM, ou as portas 80/443 estão fechadas no firewall. |
| API reinicia com "valor de exemplo" | `JWT_SECRET` ou `ENCRYPTION_KEY` não foram trocados. |
| `migrate` falha ao conectar | Senha do MariaDB com caracteres especiais, ou o volume foi criado antes com outra senha (`docker compose down -v` apaga os dados e recria). |
| Login não mantém a sessão | Acesso por HTTP ou `WEB_URL` diferente do endereço usado no navegador. |
| Build é interrompido | Falta de memória. Use `e2-medium` ou maior. |
| Webhook da Meta responde 401 | `WHATSAPP_APP_SECRET` diferente do App Secret do app. |

## Usando o Antigravity neste roteiro

O Antigravity lê o `GEMINI.md` da raiz como regras do projeto. Prompts que funcionam bem, um por vez:

1. "Leia `GEMINI.md`, `README.md` e `docs/DEPLOY_GCP.md`. Rode os passos da seção 1 e me mostre a saída de `pnpm typecheck` e `pnpm test`. Não altere código sem me mostrar o erro antes."
2. "Suba o ambiente com `docker compose up -d --build`. Se o build de alguma imagem falhar, mostre o log, proponha a correção no `Dockerfile` e aguarde minha aprovação."
3. "Abra http://localhost:3000 no navegador, entre com o usuário de demonstração e percorra todas as telas do menu. Liste o que não funcionou."
4. "Execute a seção 2 de `docs/DEPLOY_GCP.md` no projeto `SEU_PROJETO`. Mostre cada comando `gcloud` antes de executar."

Mantenha a aprovação manual para comandos de terminal enquanto o agente estiver mexendo no Google Cloud. Não cole o conteúdo do `.env` de produção no chat do agente: edite o arquivo você mesmo na VM.
