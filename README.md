# 🎉 Bingo Surpresa da Agnes

Bingo **de brincadeira e gratuito** para a festa de aniversário da Agnes, com cartelas digitais, sorteio em tempo real, narração automática no telão, prêmios-surpresa e conferência de vitória pelo servidor.

**Projeto separado do Leilão Surpresa da Agnes** — não altera os arquivos, o banco de dados nem as regras do leilão.

## Telas

- **/ — Convidados:** cadastro pelo nome, uma cartela individual por navegador/aparelho, números marcados pelo próprio participante e botão **BINGO!** com conferência real.
- **/telao — TV:** bolinha grande, últimos números, histórico, personagem da Agnes e animação do vencedor. Clique em **Ativar narração** uma vez para o navegador autorizar a voz em português brasileiro; depois os novos números são anunciados automaticamente.
- **/admin — Anfitrião:** configura prêmio-surpresa, escolhe **linha/coluna/diagonal** ou **cartela cheia**, inicia sorteio, sorteia, pausa, continua, confere vencedores, gera novas cartelas, bloqueia participantes e limita cadastros.

## Regras do jogo

- Padrão brasileiro de **75 bolinhas**, com cinco colunas: B (1–15), I (16–30), N (31–45), G (46–60), O (61–75).
- Cada cartela tem 24 números distintos e uma **estrela livre** no centro.
- Sorteios sem repetição, usando gerador aleatório criptográfico no servidor.
- O convidado só consegue marcar um número que **já foi sorteado** e aparece em sua cartela.
- Ao apertar **BINGO!**, o servidor confere o histórico sorteado e as marcações. Para linha, são aceitas linhas horizontais, colunas verticais e diagonais. Para cartela cheia, todos os números da cartela precisam estar marcados e sorteados (exceto a estrela livre).
- A primeira confirmação válida encerra a rodada e apresenta o vencedor no telão. Pode haver uma nova rodada com cartelas novas para todos, sem recadastrar os convidados.
- O administrador também pode encerrar a rodada sem vencedor e iniciar outra.

## Controle de acesso

Uma conta/cartela por navegador, vinculada a um cookie seguro, que permite reabrir a cartela sem novo cadastro. Isso **não garante** reconhecimento físico do celular: outro navegador, aba anônima ou limpeza de cookies pode contornar essa barreira. Para proteção mais forte, no painel do anfitrião, ative **Exigir código individual**, gere códigos de uso único e distribua um código por convidado. É possível desativar os novos cadastros após a chegada de todos.

**Observação:** o bingo é inteiramente recreativo e não inclui compra de cartelas, aposta, cobrança ou transferência de valores.

## Configurar no Render (plano Free)

1. Crie um serviço **Web Service** ou **Blueprint** a partir de \`p3rtub4d00/bingodaagnes\`.
2. Confirme **Runtime: Node**, **Build Command: \`npm install\`**, **Start Command: \`npm start\`**.
3. Configure as variáveis em **Environment**:
   - \`MONGODB_URI\`: URI do **MongoDB Atlas**, apontando para o banco \`bingodaagnes\`. Pode usar o mesmo cluster do leilão, **mas com outro banco**.
   - \`ADMIN_PASSWORD\`: escolha uma senha longa para a página \`/admin\`.
   - \`SESSION_SECRET\`: chave aleatória longa e secreta (o Blueprint pode gerá-la).
   - \`NODE_ENV=production\`.
4. No Atlas, autorize as conexões de rede a partir do serviço Render e configure o usuário com permissão de leitura/escrita no banco \`bingodaagnes\`.
5. Faça o deploy e abra o endereço que o Render mostrar; o nome exato do subdomínio depende da disponibilidade.

**Importante:** sem \`MONGODB_URI\`, o site funciona em **demonstração temporária** (RAM). Os dados são perdidos a cada reinicialização ou hibernação do Render; configure o Atlas antes da festa. Sem \`ADMIN_PASSWORD\` e \`SESSION_SECRET\`, não é possível entrar no administrador.

## Executar localmente

\`\`\`bash
npm install
npm start
\`\`\`

Testes locais (sem necessidade de MongoDB):

\`\`\`bash
npm run check
npm test
\`\`\`

## Identidade visual

Cores roxo, rosa e amarelo, fontes **Lilita One**, **Fredoka** e **Baloo 2**, painel com o mesmo estilo do layout aprovado, além da personagem da Agnes. O arquivo da personagem em alta resolução é usado diretamente do repositório público [Leilão Surpresa da Agnes](https://github.com/p3rtub4d00/leilaodaagnes), sem mudar esse repositório; existe uma imagem SVG local como alternativa para indisponibilidade.

O site foi projetado para telas de celulares e formato de TV 16:9.
